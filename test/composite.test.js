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

test('composite sums the four normalised values', () => {
  const rows = [
    { fitness: 0, coverage: 0, similarity: 0, daysLive: 10 },
    { fitness: 1, coverage: 1, similarity: 1, daysLive: 0 },
  ];
  const out = composite(rows);
  assert.equal(out[0].total, 0);          // worst on every axis, oldest
  assert.equal(out[1].total, 4);          // best on every axis, freshest
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
