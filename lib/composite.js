// Turning fitness and a posting's age into one number you can sort on.
//
//   fresh   how much of its value the posting still has
//   value   the geometric mean of scaled fitness and fresh — what it is worth
//           chasing today
//
// Fitness — Jev's P(the candidate is qualified), from the whole posting and the
// resume — is the only model score. Embedding similarity, a Sonnet fitness judgement,
// a combined `score` and requirement coverage all came and went on 2026-10-02.
// Coverage was the last to go: across 100 postings where it and fitness disagreed by
// 0.25 or more, judged by hand, fitness was closer in 90 (mean error 0.08 vs 0.35).
//
// Fitness is min-maxed across the rows being compared before it is combined. It runs
// low (mean about 0.35) while freshness spans the whole of 0..1, so unscaled,
// freshness would quietly outweigh it. That makes the fitness half *relative*: the
// best-fitting posting in what you are looking at counts as 1, and it re-scales when
// you change the filters. Freshness, by contrast, is absolute — a
// three-day-old posting does not become staler because something older turned up
// beside it.

/**
 * How long a posting keeps half its value. Seven days: listed today is 1.00, a week
 * old 0.50, a fortnight 0.25, a month 0.05. Aggressive on purpose — applying early is
 * most of the advantage a job board gives you.
 */
export const HALF_LIFE_DAYS = 7;

/**
 * Nothing is exactly zero before a geometric mean.
 *
 * min-max always puts the lowest row at 0 on its axis, and a geometric mean with a
 * zero anywhere in it is zero — so the worst row on any single axis would collapse and
 * take every distinction below it along. A small floor keeps the punishment (0.02 drags
 * a mean of otherwise-perfect scores down to 0.27) without erasing the ordering.
 */
const FLOOR = 0.02;

/**
 * Freshness: 1 the day it is posted, halving every HALF_LIFE_DAYS.
 *
 * Exponential rather than linear because value does not fall off evenly. A job listed
 * today is worth applying to, one a week old has lost real ground to everyone who
 * applied first, and the difference between 200 and 300 days old is nothing.
 *
 * @param {number|null|undefined} days
 * @returns {number|null} null when the age is unknown
 */
export function freshness(days) {
  if (typeof days !== 'number' || !Number.isFinite(days)) return null;
  return Math.pow(0.5, Math.max(0, days) / HALF_LIFE_DAYS);
}

/**
 * Map values onto 0..1. Nulls stay null; they are unknown, not zero.
 * @param {(number|null)[]} values
 */
export function minMax(values) {
  const known = values.filter(v => typeof v === 'number' && Number.isFinite(v));
  if (!known.length) return values.map(() => null);

  // A loop, not Math.min(...known): spreading puts every value on the stack, and that
  // threw RangeError past ~120,000 once every posting was scored.
  let lo = Infinity, hi = -Infinity;
  for (const v of known) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = hi - lo;

  return values.map(v => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    // No spread means nothing to tell apart; everything is equally good.
    return span === 0 ? 1 : (v - lo) / span;
  });
}

const round = n => Number(n.toFixed(3));

/** Geometric mean, floored so a single zero cannot annihilate the result. */
function geoMean(parts) {
  const clamped = parts.map(p => Math.max(p, FLOOR));
  return Math.pow(clamped.reduce((a, b) => a * b, 1), 1 / clamped.length);
}

/**
 * Add `nFitness`, `nAlignment`, `fresh` and `value` to each row.
 *
 * `value` is the geometric mean of three things: scaled `fitness` (does the resume
 * meet the role), scaled `alignment` (does the role meet the resume) and freshness. A
 * posting has to be decent on all three — a role you are overqualified for is
 * qualified and not aligned, and a perfect match listed for months does not outrank
 * a good one posted this week. Each score is min-maxed separately across the rows
 * shown. It is null unless all three exist, because a posting not yet asked both
 * questions is unknown, not bad, and valuing it 0 would sort it below poor matches.
 *
 * @param {object[]} rows  carrying fitness, alignment, daysLive
 */
export function composite(rows) {
  const nFitness = minMax(rows.map(r => r.fitness ?? null));
  const nAlignment = minMax(rows.map(r => r.alignment ?? null));

  return rows.map((r, i) => {
    const fresh = freshness(r.daysLive);
    const parts = [nFitness[i], nAlignment[i], fresh];
    return {
      ...r,
      nFitness: nFitness[i],
      nAlignment: nAlignment[i],
      fresh: fresh === null ? null : round(fresh),
      value: parts.every(p => p !== null) ? round(geoMean(parts)) : null,
    };
  });
}
