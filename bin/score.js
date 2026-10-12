// The scorer: two questions about each staged posting, asked of Jev.
//
//   npm run score              score everything staged in fresh.jsonl
//   npm run score -- --dry     price it, call nothing
//   npm run score -- --limit 20
//   npm run score -- --force   ask again even if answered
//   npm run score -- --rescore ask again for every posting ever scored whose answer
//                              is to an older version of the questions
//   npm run score -- --jobs 6  requests at once (default 6)
//
// One Jev request per posting: its title, company and whole description, and the
// resume, with two yes/no questions — qualified (resume → role, stored as `fitness`)
// and aligned (role → resume, stored as `alignment`). value is the geometric mean of
// both (scaled) and freshness. See lib/jev-fitness.js.
//
// This was bin/fitness.js, the `fitness` npm script, until 2026-10-12. The data keeps
// the old name — jev-fitness.jsonl — because renaming it would orphan every answer.

import fs from 'node:fs';
import { P } from '../lib/paths.js';
import { corpus, hash, linesOf } from '../lib/corpus.js';
import { describe } from '../lib/descriptions.js';
import { resumeText } from '../lib/resume-text.js';
import { progress } from '../lib/progress.js';
import { pool, jobsFlag } from '../lib/pool.js';
import { isFatal, requireKey } from '../lib/keys.js';
import { appendRows } from '../lib/jsonl.js';
import { jevAsk } from '../lib/jev.js';
import { fitnessRequest, worklistWork, rescoreWork, fitnessRow } from '../lib/jev-fitness.js';
import '../lib/ai.js';            // loads .env with override, so a stale shell variable cannot win

const argv    = process.argv.slice(2);
const DRY     = argv.includes('--dry');
const FORCE   = argv.includes('--force');
const RESCORE = argv.includes('--rescore');
const LIMIT   = argv.includes('--limit') ? Number(argv[argv.indexOf('--limit') + 1]) : Infinity;
const JOBS    = jobsFlag(argv);

// Jev bills input tokens only, $0.042 per million.
const USD_PER_TOKEN = 0.042 / 1e6;

const rowsOf = f => {
  if (!fs.existsSync(f)) return [];
  const out = [];
  for (const l of linesOf(f)) { try { out.push(JSON.parse(l)); } catch {} }
  return out;
};

const resume = await resumeText();
const resumeHash = hash(resume);
const done = rowsOf(P.jevFitness);

// The worklist is fresh.jsonl, like any scorer's. --rescore instead walks every
// posting already scored, from the corpus. Either way the text comes from
// descriptions.jsonl, one posting at a time — the worklist carries none.
const { work, blank, reuse } = RESCORE
  ? rescoreWork(done, corpus(), resumeHash, { hash, force: FORCE, describe })
  : worklistWork(rowsOf(P.fresh), done, resumeHash, { hash, force: FORCE, describe });
const todo = work.slice(0, LIMIT);

const chars = todo.reduce((n, w) => n + Math.min(w.chars, 60_000) + resume.length, 0);
const tokens = Math.round(chars / 4) + todo.length * 150;
console.log(`${work.length} posting${work.length === 1 ? '' : 's'} to score` +
  (RESCORE ? ' again (older answers)' : ' from fresh.jsonl') +
  (blank.length ? ` · ${blank.length} skipped, no description` : ''));
console.log(`  asking ${todo.length} · about ${tokens.toLocaleString()} tokens, $${(tokens * USD_PER_TOKEN).toFixed(4)}`);
if (reuse.length) console.log(`  re-listed, copied free: ${reuse.length}`);
if (DRY) { console.log('\n--dry, nothing called'); process.exit(0); }

// Re-listings: same description under a new id. The answer is copied, not paid for —
// and before the exit below, because a run whose only work is this still has work.
// Without the copy, finished() (which looks postings up by id) never sees them.
if (reuse.length) appendRows(P.jevFitness, reuse);
if (!todo.length) { console.log('\nnothing to do'); process.exit(0); }

// Once, before any work: a bad key is the same answer for every posting.
try { requireKey('JEV_API_KEY'); } catch (e) { console.error(`\n${e.message}`); process.exit(1); }

let spent = 0, scored = 0;
const bar = progress(todo.length, 'fitness');
const results = await pool(todo, async (w) => {
  // Read again here rather than held from the split: 225,000 of them is ~2.5 GB.
  const { state, questions } = fitnessRequest({ ...w.posting, descriptionPlain: describe(w.posting) }, resume);
  const res = await jevAsk({ state, questions });
  spent += res.usage?.input_tokens ?? 0;
  // Written as it lands: an interrupted run keeps every answer it paid for.
  appendRows(P.jevFitness, [fitnessRow(w, resumeHash, res)]);
  scored++;
}, { limit: JOBS, onDone: () => bar.tick(), stopOn: isFatal });

if (results.stopped) {
  // Left where it stopped, rather than a full bar claiming work that never happened.
  process.stderr.write('\n');
  console.error(`stopped after ${scored} of ${todo.length}: ${results.stopped.message}`);
  process.exit(1);
}
bar.finish();
const failed = results.filter(r => r && !r.ok);
console.log(`${scored} scored · ${spent.toLocaleString()} Jev input tokens, $${(spent * USD_PER_TOKEN).toFixed(4)}` +
  (failed.length ? ` · ${failed.length} failed: ${failed[0].error.message}` : ''));
