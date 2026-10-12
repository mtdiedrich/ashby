// Pay estimates from levels.fyi, for postings that publish no pay.
//
// DISPLAY ONLY. An estimate is what people at that company reported, not what this
// posting offers, so nothing that selects, filters or scores postings reads it —
// test/levels.test.js scans those modules to keep it that way.
//
// levels.fyi only. Glassdoor and Indeed answer automated requests with a bot check
// and a sign-in wall; levels.fyi's robots.txt allows crawling and each page embeds
// its data as JSON in __NEXT_DATA__.
//
// Verified against live pages 2026-10-02:
//   - There is no machine-learning-engineer family. ML and AI engineers are filed
//     under software-engineer with a focus tag, so titles map onto families here.
//   - The family-wide `percentiles` can describe ANOTHER COUNTRY even on the
//     /locations/united-states URL — DailyPay's said United Kingdom, Scale AI's
//     Switzerland on one sample. They are used only when they say United States.
//   - The per-level `averages` are US-filtered on that URL, and each carries its
//     samples with a countryId (254 is the United States), which is checked too.
//   - An unknown company is a clean 404, never a different company's page.
//
// When the company has no usable US data, there is no estimate. A market rate for the
// title from other companies is deliberately not offered.

import { salaryOf } from './comp.js';
import { usLocation } from './filters.js';
import { statedPay } from './pay-text.js';

const US_COUNTRY_ID = 254;

/** The levels.fyi page for one company's job family, US only. */
export const pageUrl = (company, family) =>
  `https://www.levels.fyi/companies/${encodeURIComponent(company)}/salaries/${family}/locations/united-states`;

/**
 * The levels.fyi job family a posting title belongs to, or null.
 * Order matters: a manager of engineers is not an engineer, and a sales or
 * solutions "engineer" is not in the software-engineer family at all.
 */
export function familyFor(title) {
  const t = String(title ?? '').toLowerCase();
  if (/\b(engineering manager|manager,? (of )?([\w/]+ ){0,3}engineering|director of engineering|head of engineering)\b/.test(t))
    return 'software-engineering-manager';
  if (/\bdata scien(tist|ce)\b/.test(t)) return 'data-scientist';
  if (/\bproduct manager\b/.test(t)) return 'product-manager';
  if (/\b(sales|solutions?|support|customer|field|success|security operations)\s+engineer/.test(t)) return null;
  if (/\b(engineer|developer|programmer|swe)\b/.test(t)) return 'software-engineer';
  return null;
}

/** The seniority word in a title, or null when it carries none. */
export function seniorityOf(title) {
  const t = String(title ?? '').toLowerCase();
  if (/\b(senior|sr\.?)\s+staff\b/.test(t)) return 'senior staff';
  if (/\bdistinguished\b/.test(t)) return 'distinguished';
  if (/\bprincipal\b/.test(t)) return 'principal';
  if (/\bstaff\b/.test(t)) return 'staff';
  if (/\blead\b/.test(t)) return 'lead';
  if (/\b(senior|sr)\b\.?/.test(t)) return 'senior';
  return null;
}

const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// A level row is usable only with submissions, and only if every sample it shows is
// from the United States.
const usable = row => row && row.count > 0 &&
  (row.samples ?? []).every(s => s?.countryId == null || s.countryId === US_COUNTRY_ID);

/**
 * Which of the company's levels this title is.
 *   exact       the title IS one of that level's titles
 *   same level  the title's seniority word matches exactly one level's
 * Null when neither — a title with no seniority word is not guessed at.
 */
export function levelMatch(title, averages) {
  const rows = (averages ?? []).filter(r => r?.count > 0);
  const want = norm(title);
  const exact = rows.find(r => (r.titles ?? []).some(t => norm(t) === want));
  if (exact) return { kind: 'exact', row: exact };

  const s = seniorityOf(title);
  if (!s) return null;
  const same = rows.filter(r => (r.titles ?? []).some(t => seniorityOf(t) === s));
  return same.length === 1 ? { kind: 'same level', row: same[0] } : null;
}

/**
 * The estimate for one posting title from one levels.fyi page, or null.
 * Base salary is the figure comparable with posted ranges; total comp rides along.
 */
export function estimateFrom(pageProps, title) {
  const pp = pageProps;
  if (!pp) return null;
  const common = {
    company: pp.company?.name ?? null,
    family: pp.jobFamilySlug ?? null,
  };

  const m = levelMatch(title, pp.averages);
  if (m && usable(m.row)) {
    return { ...common, kind: m.kind,
      level: m.row.secondaryLevelName ?? m.row.titles?.at(-1) ?? m.row.level,
      base: Math.round(m.row.base), total: Math.round(m.row.total), count: m.row.count };
  }
  if (m) return null;          // it IS that level, and that level's data is not US

  const pc = pp.percentiles;
  if (pc?.locationName === 'United States' && pc.count > 0 && pc.base_salary?.p50 != null) {
    return { ...common, kind: 'all levels', level: null,
      base: Math.round(pc.base_salary.p50),
      baseLow: Math.round(pc.base_salary.p25), baseHigh: Math.round(pc.base_salary.p75),
      total: pc.tc?.p50 != null ? Math.round(pc.tc.p50) : null, count: pc.count };
  }
  return null;
}

/** pageProps out of a levels.fyi page, or null for a 404 or a page without data. */
export function parseNextData(html) {
  const m = String(html ?? '').match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  let d;
  try { d = JSON.parse(m[1]); } catch { return null; }
  if (d?.page === '/404' || d?.page === '/_error') return null;
  const pp = d?.props?.pageProps;
  return pp && pp.company ? pp : null;
}

/**
 * The levels.fyi company slug for a board slug. Usually identical; the overrides
 * file maps the ones that are not ("andurilindustries" -> "anduril"), and maps a
 * slug to null to stop it ever being looked up.
 */
export function levelsSlug(boardSlug, overrides = {}) {
  if (Object.hasOwn(overrides ?? {}, boardSlug)) return overrides[boardSlug] || null;
  return boardSlug;
}

/**
 * Scored, publishes no pay — in its pay field OR its description — in the US, and its
 * title maps onto a family. Pay the posting states always beats an estimate.
 */
export function needsEstimate(posting, scoredIds) {
  if (!posting || !scoredIds.has(posting.id)) return false;
  if (salaryOf(posting) || statedPay(posting)) return false;
  if (!usLocation(posting.location, [posting.location, posting.secondaryLocations].filter(Boolean).join(' | ')))
    return false;
  return familyFor(posting.title) != null;
}

/** Newest record per posting id. The file is append-only; line order means nothing. */
export function estimatesById(rows) {
  const out = new Map();
  for (const r of rows ?? []) {
    if (!r?.id) continue;
    const prev = out.get(r.id);
    if (!prev || String(r.at ?? '') > String(prev.at ?? '')) out.set(r.id, r);
  }
  return out;
}

const MAX_AGE_DAYS = 30;

/**
 * Whether a posting should be looked up this run. A miss ("no levels.fyi page") is
 * remembered as long as a hit, so a re-run does not ask again for companies that
 * are not there.
 */
export function due(rec, now = new Date(), { refresh = false } = {}) {
  if (refresh || !rec?.at) return true;
  return (now - new Date(rec.at)) / 86_400_000 > MAX_AGE_DAYS;
}

/**
 * Whether a response is levels.fyi's bot check rather than an answer.
 *
 * It sits behind AWS WAF, which answers a client that is going too fast with a
 * challenge page (405, x-amzn-waf-action: captcha). That says nothing about the
 * company, so it must never be recorded as "not on levels.fyi". It is not worked
 * around either: the run stops, and waiting is the remedy.
 */
export function isBlocked(res) {
  if (res?.headers?.get?.('x-amzn-waf-action')) return true;
  return [403, 405, 429].includes(res?.status);
}

const squash = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Whether a levels.fyi company name plausibly is the company a board slug names.
 * Equal once punctuation is gone, or one contains the other — but only when the
 * shorter is at least five characters and at least 40% of the longer, so "junior"
 * is not "Junior Achievement Worldwide" and "bio" is not "Biogen".
 */
export function nameMatches(boardSlug, companyName) {
  const a = squash(boardSlug), b = squash(companyName);
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 5 && short.length / long.length >= 0.4 && long.includes(short);
}
