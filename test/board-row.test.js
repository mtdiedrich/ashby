import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summaryOf, detailOf, HEAVY, payEstimateOf, payForRow } from '../lib/board-row.js';

// One /api/board response was 5.8 MB for 600 rows — 3.4 MB of job descriptions and
// 1.7 MB of requirement evidence, for detail panes that are hidden until a row is
// expanded. The table needs none of it to draw a row.

const row = () => ({
  id: 'a', title: 'ML Engineer', slug: 'acme', location: 'Remote - US', pay: '$200K',
  fitness: 0.6, fresh: 0.9, value: 0.75,
  daysLive: 2, state: 'judged',
  applyUrl: 'u1', jobUrl: 'u2', department: 'Eng', team: 'ML',
  workplaceType: 'Remote', employmentType: 'FullTime',
  // the heavy half
  description: 'x'.repeat(5000),
  payText: 'Salary range: $150,000 to $250,000 USD annually',
});

test('the summary carries everything the table draws', () => {
  const s = summaryOf(row());
  for (const k of ['id', 'title', 'slug', 'location', 'pay', 'fitness',
                   'fresh', 'value', 'daysLive', 'state']) {
    assert.ok(k in s, `summary is missing ${k}, which a column reads`);
  }
});

test('the summary carries none of the heavy detail', () => {
  const s = summaryOf(row());
  for (const k of HEAVY) assert.ok(!(k in s), `${k} should not ride on every row`);
});

test('a summary is a fraction of the size', () => {
  const r = row();
  const full = JSON.stringify(r).length;
  const lean = JSON.stringify(summaryOf(r)).length;
  assert.ok(lean < full / 10, `summary is ${lean} of ${full} bytes — expected under a tenth`);
});

test('the detail carries what the expanded pane draws, and nothing else', () => {
  const d = detailOf(row());
  for (const k of HEAVY) assert.ok(k in d, `detail is missing ${k}`);
  assert.ok(!('fitness' in d), 'the numbers are already on the summary');
});

test('together they lose nothing the pane needs', () => {
  const r = row();
  const merged = { ...summaryOf(r), ...detailOf(r) };
  for (const k of ['description', 'payText', 'applyUrl', 'jobUrl', 'department', 'workplaceType']) {
    assert.deepEqual(merged[k], r[k], `${k} did not survive the split`);
  }
});

test('missing fields do not become undefined keys', () => {
  const s = summaryOf({ id: 'a' });
  assert.equal(s.id, 'a');
  const d = detailOf({ id: 'a' });
  assert.equal(d.payText, null, 'absent is null, not undefined');
  assert.equal(d.description, '');
});

test('nullish input does not throw', () => {
  assert.equal(summaryOf(null).id, undefined);
  assert.equal(detailOf(null).description, '');
});

// Similarity was dropped 2026-10-02 — it added nothing to the ranking — so no row
// carries it, raw or normalised, even if something upstream still sets it.
test('the summary carries no similarity', () => {
  const s = summaryOf({ ...row(), nSimilarity: 0.62 });
  assert.equal('similarity' in s, false);
  assert.equal('nSimilarity' in s, false);
});

// ---- levels.fyi pay estimates ------------------------------------------------
//
// Display only, and only where the posting publishes nothing: an estimate is what
// people at the company reported, not what this posting offers.

const est = { id: 'a', at: '2026-10-02T00:00:00Z', slug: 'crusoe', url: 'https://www.levels.fyi/x',
  company: 'Crusoe', family: 'software-engineer', kind: 'same level', level: 'Staff Software Engineer',
  base: 268750, total: 380000, count: 4 };

test('an estimate rides on a row that publishes no pay', () => {
  const e = payEstimateOf(null, est);
  assert.deepEqual(e, { base: 268750, low: null, high: null, total: 380000, kind: 'same level',
    level: 'Staff Software Engineer', count: 4, company: 'Crusoe', url: 'https://www.levels.fyi/x' });
});

test('published pay always wins; the estimate is not sent', () => {
  assert.equal(payEstimateOf('$180K - $220K', est), null);
});

test('a recorded miss is no estimate', () => {
  assert.equal(payEstimateOf(null, { id: 'a', at: 'x', none: 'no levels.fyi page (404)' }), null);
  assert.equal(payEstimateOf(null, undefined), null);
});

test('a company-wide estimate keeps its range', () => {
  const e = payEstimateOf(null, { ...est, kind: 'all levels', level: null, base: 210000, baseLow: 164000, baseHigh: 250000 });
  assert.deepEqual([e.low, e.base, e.high], [164000, 210000, 250000]);
});

test('the table row carries payEst', () => {
  assert.deepEqual(summaryOf({ id: 'a', payEst: { base: 1 } }).payEst, { base: 1 });
  assert.equal('payEst' in summaryOf({ id: 'a' }), false);
});

// The Sonnet fitness scorer, and the score built on it, were dropped 2026-10-02:
// no score on the row, and none of that model's reasoning in the pane. The fitness
// column that came back the same day is Jev's, display only, and rides on the row.
test('no score or old fitness reasoning on a row; the jev fitness is there', () => {
  const r = { ...row(), fitness: 0.8, score: 0.6, why: 'a reason', concerns: ['one'],
              judgedAt: '2026-09-20', fitnessModel: 'claude-sonnet-5' };
  const s = summaryOf(r), d = detailOf(r);
  assert.equal('score' in s, false);
  assert.equal(s.fitness, 0.8);
  assert.equal(summaryOf({ id: 'a' }).fitness, null, 'absent is null, not undefined');
  for (const k of ['why', 'concerns', 'judgedAt', 'fitnessModel']) {
    assert.equal(k in d, false, k);
    assert.equal(HEAVY.includes(k), false, k);
  }
});

// ---- the pay column's sources, in order -------------------------------------------
//
// The posting's own pay field, then pay stated in the description, then a levels.fyi
// estimate. Clera's descriptions said "Salary range: $150,000 to $250,000 USD
// annually" while the pay field was empty, so the board went straight to an estimate.

const textPay = { min: 150000, max: 250000, currency: 'USD', interval: 'year', kind: 'base', ranges: 1, text: 'Salary range: $150,000 to $250,000 USD annually' };

test('the posting\'s own pay field comes first', () => {
  assert.deepEqual(payForRow('$155K - $245K', textPay, est), { pay: '$155K - $245K', payFrom: 'posting', payEst: null });
});

test('then pay stated in the description', () => {
  assert.deepEqual(payForRow(null, textPay, est), { pay: '$150K – $250K', payFrom: 'description', payEst: null });
});

test('only then a levels.fyi estimate', () => {
  const r = payForRow(null, null, est);
  assert.equal(r.pay, null);
  assert.equal(r.payFrom, null);
  assert.equal(r.payEst.base, 268750);
});

test('the table row carries where its pay came from; the pane carries the sentence', () => {
  assert.equal(summaryOf({ id: 'a', pay: '$1', payFrom: 'description' }).payFrom, 'description');
  assert.ok(HEAVY.includes('payText'));
  assert.equal(detailOf({ payText: 'Salary range: $1 to $2' }).payText, 'Salary range: $1 to $2');
  assert.equal(detailOf({}).payText, null);
});

// Requirement coverage was dropped 2026-10-02, and its extraction with it: no row
// carries coverage or a met/total count, and the pane no longer carries the
// requirement list, gaps or constraints.
test('nothing of requirement coverage rides on a row or in the pane', () => {
  const r = { ...row(), coverage: 0.7, met: 6, reqTotal: 10, requirements: [{ text: 'x' }], gaps: ['g'], constraints: ['c'] };
  const s = summaryOf(r), d = detailOf(r);
  for (const k of ['coverage', 'met', 'reqTotal']) assert.equal(k in s, false, k);
  for (const k of ['requirements', 'gaps', 'constraints']) {
    assert.equal(k in d, false, k);
    assert.equal(HEAVY.includes(k), false, k);
  }
});

// Two answers since 2026-10-12: the table draws both, so both ride on the summary —
// as null when not yet asked, never as a missing key the page renders "undefined".
test('the summary carries alignment beside fitness, null when not yet asked', () => {
  assert.equal(summaryOf({ ...row(), alignment: 0.7 }).alignment, 0.7);
  const s = summaryOf({ id: 'x' });
  assert.ok('alignment' in s);
  assert.equal(s.alignment, null);
});
