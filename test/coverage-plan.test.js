import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCoverage } from '../lib/coverage-plan.js';

// Two ways a posting could reach coverage, be counted as done, and still never
// acquire a coverage row — both found on a real 100-posting run where 95 finished.
//
// coverage.js caches by jdHash (title + slug + location + description) but stamps
// each row with the posting id, and `finished()` in select.js looks rows up BY ID.
// Everything downstream — the board, poll's worklist — keys by id too. So the two
// disagree exactly when a posting's id changes while its text does not.

const W = (id, jdHash, resumeHash = 'r1') => ({ j: { id, title: `t-${id}` }, jdHash, key: `${jdHash}:${resumeHash}` });

test('a posting with neither requirements nor coverage does both passes', () => {
  const plan = planCoverage({ work: [W('a', 'h1')], reqCache: new Map(), covCache: new Map() });
  assert.deepEqual(plan.needExtract.map(w => w.j.id), ['a']);
  assert.deepEqual(plan.needScore.map(w => w.j.id), ['a']);
  assert.deepEqual(plan.reuse, []);
});

test('a fully cached posting does neither', () => {
  const reqCache = new Map([['h1', { requirements: [{ text: 'x' }] }]]);
  const covCache = new Map([['h1:r1', { id: 'a', coverage: 0.5 }]]);
  const plan = planCoverage({ work: [W('a', 'h1')], reqCache, covCache });
  assert.deepEqual(plan.needExtract, []);
  assert.deepEqual(plan.needScore, []);
  assert.deepEqual(plan.reuse, []);
});

// A company deletes and re-posts a job. The description is byte-identical, so the
// jdHash matches and coverage says "already done" — but the id is new, so nothing
// downstream can find the row and poll re-stages it on every single run, forever.
// Measured: 4 of 100 staged postings were in this state.
test('a re-listed posting reuses the cached score under its NEW id', () => {
  const reqCache = new Map([['h1', { requirements: [{ text: 'x' }] }]]);
  const covCache = new Map([['h1:r1', { id: 'old', key: 'h1:r1', coverage: 0.5, met: 3, total: 6 }]]);
  const plan = planCoverage({ work: [W('new', 'h1')], reqCache, covCache });

  assert.deepEqual(plan.needExtract, [], 'requirements are cached, nothing to extract');
  assert.deepEqual(plan.needScore, [], 'the assessment is cached, nothing to pay for');
  assert.equal(plan.reuse.length, 1, 'but a row must be written under the new id');

  const row = plan.reuse[0];
  assert.equal(row.id, 'new', 'restamped to the staged id');
  assert.equal(row.coverage, 0.5, 'the assessment itself is unchanged');
  assert.equal(row.met, 3);
  assert.equal(row.reusedFrom, 'old', 'and says where it came from');
});

test('reuse copies nothing when the ids already agree', () => {
  const reqCache = new Map([['h1', { requirements: [{ text: 'x' }] }]]);
  const covCache = new Map([['h1:r1', { id: 'a', coverage: 0.5 }]]);
  assert.deepEqual(planCoverage({ work: [W('a', 'h1')], reqCache, covCache }).reuse, []);
});

// An extraction that returned zero requirements used to be cached like any other,
// which put the posting in neither pass: needExtract skipped it (the jdHash IS in
// reqCache) and scoring filtered it out (no requirements to score). It could never
// finish and never retried, silently. Measured: 1 of 3,363 requirement rows.
test('an empty requirements row is retried, not treated as cached', () => {
  const reqCache = new Map([['h1', { jdHash: 'h1', requirements: [] }]]);
  const plan = planCoverage({ work: [W('a', 'h1')], reqCache, covCache: new Map() });
  assert.deepEqual(plan.needExtract.map(w => w.j.id), ['a'],
    'zero requirements means extraction failed, so try again');
});

test('a missing requirements array counts as empty too', () => {
  const reqCache = new Map([['h1', { jdHash: 'h1' }]]);
  assert.equal(planCoverage({ work: [W('a', 'h1')], reqCache, covCache: new Map() }).needExtract.length, 1);
});

// Retrying an empty extraction forever is its own bug. Some postings genuinely have
// no requirements to find: Twilio published "Machine Learning Engineer L2" as an
// unfilled internal template — "This position is needed to ." and five copies of
// "Begin each bullet with an action-oriented verb" where the responsibilities go.
// Returning zero is the extractor being right, so the retry has to be bounded or it
// pays $0.0033 a run, forever, on a posting that can never finish.
test('an empty extraction is retried, but not without limit', () => {
  const reqCache = new Map([['h1', { jdHash: 'h1', requirements: [] }]]);
  const work = [W('a', 'h1')];

  const first = planCoverage({ work, reqCache, covCache: new Map(), attempts: new Map([['h1', 1]]) });
  assert.equal(first.needExtract.length, 1, 'one empty result could be a blip — retry');

  const done = planCoverage({ work, reqCache, covCache: new Map(), attempts: new Map([['h1', 2]]) });
  assert.equal(done.needExtract.length, 0, 'twice empty is the posting, not the model');
  assert.deepEqual(done.unextractable.map(w => w.j.id), ['a'],
    'and it is named, so the run can say why it will never finish');
});

test('the attempt limit does not apply to a posting that extracted fine', () => {
  const reqCache = new Map([['h1', { jdHash: 'h1', requirements: [{ text: 'x' }] }]]);
  const plan = planCoverage({ work: [W('a', 'h1')], reqCache, covCache: new Map(), attempts: new Map([['h1', 9]]) });
  assert.deepEqual(plan.needExtract, []);
  assert.deepEqual(plan.unextractable, []);
});

test('--force overrides a spent attempt budget', () => {
  const reqCache = new Map([['h1', { jdHash: 'h1', requirements: [] }]]);
  const plan = planCoverage({
    work: [W('a', 'h1')], reqCache, covCache: new Map(),
    attempts: new Map([['h1', 5]]), force: true,
  });
  assert.equal(plan.needExtract.length, 1);
});

test('scorable reports what pass 2 can actually score', () => {
  const reqCache = new Map([
    ['h1', { requirements: [{ text: 'x' }] }],
    ['h2', { requirements: [] }],
  ]);
  const work = [W('a', 'h1'), W('b', 'h2')];
  const plan = planCoverage({ work, reqCache, covCache: new Map() });
  assert.deepEqual(plan.scorable.map(w => w.j.id), ['a']);
  assert.deepEqual(plan.unscorable.map(w => w.j.id), ['b'],
    'named so the run can say which postings it could not score');
});

test('--force redoes everything and reuses nothing', () => {
  const reqCache = new Map([['h1', { requirements: [{ text: 'x' }] }]]);
  const covCache = new Map([['h1:r1', { id: 'old', coverage: 0.5 }]]);
  const plan = planCoverage({ work: [W('new', 'h1')], reqCache, covCache, force: true });
  assert.equal(plan.needExtract.length, 1);
  assert.equal(plan.needScore.length, 1);
  assert.deepEqual(plan.reuse, [], 'force re-scores it, so there is nothing to copy');
});
