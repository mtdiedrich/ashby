import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minMax, composite, freshness, HALF_LIFE_DAYS } from '../lib/composite.js';

// ---- min-max ------------------------------------------------------------

test('minMax maps the range onto 0..1', () => {
  assert.deepEqual(minMax([0, 5, 10]), [0, 0.5, 1]);
});

test('minMax leaves nulls as null rather than treating them as zero', () => {
  assert.deepEqual(minMax([0, null, 10]), [0, null, 1]);
});

test('an all-equal column normalises to 1, not NaN', () => {
  assert.deepEqual(minMax([3, 3, 3]), [1, 1, 1]);
});

test('a column of nothing but nulls stays null', () => {
  assert.deepEqual(minMax([null, null]), [null, null]);
});

// ---- freshness ----------------------------------------------------------

test('a posting listed today is worth the full amount', () => {
  assert.equal(freshness(0), 1);
});

test('freshness halves every half-life', () => {
  const h = HALF_LIFE_DAYS;
  assert.ok(Math.abs(freshness(h) - 0.5) < 1e-9);
  assert.ok(Math.abs(freshness(2 * h) - 0.25) < 1e-9);
});

test('decay is steep early and flat late', () => {
  const firstWeek = freshness(0) - freshness(7);
  const tenthWeek = freshness(63) - freshness(70);
  assert.ok(firstWeek > tenthWeek * 10);
});

test('always decreasing, never negative', () => {
  let prev = Infinity;
  for (const d of [0, 1, 7, 30, 90, 365, 965, 5000]) {
    const v = freshness(d);
    assert.ok(v < prev && v >= 0, `${d}d`);
    prev = v;
  }
});

test('an unknown age is null, not zero', () => {
  assert.equal(freshness(null), null);
  assert.equal(freshness(undefined), null);
});

test('freshness is absolute — one ancient posting cannot compress the rest', () => {
  const a = composite([
    { fitness: 0.5, coverage: 0.5, similarity: 0.5, daysLive: 3 },
    { fitness: 0.5, coverage: 0.5, similarity: 0.5, daysLive: 965 },
  ]);
  const b = composite([
    { fitness: 0.5, coverage: 0.5, similarity: 0.5, daysLive: 3 },
    { fitness: 0.5, coverage: 0.5, similarity: 0.5, daysLive: 20 },
  ]);
  assert.equal(a[0].fresh, b[0].fresh);
});

// ---- score: geometric mean of the three model scores --------------------

test('score is the geometric mean of the three normalised scores', () => {
  const [best] = composite([{ fitness: 1, coverage: 1, similarity: 1, daysLive: 0 }]);
  assert.equal(best.score, 1);
});

test('score ignores freshness entirely', () => {
  // Same three scores, wildly different ages — score must not move.
  const [fresh, stale] = composite([
    { fitness: 0.5, coverage: 0.5, similarity: 0.5, daysLive: 0 },
    { fitness: 0.5, coverage: 0.5, similarity: 0.5, daysLive: 900 },
  ]);
  assert.equal(fresh.score, stale.score);
  assert.ok(fresh.fresh > stale.fresh, 'but freshness does move');
});

test('one weak score drags score down — the point of a geometric mean', () => {
  // Three rows, so min-max has a real spread rather than collapsing to 0 and 1.
  const [middling, lopsided] = composite([
    { fitness: 0.5, coverage: 0.5, similarity: 0.5, daysLive: 0 },
    { fitness: 1.0, coverage: 1.0, similarity: 0.0, daysLive: 0 },
    { fitness: 0.0, coverage: 0.0, similarity: 0.4, daysLive: 0 },
  ]);
  const mean = r => (r.nFitness + r.nCoverage + r.nSimilarity) / 3;
  // Identical averages: 0.50/0.50/1.00 and 1.00/1.00/0.00 both average to 0.667.
  // An arithmetic mean cannot tell these apart at all.
  assert.ok(Math.abs(mean(lopsided) - mean(middling)) < 1e-9,
    'the two rows have the same average, by construction');
  // The geometric mean does: being worst-in-field on one axis is not survivable.
  assert.ok(lopsided.score < middling.score * 0.5,
    `lopsided ${lopsided.score} should be far below middling ${middling.score}`);
});

test('nothing collapses to exactly zero, so ordering survives', () => {
  // min-max always puts the lowest row at 0 on its axis; without a floor the
  // geometric mean would zero those rows and lose every distinction below.
  const out = composite([
    { fitness: 0, coverage: 0.9, similarity: 0.9, daysLive: 0 },
    { fitness: 0, coverage: 0.1, similarity: 0.1, daysLive: 0 },
    { fitness: 1, coverage: 1, similarity: 1, daysLive: 0 },
  ]);
  assert.ok(out[0].score > 0);
  assert.ok(out[0].score > out[1].score);
});

test('score is null unless all three exist', () => {
  const [partial, whole] = composite([
    { fitness: 0.5, coverage: null, similarity: 0.2, daysLive: 5 },
    { fitness: 0.5, coverage: 0.5, similarity: 0.2, daysLive: 5 },
  ]);
  assert.equal(partial.score, null);
  assert.equal(typeof whole.score, 'number');
});

// ---- value: the average of score and fresh ------------------------------

test('value is the average of score and fresh', () => {
  const [row] = composite([{ fitness: 1, coverage: 1, similarity: 1, daysLive: HALF_LIFE_DAYS }]);
  assert.equal(row.score, 1);
  assert.ok(Math.abs(row.fresh - 0.5) < 1e-9);
  assert.ok(Math.abs(row.value - 0.75) < 1e-3, `expected ~0.75, got ${row.value}`);
});

test('a perfect, brand-new posting scores 1', () => {
  const [row] = composite([{ fitness: 1, coverage: 1, similarity: 1, daysLive: 0 }]);
  assert.equal(row.value, 1);
});

test('value is null when score is null', () => {
  const [row] = composite([{ fitness: 0.5, coverage: null, similarity: 0.2, daysLive: 5 }]);
  assert.equal(row.value, null);
});

test('value is null when the age is unknown', () => {
  const [row] = composite([{ fitness: 0.5, coverage: 0.5, similarity: 0.5, daysLive: null }]);
  assert.equal(row.value, null);
});

test('freshness and score weigh equally', () => {
  // A perfect score, long dead, lands at half. That is the trade value makes
  // explicit: half the number is how good it is, half is whether it is still worth
  // chasing.
  const out = composite([
    { fitness: 1, coverage: 1, similarity: 1, daysLive: 0 },
    { fitness: 1, coverage: 1, similarity: 1, daysLive: 999 },
  ]);
  assert.ok(Math.abs(out[0].value - 1) < 1e-3);
  assert.ok(Math.abs(out[1].value - 0.5) < 1e-3, 'perfect but ancient lands at half');
});

test('an empty set does not throw', () => {
  assert.deepEqual(composite([]), []);
});
