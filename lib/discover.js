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
const ASHBY_HOST = /(^|\.)ashbyhq\.com$/i;

// Served from the same hosts as the boards and shaped exactly like a slug. Greenhouse
// in particular puts assets and its own pages on boards.greenhouse.io.
const NOT_A_BOARD = /^(embed|jobs|api|assets|static|images|img|css|js|fonts|favicon|robots|sitemap|search|login|signup|about|privacy|terms|error|404)(\.|$)/i;

export function slugFromUrl(url, host = ASHBY_HOST) {
  let seg;
  try {
    const u = new URL(String(url ?? ''));
    if (!host.test(u.hostname)) return null;
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
  if (NOT_A_BOARD.test(seg)) return null;                      // the site's own paths
  return seg;
}

/** Every distinct slug in a CDX dump, one URL per line. */
export function slugsFromCdx(text, host = ASHBY_HOST) {
  const out = new Set();
  for (const line of String(text ?? '').split('\n')) {
    const s = slugFromUrl(line.trim(), host);
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

// ---- Common Crawl --------------------------------------------------------
//
// A second URL index, queried the same way as Wayback but over a different crawl.
// Measured: 2,059 slugs, of which 1,734 were already live here and 281 already
// known dead — so it is largely a subset of Wayback rather than a peer. Worth a
// pass because it is one request per index and it does find a few dozen Wayback
// missed, but do not expect another Wayback from it.

const CC_COLLINFO = 'https://index.commoncrawl.org/collinfo.json';

/** Slugs from a Common Crawl index response — JSON per line, not CDX text. */
export function slugsFromCdxJson(body) {
  const out = new Set();
  for (const line of String(body ?? '').split('\n')) {
    if (!line.trim()) continue;
    let url;
    try { url = JSON.parse(line).url; } catch { continue; }
    const s = slugFromUrl(url);
    if (s) out.add(s);
  }
  return out;
}

/**
 * Search the most recent Common Crawl indexes for Ashby board URLs.
 * @param {(msg: string) => void} [log]
 * @param {number} [indexes] how many recent crawls to query
 */
export async function fromCommonCrawl(log = () => {}, indexes = 3) {
  let collections;
  try {
    const r = await fetch(CC_COLLINFO, { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) { log(`  collinfo returned ${r.status}, skipping`); return new Set(); }
    collections = await r.json();
  } catch (e) { log(`  common crawl unreachable (${e.message}), skipping`); return new Set(); }

  const slugs = new Set();
  for (const c of (collections ?? []).slice(0, indexes)) {
    const url = `${c['cdx-api']}?url=jobs.ashbyhq.com%2F*&output=json&fl=url&limit=40000`;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(240_000) });
      // A 404 means this crawl has nothing for the host; a 504 means it gave up
      // building the response. Neither is worth failing the whole pass over.
      if (!r.ok) { log(`  ${c.id}: ${r.status}`); continue; }
      for (const s of slugsFromCdxJson(await r.text())) slugs.add(s);
      log(`  ${c.id}: ${slugs.size} slugs so far`);
    } catch (e) { log(`  ${c.id} failed (${e.message})`); }
  }
  return slugs;
}

// ---- Y Combinator --------------------------------------------------------
//
// The only source here that is not a crawl, and so the only one that can find a
// board nobody has ever linked to OR archived. YC publishes its whole company
// directory behind a public paginated API, and Ashby is common among its companies:
// 507 of the boards already known were reachable from a YC name, slug or domain.
//
// The trade is precision. Measured on a 300-slug sample of untested candidates:
// 2.3% live, averaging under 2 postings each. It is a long tail of very small
// companies, and it costs one validation request per candidate.

const YC_API = 'https://api.ycombinator.com/v0.1/companies';

const slugify = (s) => String(s ?? '').toLowerCase().trim()
  .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')
  .replace(/\.(com|io|ai|co|dev|app|xyz|so|sh|net|org|tech|us|me)$/, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** The slugs an Ashby board for this company might plausibly live at. */
export function ycCandidates(company) {
  const out = new Set();
  for (const field of ['slug', 'name', 'website']) {
    const s = slugify(company?.[field]);
    if (s.length >= 2 && s.length <= 50) out.add(s);
  }
  return out;
}

/**
 * Every YC company, turned into candidate slugs.
 * @param {(msg: string) => void} [log]
 */
export async function fromYCombinator(log = () => {}) {
  const slugs = new Set();
  let page = 1, empties = 0;

  // Paced deliberately: eight concurrent requests with no delay returned 874 of
  // 6,224 companies and silently dropped the rest, with no error to notice.
  while (page <= 400 && empties < 3) {
    let batch;
    try {
      const r = await fetch(`${YC_API}?page=${page}`, { signal: AbortSignal.timeout(20_000) });
      if (!r.ok) { await sleep(1500); page++; continue; }
      batch = (await r.json()).companies ?? [];
    } catch { await sleep(1500); page++; continue; }

    if (!batch.length) { empties++; } else { empties = 0; }
    for (const c of batch) for (const s of ycCandidates(c)) slugs.add(s);
    if (page % 40 === 0) log(`  yc page ${page}: ${slugs.size} candidate slugs`);
    page++;
    await sleep(120);
  }
  log(`  yc: ${slugs.size} candidate slugs from the directory`);
  return slugs;
}

// ---- Greenhouse ----------------------------------------------------------
//
// Same method as Ashby, over two hosts: boards.greenhouse.io is the older one and
// still serves, job-boards.greenhouse.io is current. Both are in the archive and
// they do not fully overlap, so both are pulled.
//
// Measured 2026-09-15: 1.19M archived urls across the two, 12,987 distinct board
// tokens, 53% of a 200-token sample live, averaging 28.9 postings each.

const GREENHOUSE_HOST = /(^|\.)greenhouse\.io$/i;
const GREENHOUSE_HOSTS = ['job-boards.greenhouse.io', 'boards.greenhouse.io'];

/**
 * Greenhouse board tokens from the Wayback URL index.
 * @param {(msg: string) => void} [log]
 */
export async function greenhouseFromWayback(log = () => {}) {
  const slugs = new Set();

  for (const host of GREENHOUSE_HOSTS) {
    // The trailing /* matters: `host*` matched almost nothing, `host/*` returned
    // 668,942 urls for the same host. Easy to write the first and conclude wrongly
    // that the source is empty.
    const url = `${CDX}?url=${encodeURIComponent(host)}%2F*&output=text&fl=original`
              + `&collapse=urlkey&filter=statuscode:200`;

    let text = null;
    for (let attempt = 0; attempt < 4 && text === null; attempt++) {
      if (attempt) { log(`  retrying ${host} in ${15 * attempt}s`); await sleep(15_000 * attempt); }
      log(`  asking the Wayback index for ${host} (large, a few minutes)`);
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(420_000) });
        if (r.ok) { text = await r.text(); break; }
        log(`  ${host}: ${r.status}`);
      } catch (e) { log(`  ${host} failed (${e.message})`); }
    }
    if (text === null) { log(`  ${host} unreachable, skipping`); continue; }

    const before = slugs.size;
    for (const s of slugsFromCdx(text, GREENHOUSE_HOST)) slugs.add(s);
    log(`  ${host}: ${text.split('\n').length} urls → ${slugs.size - before} new tokens`);
  }
  return slugs;
}
