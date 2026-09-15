// Run async work a few at a time.
//
// Every scoring pass in this project was a `for (const x of xs) await ask(x)`, which
// spends essentially all of its wall clock waiting on one HTTP round trip at a time.
// Measured on a 444-posting run: requirements 22.6 min, coverage 50.1 min, fitness
// 39.8 min — about an hour and fifty minutes, almost none of it computing anything.
//
// Two details that are easy to get wrong and both cost money here:
//
//   * Results come back in INPUT order. The callers index postings by position
//     (fitness sends `<posting index="N">` and matches the reply on it), so
//     completion order would silently attach scores to the wrong postings.
//
//   * `warmup` runs the first item alone. The system prompt carries context.md and
//     the resume PDF with cache_control, so the first call WRITES the cache and the
//     rest READ it. Opening at full width means the entire first wave misses, and
//     each one pays the write premium rather than one paying it and the others
//     reading at ~0.1x. One extra round trip buys that back on every later call.

/**
 * @template T, R
 * @param {T[]} items
 * @param {(item: T, index: number) => Promise<R>} worker
 * @param {object} [opts]
 * @param {number} [opts.limit=6]      how many run at once
 * @param {() => void} [opts.onDone]   called once per completed item, for a progress bar
 * @param {boolean} [opts.warmup]      run the first item alone before opening up
 * @returns {Promise<Array<{ok: true, value: R} | {ok: false, error: Error}>>} input order
 */
export async function pool(items, worker, { limit = 6, onDone, warmup = false } = {}) {
  const list = [...items];
  const out = new Array(list.length);
  if (!list.length) return out;

  const run = async (i) => {
    try { out[i] = { ok: true, value: await worker(list[i], i) }; }
    catch (error) { out[i] = { ok: false, error }; }
    onDone?.();
  };

  let next = 0;
  // The warmup call is not special-cased beyond running first and alone: if it
  // throws, that is recorded like any other failure and the rest still run.
  if (warmup) { next = 1; await run(0); }

  const width = Math.max(1, Math.min(limit, list.length - next));
  await Promise.all(Array.from({ length: width }, async () => {
    while (next < list.length) await run(next++);
  }));

  return out;
}

/**
 * Concurrency from `--jobs N`, falling back to ASHBY_JOBS then the default.
 *
 * Six is deliberate rather than arbitrary: the scoring calls carry a large cached
 * prefix, and the ceiling that matters is the account's tokens-per-minute window
 * rather than requests-per-minute. `ask()` already retries a 429 with exponential
 * backoff, so overshooting costs latency rather than results — but it costs the
 * cache too, since a retried call may land after the cache entry has expired.
 */
export function jobsFlag(argv, fallback = 6) {
  const i = argv.indexOf('--jobs');
  const raw = i >= 0 ? argv[i + 1] : process.env.ASHBY_JOBS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}
