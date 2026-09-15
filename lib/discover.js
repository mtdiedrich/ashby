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
