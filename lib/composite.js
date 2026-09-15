// One number out of the four columns.
//
// fitness, coverage and similarity are on different scales — fitness and coverage
// run 0..1 but rarely use the top half, similarity is a centred cosine that sits
// around 0.1-0.25 and can go negative. Summing them raw would let whichever happens
// to have the widest spread dominate. Min-maxing each across the rows being compared
// puts them on equal footing.
//
// Days live is inverted: fresher is better, so a 2-day-old posting normalises toward
// 1 and a 200-day-old one toward 0. Without that the total would reward stale
// listings, which is the opposite of useful.
//
// Normalisation is relative to the rows handed in, not absolute. A 0.2 fitness is the
// best score in a set where nothing beats 0.2 — the total ranks within what you are
// looking at, and shifts when you change the filters. That is the intent.

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
  const nFresh      = minMax(rows.map(r => r.daysLive   ?? null), { invert: true });

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
