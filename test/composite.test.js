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

// ---- value: the geometric mean of scaled qualified, scaled aligned, and freshness --
//
// Two Jev answers since 2026-10-12, asked in one request: `fitness` — is the candidate
// qualified for the job (does the resume meet the role) — and `alignment` — is the job
// a close match for the work the resume shows (does the role meet the resume). They
// differ on a role far below the candidate's level: qualified, not aligned. Each is
// min-maxed across the rows shown before it is combined, so a model score that runs
// low does not let freshness outweigh it.

const row = (fitness, alignment, daysLive) => ({ fitness, alignment, daysLive });

test('a best-fitting, best-aligned, brand-new posting is worth 1', () => {
  const [r] = composite([row(0.6, 0.7, 0)]);
  assert.equal(r.value, 1);
});

test('value is the geometric mean of scaled qualified, scaled aligned and freshness', () => {
  const out = composite([row(0.1, 0.2, 0), row(0.7, 0.9, HALF_LIFE_DAYS)]);
  // row 1: nFitness 1, nAlignment 1, fresh 0.5 -> cbrt(0.5)
  assert.equal(out[1].value, Number(Math.cbrt(0.5).toFixed(3)));
});

test('each score is scaled across the rows shown, separately', () => {
  const out = composite([row(0.2, 0.9, 0), row(0.6, 0.1, 0), row(0.4, 0.5, 0)]);
  assert.deepEqual(out.map(r => Number(r.nFitness.toFixed(6))), [0, 1, 0.5]);
  assert.deepEqual(out.map(r => Number(r.nAlignment.toFixed(6))), [1, 0, 0.5]);
});

test('qualified but not aligned ranks below both — the point of asking both ways', () => {
  const [overqualified, match] = composite([row(0.9, 0.1, 0), row(0.8, 0.8, 0), row(0.1, 0.1, 0)]);
  assert.ok(overqualified.value < match.value * 0.5);
});

test('weak on any side drags value down — the point of a geometric mean', () => {
  const [middling, ancient] = composite([
    row(0.5, 0.5, HALF_LIFE_DAYS),
    row(0.9, 0.9, 999),
    row(0.1, 0.1, 0),
  ]);
  // middling: 0.5 on all three. ancient: perfect on both scores, freshness floored at
  // 0.02 — cbrt(0.02) ≈ 0.27. With three parts freshness carries a third of the weight,
  // not half (two-part: 0.14), so staleness drags less than it did; it still loses.
  assert.equal(middling.value, 0.5);
  assert.equal(ancient.value, Number(Math.cbrt(0.02).toFixed(3)));
  assert.ok(ancient.value < middling.value);
});

test('nothing collapses to exactly zero, so ordering survives', () => {
  const out = composite([row(0.1, 0.1, 0), row(0.1, 0.1, 30), row(0.9, 0.9, 0)]);
  assert.ok(out[0].value > 0);
  assert.ok(out[0].value > out[1].value);
});

test('value is null when either answer is missing, or the age is', () => {
  assert.equal(composite([row(null, 0.5, 5)])[0].value, null);
  assert.equal(composite([row(0.5, null, 5)])[0].value, null, 'a one-question answer from before 2026-10-12');
  assert.equal(composite([row(0.5, 0.5, null)])[0].value, null);
});

test('coverage on a row changes nothing — it was dropped', () => {
  const a = composite([row(0.4, 0.4, 1), row(0.9, 0.9, 3)]);
  const b = composite([{ ...row(0.4, 0.4, 1), coverage: 0.9 }, { ...row(0.9, 0.9, 3), coverage: 0.1 }]);
  assert.deepEqual(a.map(r => r.value), b.map(r => r.value));
  assert.equal('nCoverage' in b[0], false);
});

test('an empty set does not throw', () => {
  assert.deepEqual(composite([]), []);
});

// Math.min(...values) spreads every value onto the stack, and threw RangeError past
// ~120,000 rows. Scoring every posting puts ~225,000 fitness values on the board.
test('min-max works over every posting in the corpus, not just a filtered few', () => {
  const rows = Array.from({ length: 250_000 }, (_, i) => ({ id: String(i), fitness: (i % 100) / 100, alignment: (i % 7) / 7, daysLive: i % 30 }));
  const out = composite(rows);
  assert.equal(out.length, 250_000);
  assert.ok(out.some(r => r.value != null));
});
