// Judge staged postings against the resume and context.md — should you apply.
//
//   npm run fitness              judge anything in fresh.jsonl not judged before
//   npm run fitness -- --dry     report what would be judged, call nothing
//   npm run fitness -- --force   re-judge even what has been judged before
//   npm run fitness -- --batch   send it through the Batch API at half price
//
// --batch is the same requests, asynchronously: results arrive within 24 hours
// (usually well under one) instead of seconds, and every token costs 50% less,
// cache reads included. Nothing waits on a scoring run.
//
// One of three scorers over the same worklist. It does not consume fresh.jsonl:
// coverage.js reads it too, and truncating here used to leave coverage nothing to
// do whenever fitness happened to run first.
//
// Postings are referenced by array index, not id: the model echoing a 36-char
// UUID back is a chance to hallucinate one, and a wrong id silently drops a job.

import fs from 'node:fs';
import { P } from '../lib/paths.js';
import { z } from 'zod';
import { ask, askBatch, parseBatchResult, context, MODEL, preflight, effortFlag, thinkFlag } from '../lib/ai.js';
import { resumeBlock } from '../lib/resume.js';
import { progress } from '../lib/progress.js';
import { pool, jobsFlag } from '../lib/pool.js';
import { completeBatch } from '../lib/batch.js';
import { isAuthError } from '../lib/keys.js';
import { appendRows } from '../lib/jsonl.js';

const BATCH = 8;
const FORCE = process.argv.includes('--force');
const DRY   = process.argv.includes('--dry');
const JOBS  = jobsFlag(process.argv);
const USE_BATCH = process.argv.includes('--batch');
// How hard the model works. Two knobs, because the models split on which they take:
// Sonnet, Opus and Fable think adaptively and are steered by --effort; Haiku 4.5
// does not think at all unless given an explicit --think budget. Measured over the
// same 30 postings, Haiku with no thinking put 20 of them into one 0.2-wide band
// where Sonnet used the whole range. Both parsers live in lib so they can be tested.
//
// low, not high, because it was measured rather than assumed. Scoring the same 30
// postings at each: low agrees with high at rho 0.919 and 0.093 mean absolute
// difference — against a noise floor of rho 0.953 and 0.053, which is how much
// Sonnet at high disagrees with ITS OWN previous run on the same input. It holds the
// spread (sd 0.236 vs 0.234) and still puts the robotics and wet-lab postings at the
// bottom, for 62% fewer output tokens. Pass --effort high when a run deserves it.
let EFFORT, THINK;
try {
  EFFORT = effortFlag(process.argv, 'low');
  THINK = thinkFlag(process.argv);
} catch (e) { console.error(e.message); process.exit(1); }

const readJsonl = f => fs.existsSync(f)
  ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
  : [];

if (!fs.existsSync(P.fresh)) { console.log('no fresh.jsonl — run: npm run poll'); process.exit(0); }
const staged = readJsonl(P.fresh);
if (!staged.length) { console.log('fresh.jsonl is empty — run: npm run poll'); process.exit(0); }

// Skip what has already been judged. fresh.jsonl is a worklist that coverage.js
// reads too, so this must not consume it — and being idempotent is what lets the
// three scorers run in any order without stranding each other's work.
const already = new Set(readJsonl(P.fitness).map(r => r.id));
const jobs = FORCE ? staged : staged.filter(j => !already.has(j.id));

console.log(`${staged.length} staged · ${staged.length - jobs.length} already judged · ${jobs.length} to judge`);
// Which model and how hard it worked, because both are now flags and the bill
// differs by 4x across them. coverage.js prints its two models for the same reason.
console.log(`  ${MODEL} · effort ${EFFORT}${THINK == null ? '' : ` · thinking ${THINK}`}`);
if (!jobs.length) { console.log('nothing to do'); process.exit(0); }
if (DRY) { console.log('--dry, nothing called'); process.exit(0); }

// Once, before any work — see coverage.js.
try { preflight(); } catch (e) { console.error(`
${e.message}`); process.exit(1); }

const Scored = z.object({
  results: z.array(z.object({
    index:       z.number().int().describe('the index attribute of the posting this scores'),
    fitness:     z.number().min(0).max(1),
    pay_ok:      z.string().describe('exactly one of: yes, no, not_stated'),
    location_ok: z.boolean(),
    why:         z.string().describe('one sentence, concrete, names the actual overlap or mismatch'),
    concerns:    z.array(z.string()),
  })),
});

const RESUME = resumeBlock();

const SYSTEM = `You rate how well job postings fit one candidate. Their resume is attached as a
document, and additional context follows below.

Score honestly — a queue full of 0.8s is useless. Reserve >=0.8 for postings where the
candidate's specific, demonstrated experience is what the posting asks for. Score down for
seniority mismatch, a stack the candidate has never touched, and domains the context says
they do not want. Ignore generic startup boilerplate.

You are ranking, not deciding. The candidate chooses what to apply to; your job is an
honest score and a reason they can act on.

Rules:
- pay_ok="not_stated" when the posting states no range; do not guess from the company.
- location_ok reflects the candidate's stated location constraints, not a general preference for remote.
- "why" must name the actual overlap or the actual mismatch. "Strong fit for the role" is not an answer.
- Return one result per posting, using the index attribute given on each posting.

<candidate_context>
${context()}
</candidate_context>`;

const out = [];
const bar = progress(jobs.length, 'judging');

// Postings are grouped BATCH to a request, and the requests then run a few at a
// time. Sequentially this was ~40s per request — 40 minutes for 477 postings,
// almost all of it waiting on one round trip at a time.
const groups = [];
for (let i = 0; i < jobs.length; i += BATCH) groups.push(i);

const describe = (j, index) => {
  const pay = j.salary ? j.salary.summary : 'not stated';
  return `<posting index="${index}">
title: ${j.title}
company (ashby slug): ${j.slug}
team: ${j.department ?? '?'} / ${j.team ?? '?'}
location: ${j.location} | also: ${j.secondaryLocations || 'none'} | remote: ${j.isRemote}
type: ${j.employmentType}
posted: ${j.publishedAt}
stated pay: ${pay}

${(j.descriptionPlain || '(no description)').slice(0, 7000)}
</posting>`;
};

// Shared by both paths, so a score looks the same however it was obtained.
const rowsFrom = (results) => {
  const rows = [];
  for (const r of results) {
    const j = jobs[r.index];
    if (!j) { console.warn(`  ! model returned index ${r.index}, no such posting — dropped`); continue; }
    rows.push({
      ...r,
      id: j.id, title: j.title, slug: j.slug,
      location: j.location, salary: j.salary,
      jobUrl: j.jobUrl, applyUrl: j.applyUrl,
      scoredAt: new Date().toISOString(), model: MODEL,
    });
  }
  return rows;
};

if (USE_BATCH) {
  // One request per group of BATCH postings, built exactly as the sync path builds
  // them, so the prompt and the cached prefix are identical either way.
  const reqs = groups.map(i => ({
    system: SYSTEM,
    user: jobs.slice(i, i + BATCH).map((_, k) => describe(jobs[i + k], i + k)).join('\n\n'),
  }));

  const results = await askBatch(reqs, {
    schema: Scored, maxTokens: 8000, documents: [RESUME], thinkBudget: THINK, effort: EFFORT,
    label: 'fitness', itemsPer: BATCH, model: MODEL,
    onProgress: (done) => bar.set(Math.min(done * BATCH, jobs.length)),
  });
  bar.finish();

  let failed = 0;
  for (const [gi, i] of groups.entries()) {
    const parsed = parseBatchResult(results.get(gi), Scored);
    if (!parsed.ok) {
      const size = Math.min(BATCH, jobs.length - i);
      console.warn(`  ! a group of ${size} failed: ${parsed.error}`);
      failed += size;
      continue;
    }
    // Written per group, for the same reason the sync path does: a run that stops
    // part way keeps what it already paid for.
    const rows = rowsFrom(parsed.value.results);
    appendRows(P.fitness, rows);
    out.push(...rows);
  }
  if (failed) console.warn(`  ${failed} postings were in groups that failed — re-run to retry them`);
} else {

const outcomes = await pool(groups, async (i) => {
  const batch = jobs.slice(i, i + BATCH);
  const want = batch.map((_, k) => i + k);

  // Structured output guarantees the SHAPE of the reply, not that it covers every
  // posting asked about. A batch of 8 coming back with 7 results used to leave the
  // 8th silently unscored — 1.9% of postings on a real run. Ask again for the gaps.
  const { results, missing } = await completeBatch(want, async (indices) => {
    const user = indices.map(ix => describe(jobs[ix], ix)).join('\n\n');
    const { results } = await ask(SYSTEM, user, { schema: Scored, maxTokens: 8000, documents: [RESUME],
      thinkBudget: THINK, effort: EFFORT, label: 'fitness', items: indices.length });
    return results;
  });

  const rows = rowsFrom(results);
  for (const ix of missing) {
    console.warn(`\n  ! no result for "${jobs[ix].title}" after a retry — not scored`);
  }
  // Written as the batch lands, not banked until the end. fitness.jsonl is
  // append-only and every reader keys by id or scoredAt, so the order of the file
  // was never load-bearing — banking it only meant that Ctrl-C, a crash or a killed
  // terminal threw away everything already scored and paid for.
  appendRows(P.fitness, rows);

  // Ticked here rather than in onDone: a group is BATCH postings, and the bar
  // counts postings, so the caller is the only place that knows the size.
  bar.tick(batch.length);
  return rows;
}, {
  limit: JOBS,
  // The first request writes the prompt cache (context.md + the resume PDF) and
  // the rest read it. Opening at full width makes the whole first wave miss, and
  // each one pays the write premium instead of one paying it.
  warmup: true,
  // One bad key is the same answer for every posting; stop rather than repeat it.
  stopOn: isAuthError,
});

if (outcomes.stopped) {
  bar.finish();
  console.error(`
  stopped: ${outcomes.stopped.message}`);
  console.error('  nothing further was attempted. Fix the key and re-run.');
}

// Already on disk by now; this is only for the report below.
for (const [gi, o] of outcomes.entries()) {
  if (o.ok) { out.push(...o.value); continue; }
  const size = Math.min(BATCH, jobs.length - groups[gi]);
  console.warn(`\n  ! a batch of ${size} failed: ${o.error.message}`);
  bar.tick(size);   // a failed batch never ticked itself
}
bar.finish();

}   // end of the synchronous path

const read = f => fs.existsSync(f)
  ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  : [];

// fitness.jsonl is the permanent log: append-only, one line per scoring event,
// re-scores included — written per batch above, not here. Nothing queues anything;
// queue.jsonl is written only when you pick a posting in the UI, so a score can
// never put an application in front of you that you did not choose.
//
// fresh.jsonl is a worklist, not a queue to drain. Truncating it here meant that
// running fitness before coverage left coverage nothing to do, silently.

out.sort((a, b) => b.fitness - a.fitness);
const queued  = new Set(read(P.queue).map(r => r.id));
const applied = new Set(read(P.log).map(r => r.job));

console.log(`\n${out.length} scored\n`);
for (const r of out) {
  const pay = r.pay_ok === 'not_stated' ? 'pay not stated' : r.salary?.summary ?? r.pay_ok;
  const mark = applied.has(r.id) ? ' [applied]' : queued.has(r.id) ? ' [queued]' : '';
  console.log(`  ${r.fitness.toFixed(2)}  ${r.title} — ${r.slug}  (${pay})${mark}`);
  console.log(`        ${r.why}`);
  if (r.concerns.length) console.log(`        concerns: ${r.concerns.join('; ')}`);
}
console.log(`\nPick what to apply to:  npm run ui`);
