import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minMax, composite } from '../lib/composite.js';

test('minMax maps the range onto 0..1', () => {
  assert.deepEqual(minMax([0, 5, 10]), [0, 0.5, 1]);
});

test('minMax inverts when asked, so lower input scores higher', () => {
  // days live: fresher should be better
  assert.deepEqual(minMax([0, 5, 10], { invert: true }), [1, 0.5, 0]);
});

test('minMax leaves nulls as null rather than treating them as zero', () => {
  assert.deepEqual(minMax([0, null, 10]), [0, null, 1]);
});

test('an all-equal column normalises to 1, not NaN', () => {
  // No spread means nothing to discriminate; everything is equally good.
  assert.deepEqual(minMax([3, 3, 3]), [1, 1, 1]);
});

test('a column of nothing but nulls stays null', () => {
  assert.deepEqual(minMax([null, null]), [null, null]);
});

test('total is the geometric mean of the four parts, 0..1', () => {
  const rows = [
    { fitness: 0, coverage: 0, similarity: 0, daysLive: 9999 },
    { fitness: 1, coverage: 1, similarity: 1, daysLive: 0 },
  ];
  const out = composite(rows);
  assert.ok(out[0].total < 0.05, 'worst on every axis and ancient');
  assert.equal(out[1].total, 1, 'best on every axis, listed today');
});

test('one weak axis drags the whole thing down — the point of a geometric mean', () => {
  // Three rows, so min-max has a real spread to work with rather than collapsing
  // two rows to 0 and 1 on every axis.
  //   middling  — half marks everywhere, a week old
  //   lopsided  — top of the field on three axes, but posted two years ago
  //   floor     — bottom of the field, present only to anchor the normalisation
  const [middling, lopsided] = composite([
    { fitness: 0.5, coverage: 0.5, similarity: 0.5, daysLive: 7 },
    { fitness: 1.0, coverage: 1.0, similarity: 1.0, daysLive: 700 },
    { fitness: 0.0, coverage: 0.0, similarity: 0.0, daysLive: 7 },
  ]);
  const arithmetic = r => (r.nFitness + r.nCoverage + r.nSimilarity + r.nFresh) / 4;
  assert.ok(arithmetic(lopsided) > arithmetic(middling),
    'averaging the parts lets three strong scores carry a dead posting');
  assert.ok(lopsided.total < middling.total,
    'the geometric mean does not let them');
});

test('nothing collapses to exactly zero, so ordering survives', () => {
  // min-max always puts the lowest row at 0 on that axis. Without a floor the
  // geometric mean would zero it out and lose every distinction below it.
  const out = composite([
    { fitness: 0, coverage: 0.9, similarity: 0.9, daysLive: 0 },
    { fitness: 0, coverage: 0.1, similarity: 0.1, daysLive: 0 },
    { fitness: 1, coverage: 1, similarity: 1, daysLive: 0 },
  ]);
  assert.ok(out[0].total > 0, 'a zero on one axis must not erase the row');
  assert.ok(out[0].total > out[1].total, 'and the two zeroed rows stay in order');
});

test('the geometric mean sits between the worst and best part', () => {
  const [row] = composite([{ fitness: 1, coverage: 1, similarity: 1, daysLive: 14 }]);
  const parts = [row.nFitness, row.nCoverage, row.nSimilarity, row.nFresh];
  assert.ok(row.total >= Math.min(...parts) && row.total <= Math.max(...parts));
});

test('composite is null unless all four parts exist', () => {
  const rows = [
    { fitness: 0.5, coverage: null, similarity: 0.2, daysLive: 5 },
    { fitness: 0.5, coverage: 0.5, similarity: 0.2, daysLive: 5 },
  ];
  const out = composite(rows);
  assert.equal(out[0].total, null, 'missing coverage means no total');
  assert.equal(typeof out[1].total, 'number');
});

test('normalisation is relative to the rows given, not absolute', () => {
  const small = composite([
    { fitness: 0.1, coverage: 0.1, similarity: 0.1, daysLive: 1 },
    { fitness: 0.2, coverage: 0.2, similarity: 0.2, daysLive: 2 },
  ]);
  // 0.2 is the best of these two, so it normalises to the top even though it is
  // a low raw score.
  assert.equal(small[1].nFitness, 1);
  assert.equal(small[0].nFitness, 0);
});

test('the normalised parts are exposed alongside the total', () => {
  const [row] = composite([{ fitness: 1, coverage: 1, similarity: 1, daysLive: 0 }]);
  for (const k of ['nFitness', 'nCoverage', 'nSimilarity', 'nFresh']) {
    assert.equal(typeof row[k], 'number', `${k} should be a number`);
  }
});

test('fresher scores higher than staler', () => {
  const out = composite([
    { fitness: 0.5, coverage: 0.5, similarity: 0.5, daysLive: 200 },
    { fitness: 0.5, coverage: 0.5, similarity: 0.5, daysLive: 2 },
  ]);
  assert.ok(out[1].total > out[0].total, 'the 2-day-old posting must beat the 200-day-old one');
});

test('an empty set does not throw', () => {
  assert.deepEqual(composite([]), []);
});

// ---- freshness decay ----------------------------------------------------

import { freshness, HALF_LIFE_DAYS } from '../lib/composite.js';

test('a posting listed today is worth the full amount', () => {
  assert.equal(freshness(0), 1);
});

test('value halves every half-life', () => {
  const h = HALF_LIFE_DAYS;
  assert.ok(Math.abs(freshness(h) - 0.5) < 1e-9);
  assert.ok(Math.abs(freshness(2 * h) - 0.25) < 1e-9);
  assert.ok(Math.abs(freshness(3 * h) - 0.125) < 1e-9);
});

test('decay is steep early and flat late — the point of using a curve', () => {
  const firstWeek = freshness(0) - freshness(7);
  const tenthWeek = freshness(63) - freshness(70);
  assert.ok(firstWeek > tenthWeek * 10,
    `the first week should cost far more than the tenth (${firstWeek.toFixed(3)} vs ${tenthWeek.toFixed(3)})`);
});

test('always decreasing, never negative', () => {
  let prev = Infinity;
  for (const d of [0, 1, 7, 30, 90, 365, 965, 5000]) {
    const v = freshness(d);
    assert.ok(v < prev, `${d}d should be worth less than the day before`);
    assert.ok(v >= 0, `${d}d must not go negative`);
    prev = v;
  }
});

test('an unknown age is null, not zero', () => {
  assert.equal(freshness(null), null);
  assert.equal(freshness(undefined), null);
});

test('freshness is absolute, so one ancient posting cannot compress the rest', () => {
  // The min-max version gave a 3-day-old 1.00 and a 215-day-old 0.78 because a
  // 965-day-old posting set the floor. Decay does not care what else is in the set.
  const withOutlier  = composite([
    { fitness: 0.5, coverage: 0.5, similarity: 0.5, daysLive: 3 },
    { fitness: 0.5, coverage: 0.5, similarity: 0.5, daysLive: 965 },
  ]);
  const withoutIt = composite([
    { fitness: 0.5, coverage: 0.5, similarity: 0.5, daysLive: 3 },
    { fitness: 0.5, coverage: 0.5, similarity: 0.5, daysLive: 20 },
  ]);
  assert.equal(withOutlier[0].nFresh, withoutIt[0].nFresh,
    'the 3-day-old posting scores the same regardless of what it sits beside');
});
