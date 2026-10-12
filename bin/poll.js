// Stage 1 — the only thing that talks to the job boards.
//
// Fetches every posting from every board into corpus.jsonl, then stages the ones
// worth scoring into fresh.jsonl. fitness reads from what this stored; it does not
// fetch.
//
//   npm run poll                normal daily run
//   npm run poll -- --no-crawl  select from the corpus as it stands, fetch nothing
//   npm run poll -- --all       ignore the title filter
//   npm run poll -- --anywhere  ignore the location filter
//   npm run poll -- --limit 20  stage at most N
//   npm run poll -- --dry       show what would be staged, write nothing
//
// This used to be a second fetcher with its own filters and its own store. It is not
// any more: crawl.js pulls every board into corpus.jsonl and this picks from it.
//
// "New" is derived, not tracked. A posting is a candidate when nothing has judged it
// (jev-fitness.jsonl), nothing has staged it (fresh.jsonl), and you have
// not dismissed it (dismissed.jsonl). There is no seen.json to drift out of step.

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { P, ensureDirs } from '../lib/paths.js';
import { corpus } from '../lib/corpus.js';
import { candidates, finished } from '../lib/select.js';
import { minimumBase, constraintLines } from '../lib/constraints.js';

const argv    = process.argv.slice(2);
const NOCRAWL = argv.includes('--no-crawl');
const DRY     = argv.includes('--dry');
const ALL     = argv.includes('--all');
const ANYWHERE = argv.includes('--anywhere');
const LIMIT   = argv.includes('--limit') ? Number(argv[argv.indexOf('--limit') + 1]) : Infinity;

// Drop postings older than this many days. 0 disables it.
// Adding boards is when this matters: a newly discovered company arrives with its
// entire back catalogue, and a role open five months is usually evergreen.
const MAX_AGE_DAYS = 0;

ensureDirs();

const read = f => fs.existsSync(f)
  ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
  : [];

if (!NOCRAWL) {
  // Flags that belong to the fetch are forwarded, so `npm run poll -- --jobs 20` and
  // `-- --full` reach crawl.js rather than being silently ignored here.
  const ji = process.argv.indexOf('--jobs');
  const pass = ji >= 0 ? ['--jobs', process.argv[ji + 1]] : [];
  if (process.argv.includes('--full')) pass.push('--full');
  if (argv.includes('--ats')) pass.push('--ats', argv[argv.indexOf('--ats') + 1]);
  const r = spawnSync(process.execPath, [new URL('./crawl.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), ...pass],
    { stdio: 'inherit' });
  if (r.status !== 0) { console.error('crawl failed — selecting from the corpus as it stands'); }
  console.log();
}

const minPay = minimumBase();
console.log(`pay floor: ${minPay ? '$' + minPay.toLocaleString() + '/yr (from context.md)' : 'none'}` +
            (MAX_AGE_DAYS > 0 ? ` · max age: ${MAX_AGE_DAYS}d` : ''));
for (const l of constraintLines()) console.log(`  ${l}`);
console.log();

const store = corpus();

// Finished means scored on every front — Jev's fitness, the only one since
// 2026-10-02. A posting without it is still work, and must stay on the worklist; the
// scorer reads only fresh.jsonl, so dropping it here makes the gap permanent.
const withFitness = new Set(read(P.jevFitness).map(r => r.id));
const done = finished({ fitness: withFitness });
const dismissed = new Set(read(P.dismissed).map(r => r.id));

const picked = candidates(store, {
  done, dismissed,
  us: !ANYWHERE, all: ALL, minPay, maxAgeDays: MAX_AGE_DAYS,
}).slice(0, LIMIT);

// Every front finished() checks is reported. Printing fewer is what once let a
// missing score strand a posting unnoticed.
console.log(`${store.size} in the corpus · ` +
            `${withFitness.size} with fitness · ` +
            `${done.size} finished` +
            (dismissed.size ? ` · ${dismissed.size} dismissed` : ''));
console.log(`${picked.length} posting${picked.length === 1 ? '' : 's'} still to score\n`);

for (const j of picked.slice(0, 40)) {
  console.log(`  ${j.title}  —  ${j.slug}  —  ${j.location}` +
    `${j.salary ? '  —  ' + j.salary.summary : '  —  (no pay stated)'}`);
}
if (picked.length > 40) console.log(`  … and ${picked.length - 40} more`);

if (DRY) { console.log('\n--dry, nothing staged'); process.exit(0); }

// Rewritten, not appended: selection is deterministic, so the worklist is simply
// "what still needs scoring" and re-running poll cannot duplicate anything.
fs.writeFileSync(P.fresh, picked.map(j => JSON.stringify(j)).join('\n') + (picked.length ? '\n' : ''));
console.log(picked.length
  ? `\nfresh.jsonl holds ${picked.length} · next: npm run score`
  : '\nnothing to score');
