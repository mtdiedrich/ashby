// Stage 0 — validate candidate slugs and merge them into slugs.txt.
//
//   npm run harvest                 validate raw.txt + re-check slugs.txt
//   npm run harvest -- --discover   pull candidates off Hacker News and GitHub
//   npm run harvest -- --hn         Hacker News only
//   npm run harvest -- --github     GitHub code search only
//   npm run harvest -- --no-recheck skip re-validating slugs already in slugs.txt
//   npm run harvest -- <file>       validate a specific file (repeatable)
//
// A slug is the first path segment of jobs.ashbyhq.com/{slug}/...
// Slugs are case-insensitive on Ashby's side, so everything is lowercased before
// dedupe — otherwise "Ramp" and "ramp" both validate and you poll the board twice.
// A live board with no current openings returns 200 {"jobs":[]}; that is still a
// valid slug and is kept (they post again later).

import fs from 'node:fs';
import { fromHackerNews, fromGitHub } from '../lib/discover.js';
import { P } from '../lib/paths.js';

const CONCURRENCY = 12;
const args     = process.argv.slice(2);
const recheck  = !args.includes('--no-recheck');
const useHn    = args.includes('--hn');
const useGh    = args.includes('--github');
const useAll   = args.includes('--discover');
const files    = args.filter(a => !a.startsWith('--'));
const sources  = files.length ? files : [P.raw];

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

const existing = new Set(read(P.slugs).map(normalise).filter(Boolean));
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

const toCheck = recheck ? new Set([...existing, ...incoming])
                        : new Set([...incoming].filter(s => !existing.has(s)));

console.log(`${existing.size} known, ${incoming.size} candidates → ${toCheck.size} to validate`);

const live = recheck ? new Set() : new Set(existing);
const deadList = [];
let done = 0;

async function check(slug) {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (r.status === 429) { await new Promise(z => setTimeout(z, 2000 * (attempt + 1))); continue; }
      if (r.ok) {
        const { jobs = [] } = await r.json();
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

fs.writeFileSync(P.slugs, [...live].sort().join('\n') + '\n');
if (deadList.length) fs.writeFileSync(P.dead, deadList.sort().join('\n') + '\n');

const added = [...live].filter(s => !existing.has(s)).length;
console.log(`\nslugs.txt: ${live.size} live boards (${added} new). ${deadList.length} dead → dead.txt`);
