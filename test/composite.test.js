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
  const a = composite([{ fitness: 0.5, daysLive: 3 }, { fitness: 0.5, daysLive: 965 }]);
  const b = composite([{ fitness: 0.5, daysLive: 3 }, { fitness: 0.5, daysLive: 20 }]);
  assert.equal(a[0].fresh, b[0].fresh);
});

// ---- value: the geometric mean of scaled fitness and freshness ---------------------
//
// Fitness is the only model score (2026-10-02). It replaced coverage after 100 postings
// where the two disagreed by 0.25+ were judged by hand: fitness was closer in 90, with
// mean error 0.08 against coverage's 0.35. Fitness is min-maxed across the rows shown
// before it is combined, so its tendency to run low does not let freshness outweigh it.

test('a best-fitting, brand-new posting is worth 1', () => {
  const [row] = composite([{ fitness: 0.6, daysLive: 0 }]);
  assert.equal(row.value, 1);
});

test('value is the geometric mean of scaled fitness and freshness', () => {
  const out = composite([{ fitness: 0.1, daysLive: 0 }, { fitness: 0.7, daysLive: HALF_LIFE_DAYS }]);
  // row 1: nFitness 1, fresh 0.5 -> sqrt(0.5)
  assert.equal(out[1].value, Number(Math.sqrt(0.5).toFixed(3)));
});

test('fitness is scaled across the rows shown', () => {
  const out = composite([{ fitness: 0.2, daysLive: 0 }, { fitness: 0.6, daysLive: 0 }, { fitness: 0.4, daysLive: 0 }]);
  assert.deepEqual(out.map(r => Number(r.nFitness.toFixed(6))), [0, 1, 0.5]);
});

test('weak on either side drags value down — the point of a geometric mean', () => {
  const [middling, ancient] = composite([
    { fitness: 0.5, daysLive: HALF_LIFE_DAYS },
    { fitness: 0.9, daysLive: 999 },
    { fitness: 0.1, daysLive: 0 },
  ]);
  assert.ok(ancient.value < middling.value * 0.5);
});

test('nothing collapses to exactly zero, so ordering survives', () => {
  const out = composite([{ fitness: 0.1, daysLive: 0 }, { fitness: 0.1, daysLive: 30 }, { fitness: 0.9, daysLive: 0 }]);
  assert.ok(out[0].value > 0);
  assert.ok(out[0].value > out[1].value);
});

test('value is null when fitness is missing, or the age is', () => {
  assert.equal(composite([{ fitness: null, daysLive: 5 }])[0].value, null);
  assert.equal(composite([{ fitness: 0.5, daysLive: null }])[0].value, null);
});

test('coverage on a row changes nothing — it was dropped', () => {
  const a = composite([{ fitness: 0.4, daysLive: 1 }, { fitness: 0.9, daysLive: 3 }]);
  const b = composite([{ fitness: 0.4, coverage: 0.9, daysLive: 1 }, { fitness: 0.9, coverage: 0.1, daysLive: 3 }]);
  assert.deepEqual(a.map(r => r.value), b.map(r => r.value));
  assert.equal('nCoverage' in b[0], false);
});

test('an empty set does not throw', () => {
  assert.deepEqual(composite([]), []);
});
