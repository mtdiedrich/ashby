// Ask again for the parts of a batched reply that never came back.
//
// fitness.js sends BATCH postings in one request and matches the reply to postings
// by an `index` attribute the model echoes back. Structured output guarantees the
// shape of the reply, not its completeness: a request for eight postings can return
// seven well-formed results, and the eighth posting is then simply unscored.
//
// Measured on a real run: 16 of 856 postings (1.9%) had coverage but no fitness that
// way, against 1 for the one-posting-per-request scorer. Every one of the 16 scored
// normally when asked again, so the gap was the batching, not the postings.

/**
 * @template T
 * @param {number[]} want                  indices this batch is responsible for
 * @param {(indices: number[]) => Promise<T[]>} run   makes the request for those indices
 * @param {object} [opts]
 * @param {number} [opts.retries=1]        extra attempts for whatever is still missing
 * @returns {Promise<{results: T[], missing: number[]}>}
 */
export async function completeBatch(want, run, { retries = 1 } = {}) {
  const have = new Map();

  const take = (rows) => {
    for (const r of rows ?? []) {
      // Ignore an index nobody asked for: the model occasionally renumbers, and
      // attaching that to a posting it does not belong to is worse than a gap.
      // First writer wins, so a duplicate cannot overwrite a good result.
      if (want.includes(r?.index) && !have.has(r.index)) have.set(r.index, r);
    }
  };

  // A throw on the first pass is a real failure (rate limit, refusal) and belongs to
  // the caller, which already isolates it per batch. A throw on a retry is not worth
  // losing the results we do have.
  take(await run(want));

  for (let attempt = 0; attempt < retries; attempt++) {
    const missing = want.filter(i => !have.has(i));
    if (!missing.length) break;
    try { take(await run(missing)); }
    catch { break; }
  }

  return {
    results: want.filter(i => have.has(i)).map(i => have.get(i)),
    missing: want.filter(i => !have.has(i)),
  };
}
