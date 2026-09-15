// One number out of the four columns.
//
// fitness, coverage and similarity are on different scales — fitness and coverage
// run 0..1 but rarely use the top half, similarity is a centred cosine that sits
// around 0.1-0.25 and can go negative. Summing them raw would let whichever happens
// to have the widest spread dominate. Min-maxing each across the rows being compared
// puts them on equal footing.
//
// Freshness is not min-maxed. It decays exponentially instead, because the value of a
// posting does not fall off linearly — a job listed today is worth applying to, one a
// week old has lost real ground to everyone who applied first, and the difference
// between 200 and 300 days old is nothing at all. Min-max got this badly wrong in
// practice: a single 965-day-old listing set the floor and compressed a 3-day-old and
// a 215-day-old into 1.00 and 0.78.
//
// Decay is also absolute, so a posting's freshness does not change depending on what
// happens to be beside it in the table.
//
// Normalisation is relative to the rows handed in, not absolute. A 0.2 fitness is the
// best score in a set where nothing beats 0.2 — the total ranks within what you are
// looking at, and shifts when you change the filters. That is the intent.

/**
 * How long a posting keeps half its freshness. Seven days: listed today is 1.00,
 * a week old is 0.50, a fortnight 0.25, a month 0.05. Aggressive on purpose —
 * applying early is most of the advantage a job board gives you.
 */
export const HALF_LIFE_DAYS = 7;

/**
 * Freshness, 1 at zero days and halving every HALF_LIFE_DAYS.
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
 * @param {{invert?: boolean}} opts  invert when lower input should score higher
 */
export function minMax(values, { invert = false } = {}) {
  const known = values.filter(v => typeof v === 'number' && Number.isFinite(v));
  if (!known.length) return values.map(() => null);

  const lo = Math.min(...known);
  const hi = Math.max(...known);
  const span = hi - lo;

  return values.map(v => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    // No spread means nothing to tell apart; everything is equally good.
    const n = span === 0 ? 1 : (v - lo) / span;
    return invert ? 1 - n : n;
  });
}

/**
 * Add normalised parts and their sum to each row.
 *
 * `total` is null unless all four parts are present — a posting nothing has scored
 * is unknown, not bad, and scoring it 0 would sort it below genuinely poor matches.
 *
 * @param {object[]} rows  carrying fitness, coverage, similarity, daysLive
 */
export function composite(rows) {
  const nFitness    = minMax(rows.map(r => r.fitness    ?? null));
  const nCoverage   = minMax(rows.map(r => r.coverage   ?? null));
  const nSimilarity = minMax(rows.map(r => r.similarity ?? null));
  const nFresh      = rows.map(r => freshness(r.daysLive));

  return rows.map((r, i) => {
    const parts = [nFitness[i], nCoverage[i], nSimilarity[i], nFresh[i]];
    const complete = parts.every(p => p !== null);
    return {
      ...r,
      nFitness: nFitness[i], nCoverage: nCoverage[i],
      nSimilarity: nSimilarity[i], nFresh: nFresh[i],
      total: complete ? Number(parts.reduce((a, b) => a + b, 0).toFixed(3)) : null,
    };
  });
}
