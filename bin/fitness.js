// Stage 2 — judge fresh postings against the resume and context.md.
//
//   node fitness.js          judge everything in fresh.jsonl
//   node fitness.js --keep   do not truncate fresh.jsonl afterwards (for re-runs)
//
// Postings are referenced by array index, not id: the model echoing a 36-char
// UUID back is a chance to hallucinate one, and a wrong id silently drops a job.

import fs from 'node:fs';
import { P } from '../lib/paths.js';
import { z } from 'zod';
import { ask, context, MODEL } from '../lib/ai.js';
import { resumeBlock } from '../lib/resume.js';

const BATCH = 8;
const KEEP      = process.argv.includes('--keep');

if (!fs.existsSync(P.fresh)) { console.log('no fresh.jsonl — run poll.js first'); process.exit(0); }
const jobs = fs.readFileSync(P.fresh, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
if (!jobs.length) { console.log('fresh.jsonl is empty — nothing to score'); process.exit(0); }

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

  process.stderr.write(`scoring ${i + 1}-${Math.min(i + BATCH, jobs.length)} of ${jobs.length}...\n`);
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
    if (!got.has(i + k)) console.warn(`  ! no result for "${batch[k].title}" — not scored, stays unqueued`);
  }
}

const read = f => fs.existsSync(f)
  ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  : [];

// fitness.jsonl is the permanent log: append-only, one line per scoring event,
// re-scores included. Nothing here queues anything — queue.jsonl is written only
// when you pick a posting in the UI, so a score can never put an application in
// front of you that you did not choose.
fs.appendFileSync(P.fitness, out.map(r => JSON.stringify(r)).join('\n') + (out.length ? '\n' : ''));
if (!KEEP) fs.writeFileSync(P.fresh, '');

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
