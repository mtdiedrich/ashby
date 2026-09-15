// Turning the three model scores and a posting's age into numbers you can sort on.
//
//   score   how good a match this is, ignoring age entirely
//   fresh   how much of its value the posting still has
//   value   the average of the two — what it is worth chasing today
//
// The three model scores live on different scales. fitness and coverage run 0..1 but
// rarely use the top half; similarity is a centred cosine that sits around 0.1–0.25
// and can go negative. Combining them raw would let whichever happens to have the
// widest spread dominate, so each is min-maxed across the rows being compared first.
//
// That makes score *relative*: a 0.2 fitness is the best in a set where nothing beats
// 0.2. The ranking is within what you are looking at, and re-scales when you change
// the filters. Freshness, by contrast, is absolute — a three-day-old posting does not
// become staler because something older turned up beside it.

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

  const lo = Math.min(...known);
  const hi = Math.max(...known);
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
 * Add the normalised parts, `score`, `fresh` and `value` to each row.
 *
 * `score` is the geometric mean of the three normalised model scores — a posting has
 * to be decent on all three rather than buying its way up with one. It is null unless
 * all three exist, because a posting nothing has scored is unknown, not bad, and
 * scoring it 0 would sort it below genuinely poor matches.
 *
 * `value` is the plain average of `score` and `fresh`: half of it is how good the
 * match is, half is whether it is still worth chasing.
 *
 * @param {object[]} rows  carrying fitness, coverage, similarity, daysLive
 */
export function composite(rows) {
  const nFitness    = minMax(rows.map(r => r.fitness    ?? null));
  const nCoverage   = minMax(rows.map(r => r.coverage   ?? null));
  const nSimilarity = minMax(rows.map(r => r.similarity ?? null));

  return rows.map((r, i) => {
    const parts = [nFitness[i], nCoverage[i], nSimilarity[i]];
    const score = parts.every(p => p !== null) ? round(geoMean(parts)) : null;
    const fresh = freshness(r.daysLive);

    return {
      ...r,
      nFitness: nFitness[i], nCoverage: nCoverage[i], nSimilarity: nSimilarity[i],
      score,
      fresh: fresh === null ? null : round(fresh),
      value: score !== null && fresh !== null ? round((score + fresh) / 2) : null,
    };
  });
}
