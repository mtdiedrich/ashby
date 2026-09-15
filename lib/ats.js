// The applicant tracking systems this tool reads.
//
// Both publish an unauthenticated board API returning every open posting for a
// company, which is the only thing this project needs. Everything ATS-specific lives
// here: the endpoint, the response shape, and the conversion to a corpus record.
//
// Differences that mattered, checked against live boards 2026-09-15:
//
//   description   Ashby returns plain text in `descriptionPlain`. Greenhouse returns
//                 ESCAPED html in `content` — literally "&lt;h2&gt;" — so it needs
//                 unescaping and stripping before it is worth a scoring token.
//   compensation  Ashby publishes structured pay on ~38% of postings. Greenhouse
//                 publishes none at all; 42 of Stripe's 639 mention it even in prose.
//   workplace     Ashby has workplaceType and isRemote. Greenhouse has neither, so
//                 "remote" has to be read off the location string.
//   apply url     Greenhouse's absolute_url is often the company's own careers site
//                 (Stripe's points at stripe.com), which is not a form we can open.
//                 The canonical job-boards.greenhouse.io URL is built instead.

import { tidy } from './text.js';
import { wantedTitle } from './filters.js';

// ---- what is worth storing ----------------------------------------------
//
// Measured on the real corpus: 380 MB, of which 367 MB is descriptions for titles the
// filters will never pass to a scorer. Greenhouse is three times the postings at a
// sixth the ML/AI density; stored the same way it projected a 5.5 GB heap, past
// Node's default limit, at which point corpus() simply stops loading.
//
// So metadata is kept for every posting — the board still lists them all and you can
// still stage one — and the description only for titles that could actually be
// scored. Staging anything else fetches its description on demand, which is one
// request at the moment you need it rather than a gigabyte held against the chance.

/** Is this title one a scorer could ever see? */
export const keepDescription = title => wantedTitle(title ?? '');

/** The endpoint that returns one posting, for fetching a description back. */
export function postingUrl(ats, slug, id) {
  const bare = String(id).replace(/^greenhouse:/, '');
  if (ats.id === 'greenhouse') {
    return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(bare)}?content=true`;
  }
  // Ashby publishes no single-posting endpoint; the board call returns them all.
  return ats.boardUrl(slug);
}

// ---- html ----------------------------------------------------------------

const ENTITIES = {
  lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  mdash: '—', ndash: '–', hellip: '…', eacute: 'é',
};

const decode = (s) => String(s)
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);

/**
 * Escaped html to readable text.
 *
 * Decoded twice on purpose: Greenhouse escapes the markup itself, so one pass turns
 * "&lt;p&gt;" into "<p>" and the second turns "&amp;amp;" inside it into "&". Tags
 * are then stripped, with block-level ones becoming newlines so paragraphs and list
 * items do not run into each other.
 */
export function htmlToText(s) {
  if (!s) return '';
  const once = decode(s);
  const twice = /[<>]/.test(once) ? decode(once) : once;
  return tidy(twice
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, '\n')
    .replace(/<\s*(p|div|li|h[1-6]|tr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/[ \t]+/g, ' '));
}

// ---- workplace -----------------------------------------------------------

/**
 * Greenhouse publishes no workplaceType, so it comes off the location string.
 * Returns null rather than guessing when the string says nothing either way — an
 * invented "Onsite" would be filtered on as though it were fact.
 */
export function inferWorkplace(location) {
  const t = String(location ?? '');
  if (!t.trim()) return null;
  if (/\bhybrid\b/i.test(t)) return 'Hybrid';     // checked first: "Hybrid - Remote office" is not remote
  if (/\bremote\b|\bwork from home\b|\bwfh\b/i.test(t)) return 'Remote';
  return null;
}

// ---- adapters ------------------------------------------------------------

const str = v => (v == null ? null : String(v));

export const ATS = {
  ashby: {
    id: 'ashby',
    label: 'Ashby',
    host: 'jobs.ashbyhq.com',
    boardUrl: slug =>
      `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`,
    postingsFrom: d => d?.jobs ?? [],
    normalize: (j, slug, now, { descriptions = true } = {}) => ({
      ats: 'ashby',
      // Deliberately unprefixed. Every corpus row written before this existed uses
      // the bare Ashby id, and prefixing now would orphan all 62,000 of them along
      // with every fitness, coverage and vector record keyed to them.
      id: j.id,
      company: slug,
      title: j.title,
      department: j.department ?? null,
      team: j.team ?? null,
      location: j.location ?? '',
      secondaryLocations: (j.secondaryLocations ?? []).map(l => l.location).filter(Boolean).join(' | '),
      isRemote: j.isRemote ?? null,
      workplaceType: j.workplaceType ?? null,
      employmentType: j.employmentType ?? null,
      publishedAt: j.publishedAt ?? null,
      jobUrl: j.jobUrl,
      applyUrl: j.applyUrl,
      compensation: j.compensation ?? null,
      description: descriptions ? tidy(j.descriptionPlain) : '',
      // Only set when the description was deliberately left out, so an empty
      // description is never mistaken for a posting that genuinely has none.
      ...(descriptions ? {} : { descriptionStored: false }),
      fetchedAt: now,
    }),
  },

  greenhouse: {
    id: 'greenhouse',
    label: 'Greenhouse',
    host: 'job-boards.greenhouse.io',
    // boards.greenhouse.io is the older host and still serves; both are searched
    // when discovering slugs, but the API is the same either way.
    altHosts: ['boards.greenhouse.io'],
    boardUrl: slug =>
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`,
    postingsFrom: d => d?.jobs ?? [],
    normalize: (j, slug, now, { descriptions = true } = {}) => {
      const location = j.location?.name ?? '';
      return {
        ats: 'greenhouse',
        // Prefixed, because Greenhouse ids are small integers and would otherwise
        // be a live collision risk across boards and against nothing in Ashby.
        id: `greenhouse:${j.id}`,
        company: slug,
        title: j.title,
        department: j.departments?.[0]?.name ?? null,
        team: j.departments?.[1]?.name ?? null,
        location,
        // offices repeat the primary location often enough to be worth dropping.
        secondaryLocations: (j.offices ?? []).map(o => o?.name)
          .filter(n => n && n !== location).join(' | '),
        isRemote: null,
        workplaceType: inferWorkplace(location),
        employmentType: null,                 // Greenhouse does not publish it
        publishedAt: str(j.first_published ?? j.updated_at),
        jobUrl: j.absolute_url ?? null,
        // NOT absolute_url: that is the company's own careers page on many boards.
        applyUrl: `https://job-boards.greenhouse.io/${slug}/jobs/${j.id}`,
        compensation: null,                   // Greenhouse publishes none
        description: descriptions ? htmlToText(j.content) : '',
        ...(descriptions ? {} : { descriptionStored: false }),
        fetchedAt: now,
      };
    },
  },
};

/** The adapter a corpus record belongs to. Records written before this are Ashby. */
export const adapterFor = rec => ATS[rec?.ats] ?? ATS.ashby;
