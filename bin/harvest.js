// Stage 0 — validate candidate slugs and merge them into slugs.txt.
//
//   npm run harvest                 validate raw.txt + re-check slugs.txt
//   npm run harvest -- --discover   pull candidates off all three sources
//   npm run harvest -- --hn         Hacker News only
//   npm run harvest -- --github     GitHub code search only
//   npm run harvest -- --wayback    Wayback Machine URL index only (highest yield)
//   npm run harvest -- --commoncrawl Common Crawl URL index only
//   npm run harvest -- --yc          guess slugs from the YC company directory
//   npm run harvest -- --no-recheck skip re-validating slugs already in slugs.txt
//   npm run harvest -- <file>       validate a specific file (repeatable)
//   npm run harvest -- --greenhouse  harvest Greenhouse board tokens instead
//
// --greenhouse switches the whole run to the other ATS: its own discovery source,
// its own validation endpoint, its own slug and dead files. Nothing is shared, so a
// Greenhouse token that happens to match an Ashby slug does not confuse either.
//
// A slug is the first path segment of jobs.ashbyhq.com/{slug}/...
// Slugs are case-insensitive on Ashby's side, so everything is lowercased before
// dedupe — otherwise "Ramp" and "ramp" both validate and you poll the board twice.
// A live board with no current openings returns 200 {"jobs":[]}; that is still a
// valid slug and is kept (they post again later).

import fs from 'node:fs';
import { fromHackerNews, fromGitHub, fromWayback, fromCommonCrawl, fromYCombinator,
         greenhouseFromWayback } from '../lib/discover.js';
import { ATS } from '../lib/ats.js';
import { P } from '../lib/paths.js';

const CONCURRENCY = 12;
const args     = process.argv.slice(2);
const recheck  = !args.includes('--no-recheck');
const useHn    = args.includes('--hn');
const useGh    = args.includes('--github');
const useWb    = args.includes('--wayback');
const useCc    = args.includes('--commoncrawl');
const useYc    = args.includes('--yc');
const useAll   = args.includes('--discover');
const GH       = args.includes('--greenhouse');
const files    = args.filter(a => !a.startsWith('--'));
const sources  = files.length ? files : (GH ? [] : [P.raw]);

// Which ATS this run is for. Everything below reads these rather than hardcoding.
const ats       = GH ? ATS.greenhouse : ATS.ashby;
const slugFile  = GH ? P.ghSlugs : P.slugs;
const deadFile  = GH ? P.ghDead  : P.dead;

const read = f => fs.existsSync(f)
  ? fs.readFileSync(f, 'utf8').split('\n').map(s => s.trim()).filter(Boolean)
  : (console.warn(`(${f} not found, skipping)`), []);

// Accept bare slugs or full URLs pasted straight out of a browser.
const normalise = (s) => {
  s = s.trim();
  if (!s || s.startsWith('#')) return null;
  const m = s.match(/ashbyhq\.com\/([^/?#]+)/i);
  if (m) s = m[1];
  s = s.toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{0,80}$/.test(s) ? s : null;
};

const existing = new Set(read(slugFile).map(normalise).filter(Boolean));
const incoming = new Set(sources.flatMap(read).map(normalise).filter(Boolean));

if (useHn || useAll) {
  // Hacker News "Who is hiring" threads are dense with Ashby apply links, and
  // Algolia indexes every comment behind a public API — no browser, no CAPTCHA.
  console.log('searching Hacker News for Ashby boards...');
  const found = await fromHackerNews(msg => process.stderr.write(msg + '\r'));
  process.stderr.write('\n');
  for (const s of found) { const n = normalise(s); if (n) incoming.add(n); }
  console.log(`  ${found.size} slugs mentioned on HN`);
}

if (useGh || useAll) {
  // ~32k indexed files mention jobs.ashbyhq.com. The search API returns the matching
  // fragment, so the slugs come out of the results without fetching any file.
  console.log('searching GitHub code for Ashby boards (rate limited, a few minutes)...');
  const found = await fromGitHub(msg => process.stderr.write(msg + '   \r'));
  process.stderr.write('\n');
  for (const s of found) { const n = normalise(s); if (n) incoming.add(n); }
  console.log(`  ${found.size} slugs found on GitHub`);
}

if (useWb || useAll) {
  // The only source that finds a board nobody linked to. It returns roughly four
  // times what HN and GitHub manage between them, and contains almost all of theirs.
  console.log('asking the Wayback Machine for every archived Ashby board...');
  const found = await fromWayback(msg => process.stderr.write(msg + '   \r'));
  process.stderr.write('\n');
  for (const s of found) { const n = normalise(s); if (n) incoming.add(n); }
  console.log(`  ${found.size} slugs in the archive`);
}

if (useCc || useAll) {
  // A second crawl, largely a subset of Wayback's — worth one pass, not more.
  console.log('asking Common Crawl for archived Ashby boards...');
  const found = await fromCommonCrawl(msg => process.stderr.write(msg + '   \r'));
  process.stderr.write('\n');
  for (const s of found) { const n = normalise(s); if (n) incoming.add(n); }
  console.log(`  ${found.size} slugs in the crawl indexes`);
}

if (useYc) {
  // Not part of --discover: it is a guess, not a sighting. Every candidate costs a
  // validation request and only about 2.3% are live, so it is opt-in.
  console.log('building candidate slugs from the YC company directory...');
  const found = await fromYCombinator(msg => process.stderr.write(msg + '   \r'));
  process.stderr.write('\n');
  for (const s of found) { const n = normalise(s); if (n) incoming.add(n); }
  console.log(`  ${found.size} candidates to try`);
}

if (GH) {
  // The archive is the only source here. Greenhouse tokens do not appear in HN "who
  // is hiring" comments the way Ashby apply links do — those link to the company's
  // own careers page far more often.
  console.log('asking the Wayback Machine for Greenhouse boards...');
  const found = await greenhouseFromWayback(msg => process.stderr.write(msg + '   \r'));
  process.stderr.write('\n');
  for (const s of found) { const n = normalise(s); if (n) incoming.add(n); }
  console.log(`  ${found.size} board tokens in the archive`);
}

const toCheck = recheck ? new Set([...existing, ...incoming])
                        : new Set([...incoming].filter(s => !existing.has(s)));

console.log(`${existing.size} known, ${incoming.size} candidates → ${toCheck.size} to validate`);

const live = recheck ? new Set() : new Set(existing);
const deadList = [];
let done = 0;

async function check(slug) {
  const url = ats.boardUrl(slug);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (r.status === 429) { await new Promise(z => setTimeout(z, 2000 * (attempt + 1))); continue; }
      if (r.ok) {
        const jobs = ats.postingsFrom(await r.json());
        live.add(slug);
        return `✓ ${slug} (${jobs.length})`;
      }
      deadList.push(slug);
      return null;                                   // 404 — not a board
    } catch {
      if (attempt === 2) { deadList.push(slug); return null; }
      await new Promise(z => setTimeout(z, 1000 * (attempt + 1)));
    }
  }
  return null;
}

const queue = [...toCheck];
const total = queue.length;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) {
    const msg = await check(queue.shift());
    if (++done % 50 === 0) process.stderr.write(`  ${done}/${total}\r`);
    if (msg) console.log(msg);
  }
}));

fs.writeFileSync(slugFile, [...live].sort().join('\n') + '\n');

// Merged with what earlier runs already proved dead, rather than replaced. A
// --no-recheck run only ever sees a slice, and overwriting threw the rest away.
if (deadList.length) {
  const prevDead = read(deadFile).map(normalise).filter(Boolean);
  const dead = [...new Set([...prevDead, ...deadList])].filter(s => !live.has(s)).sort();
  fs.writeFileSync(deadFile, dead.join('\n') + '\n');
}

const added = [...live].filter(s => !existing.has(s)).length;
const name = slugFile.split(/[\\/]/).pop();
console.log(`\n${name}: ${live.size} live ${ats.label} boards (${added} new). ${deadList.length} dead this run`);
