// What a run actually cost, from response.usage.
//
// Nothing here recorded usage, so the bill could only be estimated by reading the
// code — and the largest unknown was invisible that way: Sonnet 5 runs adaptive
// thinking, thinking is billed as output, and thinking tokens never appear in the
// stored scores. Measuring beats estimating, and it is free.

/**
 * Per-million-token rates, checked against the live pricing page. These go stale —
 * the report prints the date so a number is never quoted as current when it isn't.
 * Source: platform.claude.com/docs/en/about-claude/pricing
 */
export const PRICES = {
  checkedOn: '2026-09-20',
  models: {
    'claude-opus-5':   { in: 5, out: 25 },
    'claude-sonnet-5': { in: 2, out: 10 },
    'claude-haiku-4-5': { in: 1, out: 5 },
    'claude-fable-5-1': { in: 10, out: 50 },
  },
  // Multipliers on the model's input rate.
  cacheRead: 0.1,
  cacheWrite5m: 1.25,
  cacheWrite1h: 2,
  batchDiscount: 0.5,     // applies to every token, cache reads and writes included
};

/** Model ids are pinned snapshots; `claude-haiku-4-5-20251001` is still Haiku 4.5. */
const rateFor = (model) => {
  const id = String(model ?? '');
  if (PRICES.models[id]) return PRICES.models[id];
  const base = Object.keys(PRICES.models).find(k => id.startsWith(k));
  return base ? PRICES.models[base] : null;
};

/**
 * Dollars for one response's usage, or null when the model is not in the table —
 * null rather than 0, so an unpriced model shows as unknown instead of free.
 */
export function costOf(usage, model, { batch = false } = {}) {
  const r = rateFor(model);
  if (!r) return null;
  const u = usage ?? {};
  const n = k => Number(u[k] ?? 0);

  // ephemeral_1h is reported separately when the 1-hour TTL is used; fall back to
  // the flat field, which is what the 5-minute default reports.
  const write1h = Number(u.cache_creation?.ephemeral_1h_input_tokens ?? 0);
  const write5m = Number(u.cache_creation?.ephemeral_5m_input_tokens ?? 0)
                || (n('cache_creation_input_tokens') - write1h);

  const dollars =
      n('input_tokens')             * r.in  / 1e6
    + n('output_tokens')            * r.out / 1e6
    + n('cache_read_input_tokens')  * r.in  * PRICES.cacheRead   / 1e6
    + Math.max(0, write5m)          * r.in  * PRICES.cacheWrite5m / 1e6
    + write1h                       * r.in  * PRICES.cacheWrite1h / 1e6;

  return batch ? dollars * PRICES.batchDiscount : dollars;
}

/** Roll a usage log up by label — one row per thing that spends. */
export function summarise(rows) {
  const by = new Map();
  for (const row of rows ?? []) {
    const key = row?.label ?? 'unlabelled';
    const acc = by.get(key) ?? {
      label: key, model: row?.model ?? '?', calls: 0, items: 0, cost: 0,
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
    };
    const u = row?.usage ?? {};
    acc.calls++;
    acc.items += Number(row?.items ?? 1);
    acc.cost += costOf(u, row?.model, { batch: !!row?.batch }) ?? 0;
    acc.input += Number(u.input_tokens ?? 0);
    acc.output += Number(u.output_tokens ?? 0);
    acc.cacheRead += Number(u.cache_read_input_tokens ?? 0);
    acc.cacheWrite += Number(u.cache_creation_input_tokens ?? 0);
    by.set(key, acc);
  }

  const byLabel = [...by.values()].map(a => ({
    ...a,
    perItem: a.items ? a.cost / a.items : 0,
    // Of the input actually billed, how much came from the cache. The only evidence
    // there is that a cache_control marker is doing anything.
    cacheHitRate: (a.cacheRead + a.input) ? a.cacheRead / (a.cacheRead + a.input) : 0,
  })).sort((x, y) => y.cost - x.cost);

  const total = byLabel.reduce((a, r) => a + r.cost, 0);
  for (const r of byLabel) r.share = total ? r.cost / total : 0;
  return { total, byLabel };
}
