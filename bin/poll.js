// Stage 1 — the only thing that talks to the job boards.
//
// Fetches every posting and description from every board into corpus.jsonl and
// descriptions.jsonl, then stages every posting not yet scored into fresh.jsonl.
// fitness reads from what this stored; it does not fetch.
//
//   npm run poll                normal daily run
//   npm run poll -- --no-crawl  select from the corpus as it stands, fetch nothing
//   npm run poll -- --limit 20  stage at most N
//   npm run poll -- --dry       show what would be staged, write nothing
//
// There is no title, location, pay or age filter — dropped on 2026-10-03. Every
// posting is scored, and the board ranks rather than hides.
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
import { corpus, linesOf } from '../lib/corpus.js';
import { candidates, finished } from '../lib/select.js';
import { answeredIds } from '../lib/jev-fitness.js';

const argv    = process.argv.slice(2);
const NOCRAWL = argv.includes('--no-crawl');
const DRY     = argv.includes('--dry');
const LIMIT   = argv.includes('--limit') ? Number(argv[argv.indexOf('--limit') + 1]) : Infinity;

ensureDirs();

const read = f => {
  const out = [];
  for (const l of linesOf(f)) { try { out.push(JSON.parse(l)); } catch {} }
  return out;
};

if (!NOCRAWL) {
  // Flags that belong to the fetch are forwarded, so `npm run poll -- --jobs 20`
  // reaches crawl.js rather than being silently ignored here.
  const ji = process.argv.indexOf('--jobs');
  const pass = ji >= 0 ? ['--jobs', process.argv[ji + 1]] : [];
  if (argv.includes('--ats')) pass.push('--ats', argv[argv.indexOf('--ats') + 1]);
  const r = spawnSync(process.execPath, [new URL('./crawl.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), ...pass],
    { stdio: 'inherit' });
  if (r.status !== 0) { console.error('crawl failed — selecting from the corpus as it stands'); }
  console.log();
}

const store = corpus();

// Finished means scored on every front — Jev's two questions, asked together since
// 2026-10-12. A posting without both is still work, and must stay on the worklist; the
// scorer reads only fresh.jsonl, so dropping it here makes the gap permanent. A
// one-question answer from before then does not count (answeredIds).
const withFitness = answeredIds(read(P.jevFitness));
const done = finished({ fitness: withFitness });
const dismissed = new Set(read(P.dismissed).map(r => r.id));

const picked = candidates(store, { done, dismissed }).slice(0, LIMIT);

// Every front finished() checks is reported. Printing fewer is what once let a
// missing score strand a posting unnoticed.
console.log(`${store.size} in the corpus · ` +
            `${withFitness.size} with both answers · ` +
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
// "what still needs scoring" and re-running poll cannot duplicate anything. Written
// in chunks to a temp file and renamed: 225,000 rows as one string is most of the
// way to Node's maximum string length, and a failure must not leave half a worklist.
{
  const tmp = P.fresh + '.writing';
  const fd = fs.openSync(tmp, 'w');
  try {
    for (let i = 0; i < picked.length; i += 5000) {
      fs.writeSync(fd, picked.slice(i, i + 5000).map(j => JSON.stringify(j) + '\n').join(''));
    }
  } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, P.fresh);
}
console.log(picked.length
  ? `\nfresh.jsonl holds ${picked.length} · next: npm run score`
  : '\nnothing to score');
