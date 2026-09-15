// Judge staged postings against the resume and context.md — should you apply.
//
//   npm run fitness              judge anything in fresh.jsonl not judged before
//   npm run fitness -- --dry     report what would be judged, call nothing
//   npm run fitness -- --force   re-judge even what has been judged before
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
import { ask, context, MODEL } from '../lib/ai.js';
import { resumeBlock } from '../lib/resume.js';
import { progress } from '../lib/progress.js';

const BATCH = 8;
const FORCE = process.argv.includes('--force');
const DRY   = process.argv.includes('--dry');

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
if (!jobs.length) { console.log('nothing to do'); process.exit(0); }
if (DRY) { console.log('--dry, nothing called'); process.exit(0); }

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
for (let i = 0; i < jobs.length; i += BATCH) {
  const batch = jobs.slice(i, i + BATCH);
  const user = batch.map((j, k) => {
    const pay = j.salary ? j.salary.summary : 'not stated';
    return `<posting index="${i + k}">
title: ${j.title}
company (ashby slug): ${j.slug}
team: ${j.department ?? '?'} / ${j.team ?? '?'}
location: ${j.location} | also: ${j.secondaryLocations || 'none'} | remote: ${j.isRemote}
type: ${j.employmentType}
posted: ${j.publishedAt}
stated pay: ${pay}

${(j.descriptionPlain || '(no description)').slice(0, 7000)}
</posting>`;
  }).join('\n\n');

  const { results } = await ask(SYSTEM, user, { schema: Scored, maxTokens: 8000, documents: [RESUME] });

  for (const r of results) {
    const j = jobs[r.index];
    if (!j) { console.warn(`  ! model returned index ${r.index}, no such posting — dropped`); continue; }
    out.push({
      ...r,
      id: j.id, title: j.title, slug: j.slug,
      location: j.location, salary: j.salary,
      jobUrl: j.jobUrl, applyUrl: j.applyUrl,
      scoredAt: new Date().toISOString(), model: MODEL,
    });
  }
  const got = new Set(results.map(r => r.index));
  for (let k = 0; k < batch.length; k++) {
    if (!got.has(i + k)) console.warn(`\n  ! no result for "${batch[k].title}" — not scored`);
  }
  bar.tick(batch.length);
}
bar.finish();

const read = f => fs.existsSync(f)
  ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  : [];

// fitness.jsonl is the permanent log: append-only, one line per scoring event,
// re-scores included. Nothing here queues anything — queue.jsonl is written only
// when you pick a posting in the UI, so a score can never put an application in
// front of you that you did not choose.
fs.appendFileSync(P.fitness, out.map(r => JSON.stringify(r)).join('\n') + (out.length ? '\n' : ''));
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
