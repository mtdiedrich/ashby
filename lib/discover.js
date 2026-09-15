// Finding Ashby board slugs without a browser.
//
// The documented route is a Google search plus a DevTools snippet, which works but is
// manual and gets CAPTCHAd fast. Hacker News is better: the monthly "Who is hiring"
// threads are full of Ashby apply links, and Algolia indexes every comment behind a
// public API with no key and no rate limit worth worrying about.
//
// One pass returns a few hundred slugs. They still have to be validated — a slug
// scraped from a two-year-old comment is often a company that has since moved ATS or
// folded — which is what harvest.js already does.

const ALGOLIA = 'https://hn.algolia.com/api/v1/search';

/** HN stores comments HTML-escaped; the slashes in a URL come back as &#x2F;. */
export const unescapeHtml = (s) => String(s ?? '')
  .replace(/&#x2F;/g, '/')
  .replace(/&#x27;/g, "'")
  .replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&');

/** Every jobs.ashbyhq.com slug in a blob of text, lowercased. */
export function slugsIn(text) {
  const out = new Set();
  for (const m of unescapeHtml(text).matchAll(/jobs\.ashbyhq\.com\/([a-zA-Z0-9][a-zA-Z0-9._-]*)/g)) {
    const slug = m[1].toLowerCase();
    // Guard against a trailing path segment or a bare uuid being read as a slug.
    if (/^[a-f0-9]{8}-[a-f0-9]{4}/.test(slug)) continue;
    out.add(slug);
  }
  return out;
}

/**
 * Search Hacker News comments for Ashby links.
 * @param {(msg: string) => void} [log]
 * @returns {Promise<Set<string>>}
 */
export async function fromHackerNews(log = () => {}) {
  const slugs = new Set();

  for (const query of ['ashbyhq.com', 'jobs.ashbyhq.com']) {
    for (let page = 0; page < 20; page++) {
      const url = `${ALGOLIA}?query=${encodeURIComponent(query)}&tags=comment&hitsPerPage=100&page=${page}`;
      let d;
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
        if (!r.ok) break;
        d = await r.json();
      } catch { break; }

      if (!d.hits?.length) break;
      for (const h of d.hits) for (const s of slugsIn(h.comment_text)) slugs.add(s);
      log(`  hn "${query}" page ${page + 1}: ${slugs.size} slugs so far`);

      // Algolia caps a query at 1000 results; past that the pages repeat.
      if ((page + 1) * 100 >= (d.nbHits ?? 0)) break;
    }
  }
  return slugs;
}

// ---- GitHub code search --------------------------------------------------
//
// ~32,000 indexed files mention jobs.ashbyhq.com: job-list READMEs, scraper
// fixtures, company directories, personal trackers. The search API can return the
// matching text fragment itself, so the slugs come straight out of the search
// results and no file ever has to be fetched.
//
// Two limits shape this. A single query caps at 1000 results, which is why several
// narrower queries are run instead of one broad one — each gets its own 1000. And
// authenticated code search allows 10 requests a minute, so a full pass takes a
// few minutes of mostly waiting.

import { execFileSync } from 'node:child_process';

const CODE_SEARCH = 'https://api.github.com/search/code';
const PER_PAGE = 100;
const RATE_PAUSE_MS = 6500;        // 10 req/min, with headroom

/** GITHUB_TOKEN, else whatever `gh auth login` stored. */
export function githubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return null; }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// One broad query would stop at 1000 results. Splitting by file type gets a
// separate 1000 from each, and these are where slugs actually collect.
const QUERIES = [
  'jobs.ashbyhq.com',
  'jobs.ashbyhq.com extension:md',
  'jobs.ashbyhq.com extension:json',
  'jobs.ashbyhq.com extension:txt',
  'jobs.ashbyhq.com extension:csv',
  'jobs.ashbyhq.com extension:py',
  'jobs.ashbyhq.com extension:ts',
  'jobs.ashbyhq.com extension:js',
  'jobs.ashbyhq.com extension:yml',
  'jobs.ashbyhq.com extension:html',
];

/**
 * Search GitHub code for Ashby links and pull the slugs out of the match fragments.
 * @param {(msg: string) => void} [log]
 * @returns {Promise<Set<string>>}
 */
export async function fromGitHub(log = () => {}) {
  const token = githubToken();
  if (!token) {
    log('  no GitHub token — run `gh auth login` or set GITHUB_TOKEN; skipping');
    return new Set();
  }

  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github.text-match+json',
    'user-agent': 'ashby-slug-discovery',
  };
  const slugs = new Set();

  for (const q of QUERIES) {
    for (let page = 1; page <= 10; page++) {
      const url = `${CODE_SEARCH}?q=${encodeURIComponent(q)}&per_page=${PER_PAGE}&page=${page}`;
      let d;
      try {
        const r = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
        if (r.status === 403 || r.status === 429) {   // secondary rate limit
          log(`  rate limited, waiting 60s`);
          await sleep(60_000);
          page--; continue;
        }
        if (!r.ok) break;
        d = await r.json();
      } catch { break; }

      if (!d.items?.length) break;
      for (const item of d.items) {
        for (const m of item.text_matches ?? []) for (const s of slugsIn(m.fragment)) slugs.add(s);
      }
      log(`  github "${q.replace('jobs.ashbyhq.com', '·')}" p${page}: ${slugs.size} slugs`);

      if (page * PER_PAGE >= Math.min(d.total_count ?? 0, 1000)) break;
      await sleep(RATE_PAUSE_MS);
    }
    await sleep(RATE_PAUSE_MS);
  }
  return slugs;
}

// ---- Wayback Machine CDX index -------------------------------------------
//
// The highest-yield source, and the only one that answers the question we actually
// have. HN and GitHub find boards somebody linked to; the CDX index returns every
// URL ever crawled under a host, so it finds boards nobody wrote about. One request
// returns ~200k URLs and ~6.4k distinct slugs, against the 1.4k the other two found
// between them — and it contains 94% of those as a subset, so it is a superset in
// practice rather than a different slice.
//
// No key, no pagination, no rate limit worth pacing. The cost is that it is a
// historical index: roughly half of what comes back is a company that has since
// moved ATS or folded, which is what harvest's validation pass is for.

const CDX = 'http://web.archive.org/cdx/search/cdx';

/**
 * The board slug in an Ashby URL, or null.
 *
 * slugsIn() is a regex over prose and is deliberately permissive. A URL index needs
 * the opposite: the dump is full of mangled URLs carrying session tokens, datadog
 * config and CSS values in the path, and every one of those would otherwise become a
 * candidate and cost a validation request.
 */
export function slugFromUrl(url) {
  let seg;
  try {
    const u = new URL(String(url ?? ''));
    if (!/(^|\.)ashbyhq\.com$/i.test(u.hostname)) return null;
    seg = u.pathname.split('/').filter(Boolean)[0];
  } catch { return null; }
  if (!seg) return null;

  try { seg = decodeURIComponent(seg); } catch { /* keep the raw form */ }
  seg = seg.toLowerCase();

  if (!/^[a-z0-9][a-z0-9._-]*$/.test(seg)) return null;  // anything exotic is junk
  if (seg.length < 2 || seg.length > 50) return null;    // no initials, no tokens
  if (/^[a-f0-9]{8}-?[a-f0-9]{4}/.test(seg)) return null;      // posting uuid
  if (/^[a-f0-9]{24,}$/.test(seg)) return null;                // session token
  if (/^\d+$/.test(seg)) return null;                          // pagination
  if (/^\d+(vh|vw|px|em|rem|pt)$/.test(seg)) return null;      // leaked css
  return seg;
}

/** Every distinct slug in a CDX dump, one URL per line. */
export function slugsFromCdx(text) {
  const out = new Set();
  for (const line of String(text ?? '').split('\n')) {
    const s = slugFromUrl(line.trim());
    if (s) out.add(s);
  }
  return out;
}

/**
 * Ask the Wayback CDX index for every URL crawled under jobs.ashbyhq.com.
 * @param {(msg: string) => void} [log]
 * @returns {Promise<Set<string>>}
 */
export async function fromWayback(log = () => {}) {
  const url = `${CDX}?url=jobs.ashbyhq.com*&output=text&fl=original`
            + `&collapse=urlkey&filter=statuscode:200`;
  // A 504 is routine here rather than exceptional: the index builds the entire
  // ~200k-line response before sending a byte, and under load it gives up first.
  // The same request usually succeeds a minute later, so retry rather than skip.
  let text = null;
  for (let attempt = 0; attempt < 4 && text === null; attempt++) {
    if (attempt) {
      log(`  retrying in ${15 * attempt}s (attempt ${attempt + 1} of 4)`);
      await sleep(15_000 * attempt);
    }
    log('  asking the Wayback index (one big response, up to a few minutes)');
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(300_000) });
      if (r.ok) { text = await r.text(); break; }
      log(`  wayback returned ${r.status}`);
    } catch (e) {
      log(`  wayback request failed (${e.message})`);
    }
  }
  if (text === null) { log('  wayback unreachable, skipping'); return new Set(); }
  const lines = text.split('\n').length;
  const slugs = slugsFromCdx(text);
  log(`  ${lines} archived urls → ${slugs.size} slugs`);
  return slugs;
}
