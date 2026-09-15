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
