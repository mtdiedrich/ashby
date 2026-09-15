// Requirement coverage scoring.
//
//   node coverage.js              score everything in fresh.jsonl
//   node coverage.js --dry        price it, call nothing
//   node coverage.js --limit 20   first N only
//   node coverage.js --force      recompute even if cached
//   node coverage.js --scorer opus   use claude-opus-5 for the scoring half
//   node coverage.js --show       print what is already computed, call nothing
//
// Two passes, deliberately separate:
//
//   1. Extract the discrete requirements from the job description. This does not
//      involve the candidate at all, so it is cached against a hash of the posting
//      text and survives every resume edit. Haiku does this well — it is reading
//      comprehension, not judgement.
//
//   2. Score each requirement against the resume, 0-3, with the evidence quoted.
//      Cached against posting hash + resume hash together, so changing either one
//      invalidates only what it should.
//
// The headline number weights required requirements above preferred ones; a plain
// unweighted mean is recorded alongside it, because "nice to have Kubernetes" and
// "must have five years of production ML" are not the same fact.
//
// Logistics requirements ("onsite 3 days in SF") are extracted but kept out of the
// average and reported separately — a resume cannot demonstrate willingness to be
// somewhere, so scoring it against one only ever subtracts.

import fs from 'node:fs';
import { P } from '../lib/paths.js';
import { z } from 'zod';
import { ask, context, preflight } from '../lib/ai.js';
import { hash } from '../lib/corpus.js';
import { resumeText } from '../lib/resume-text.js';
import { progress } from '../lib/progress.js';
import { pool, jobsFlag } from '../lib/pool.js';
import { isAuthError } from '../lib/keys.js';

const argv    = process.argv.slice(2);
const DRY     = argv.includes('--dry');
const FORCE   = argv.includes('--force');
const SHOW    = argv.includes('--show');
const LIMIT   = argv.includes('--limit') ? Number(argv[argv.indexOf('--limit') + 1]) : Infinity;
const SCORER  = argv.includes('--scorer')
  ? ({ opus: 'claude-opus-5', sonnet: 'claude-sonnet-5', haiku: 'claude-haiku-4-5' }[argv[argv.indexOf('--scorer') + 1]] ?? argv[argv.indexOf('--scorer') + 1])
  : 'claude-haiku-4-5';
const EXTRACTOR = 'claude-haiku-4-5';
const JOBS    = jobsFlag(argv);

// Required requirements carry full weight; preferred ones count, but less.
const PREFERRED_WEIGHT = 0.4;
const MAX_POINTS = 3;

const read = f => fs.existsSync(f)
  ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
  : [];

const newestBy = (rows, key) => {
  const m = new Map();
  for (const r of rows) {
    const prev = m.get(r[key]);
    if (!prev || (r.at ?? '') >= (prev.at ?? '')) m.set(r[key], r);
  }
  return m;
};

// ---- schemas -----------------------------------------------------------

const Requirements = z.object({
  requirements: z.array(z.object({
    text: z.string().describe('the requirement, in a dozen words or fewer, as the posting means it'),
    kind: z.string().describe('one of: skill, experience, domain, credential, logistics'),
    required: z.boolean().describe('true for a must-have, false for preferred/nice-to-have'),
  })).describe('the checkable requirements, most important first'),
});

const Assessment = z.object({
  scores: z.array(z.object({
    index: z.number().int().describe('index of the requirement being scored'),
    score: z.number().int().describe('0, 1, 2 or 3'),
    evidence: z.string().describe('the specific thing in the resume that supports this, or "none"'),
  })),
});

// ---- prompts -----------------------------------------------------------

const EXTRACT_SYSTEM = `Extract the checkable requirements from a job posting.

A requirement is something a specific candidate either does or does not demonstrably
have. Keep:
  - concrete skills and technologies ("PyTorch", "Kubernetes in production")
  - experience with scale, depth or duration ("5+ years backend", "models serving >1k QPS")
  - domain experience ("healthcare", "ads ranking", "speech")
  - credentials and authorisation ("security clearance", "PhD", "US work authorisation")
  - logistics that gate the role ("onsite 3 days in SF", "on-call rotation")

Drop everything that is not checkable against a resume: company mission, benefits,
salary, equal-opportunity boilerplate, "you are curious and driven", team culture.

Mark required=true only when the posting presents it as a must-have. Requirements under
a "nice to have", "bonus", or "preferred" heading are required=false.

Merge near-duplicates. At most 12, most important first. Fewer is fine — a short posting
has few real requirements, and inventing them makes the score meaningless.`;

const scoreSystem = (resume) => `Score how well one candidate's resume satisfies each requirement.

Use this scale, and use the whole of it:
  3 - direct, demonstrated evidence at the depth or scale asked for
  2 - partial: real evidence, but less depth, scale, or recency than asked
  1 - adjacent: related work that a generous reader would count, but not this
  0 - no evidence in the resume

Rules:
- Judge only from the resume below. Do not infer from the candidate's job titles what
  they "probably" did, and do not give credit for a technology merely listed in a
  skills section if nothing shows them using it.
- "evidence" quotes or paraphrases the specific line that supports the score. If the
  score is 0, evidence is "none".
- Being generous makes the whole score useless. A 3 should mean the candidate would
  survive an interview on that point.
- Return one entry per requirement, using the index given.

<resume>
${resume}
</resume>`;

// ---- load --------------------------------------------------------------

const jobs = read(P.fresh).slice(0, LIMIT);
if (!jobs.length && !SHOW) { console.log('fresh.jsonl is empty — run: npm run poll'); process.exit(0); }

const reqCache = newestBy(read(P.requirements), 'jdHash');
const covCache = newestBy(read(P.coverage), 'key');

if (SHOW) {
  const rows = [...covCache.values()].sort((a, b) => b.coverage - a.coverage);
  if (!rows.length) { console.log('nothing computed yet'); process.exit(0); }
  for (const r of rows) {
    console.log(`${r.coverage.toFixed(2)}  ${r.title.slice(0, 48).padEnd(49)}${r.slug.padEnd(14)}` +
      `${r.met}/${r.total} met`);
  }
  console.log(`\n${rows.length} scored · coverage is the weighted mean over requirements`);
  process.exit(0);
}

const resume = await resumeText();
const resumeHash = hash(resume);

const jdText = j => [j.title, j.slug, j.location, j.descriptionPlain].filter(Boolean).join('\n\n');

const work = jobs.map(j => {
  const jdHash = hash(jdText(j));
  return { j, jdHash, key: `${jdHash}:${resumeHash}` };
});

const needExtract = work.filter(w => FORCE || !reqCache.has(w.jdHash));
const needScore   = work.filter(w => FORCE || !covCache.has(w.key));

console.log(`${jobs.length} postings in fresh.jsonl`);
console.log(`  requirements to extract: ${needExtract.length}  (${work.length - needExtract.length} cached)`);
console.log(`  fitness to score:        ${needScore.length}  (${work.length - needScore.length} cached)`);
console.log(`  extractor: ${EXTRACTOR} · scorer: ${SCORER}`);

if (DRY) { console.log('\n--dry, nothing called'); process.exit(0); }

// Once, before any work. A bad key is the same answer for all 1,396 postings, and
// discovering that per posting produced 1,396 identical lines and a full progress bar.
try { preflight(); } catch (e) { console.error(`\n${e.message}`); process.exit(1); }
if (!needExtract.length && !needScore.length) { console.log('\nnothing to do'); process.exit(0); }

// ---- pass 1: requirements ----------------------------------------------

const exBar = needExtract.length ? progress(needExtract.length, 'requirements') : null;
const extracted = await pool(needExtract, async (w) => {
  const { requirements } = await ask(
    EXTRACT_SYSTEM,
    `<posting>\n${jdText(w.j).slice(0, 14000)}\n</posting>`,
    { schema: Requirements, maxTokens: 3000, effort: 'low', model: EXTRACTOR },
  );
  const row = { jdHash: w.jdHash, id: w.j.id, title: w.j.title, slug: w.j.slug,
                requirements, model: EXTRACTOR, at: new Date().toISOString() };
  // appendFileSync from concurrent workers is safe: it is one synchronous syscall
  // on a single-threaded runtime, so two lines cannot interleave.
  fs.appendFileSync(P.requirements, JSON.stringify(row) + '\n');
  reqCache.set(w.jdHash, row);
}, { limit: JOBS, warmup: true, onDone: () => exBar?.tick(), stopOn: isAuthError });
exBar?.finish();

// Every call carries the same key. Printing 1,396 identical 401s and then "0 scored"
// is not a report — it is noise with the answer buried at the end of it.
if (extracted.stopped) {
  console.error(`\nstopped: ${extracted.stopped.message}`);
  console.error('nothing further was attempted. Fix the key and re-run.');
  process.exit(1);
}
for (const [k, r] of extracted.entries()) {
  if (!r.ok) console.warn(`  ! ${needExtract[k].j.title}: ${r.error.message}`);
}

// ---- pass 2: score each requirement ------------------------------------

const SCORE_SYSTEM = scoreSystem(resume);
const results = [];

const scBar = needScore.length ? progress(needScore.length, 'coverage') : null;
const scored = await pool(needScore, async (w) => {
  const reqs = reqCache.get(w.jdHash)?.requirements;
  // Nothing extracted for this posting, so there is nothing to score against.
  if (!reqs?.length) return null;

  const { scores } = await ask(
    SCORE_SYSTEM, `<role>${w.j.title} at ${w.j.slug}</role>\n<requirements>\n` +
      reqs.map((r, k) => `${k}. [${r.required ? 'required' : 'preferred'}] ${r.text}`).join('\n') +
      `\n</requirements>`,
    { schema: Assessment, maxTokens: 4000, effort: 'low', model: SCORER },
  );

  const byIndex = new Map(scores.map(s => [s.index, s]));
  const detail = reqs.map((r, k) => {
    const s = byIndex.get(k);
    return {
      ...r,
      score: Math.max(0, Math.min(MAX_POINTS, s?.score ?? 0)),
      evidence: s?.evidence ?? 'not returned',
    };
  });

  // Logistics are not capabilities. "On-site 3 days per week in SF" always scores 0
  // because no resume demonstrates willingness to be somewhere, and counting that as
  // a failed requirement drags fitness down for a question the resume cannot answer.
  // They are reported separately, as things to check against your own constraints.
  const capability = detail.filter(d => d.kind !== 'logistics');
  const constraints = detail.filter(d => d.kind === 'logistics');

  let num = 0, den = 0, met = 0;
  for (const d of capability) {
    const weight = d.required ? 1 : PREFERRED_WEIGHT;
    num += d.score * weight; den += MAX_POINTS * weight;
    if (d.score >= 2) met++;
  }

  const plain = capability.length
    ? capability.reduce((a, d) => a + d.score, 0) / (capability.length * MAX_POINTS)
    : 0;
  const row = {
    key: w.key, jdHash: w.jdHash, resumeHash: resumeHash,
    id: w.j.id, title: w.j.title, slug: w.j.slug,
    applyUrl: w.j.applyUrl, jobUrl: w.j.jobUrl,
    coverage: Number((den ? num / den : 0).toFixed(4)),
    coverageUnweighted: Number(plain.toFixed(4)),
    met, total: capability.length,
    gaps: capability.filter(d => d.required && d.score <= 1).map(d => d.text),
    constraints: constraints.map(d => d.text),
    requirements: detail,
    model: SCORER, at: new Date().toISOString(),
  };
  fs.appendFileSync(P.coverage, JSON.stringify(row) + '\n');
  results.push(row);
}, {
  limit: JOBS,
  // The first call writes the prompt cache (context.md + the resume PDF); the rest
  // read it. Opening at full width would have the whole first wave miss and each
  // pay the write premium.
  warmup: true,
  onDone: () => scBar?.tick(),
  stopOn: isAuthError,
});
scBar?.finish();

if (scored.stopped) {
  console.error(`\nstopped: ${scored.stopped.message}`);
  console.error('nothing further was attempted. Fix the key and re-run.');
  process.exit(1);
}
for (const [k, r] of scored.entries()) {
  if (!r.ok) console.warn(`  ! ${needScore[k].j.title}: ${r.error.message}`);
}

// ---- report ------------------------------------------------------------

results.sort((a, b) => b.coverage - a.coverage);
console.log(`\n${results.length} scored\n`);
for (const r of results) {
  console.log(`  ${r.coverage.toFixed(2)}  ${r.title.slice(0, 46).padEnd(47)}${r.slug.padEnd(14)}${r.met}/${r.total} met`);
  if (r.gaps.length) console.log(`        misses: ${r.gaps.slice(0, 3).join('; ')}`);
  if (r.constraints.length) console.log(`        check:  ${r.constraints.join('; ')}`);
}
console.log(`\nDetail: npm run coverage -- --show   ·   full records in data/coverage.jsonl`);
