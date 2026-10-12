import { paySummary } from './pay-text.js';

// Splitting a board row into what the table draws and what the expanded pane draws.
//
// One /api/board response was 5.8 MB for 600 rows — 3.4 MB of job descriptions and
// 1.7 MB of requirement evidence, all of it for panes that stay hidden until a row is
// expanded. The table needs none of it to draw a row, and render() rebuilt every byte
// of it as HTML on each keystroke in the search box.

/** The fields only the expanded pane reads. */
export const HEAVY = [
  'description', 'payText',
  'applyUrl', 'jobUrl', 'department', 'team', 'workplaceType', 'employmentType',
];

/** Everything a table row draws — the columns, the state chip, and the id. */
export function summaryOf(row) {
  const r = row ?? {};
  const out = {};
  for (const k of ['id', 'title', 'slug', 'location', 'pay', 'fitness',
                   'fresh', 'value', 'daysLive',
                   'state', 'ats', 'fillable', 'payFrom', 'payEst']) {
    if (k in r) out[k] = r[k];
    // The table reads these unconditionally, so they must exist even when absent
    // upstream — a missing key renders "undefined", a null renders the em dash.
    else if (['fitness', 'fresh', 'value', 'daysLive'].includes(k)) out[k] = null;
  }
  return out;
}

/** Everything the expanded pane draws, fetched only when a row is opened. */
export function detailOf(row) {
  const r = row ?? {};
  return {
    description: r.description ?? '',
    payText: r.payText ?? null,
    applyUrl: r.applyUrl ?? null,
    jobUrl: r.jobUrl ?? null,
    department: r.department ?? null,
    team: r.team ?? null,
    workplaceType: r.workplaceType ?? null,
    employmentType: r.employmentType ?? null,
  };
}

/**
 * The board's default ordering — by `value`, which is what the page sorts on.
 *
 * The server used to order by fitness and slice the top N, while the page ordered
 * what it received by value. Every posting under two days old scored below the
 * fitness cutoff and was never sent, so the board's freshest row was two days old
 * while seven newer ones sat on disk unshown. A slice taken on one ordering cannot
 * serve a view ordered by another.
 *
 * Rows with no value sort last rather than first — `null` means "not computed on
 * every front yet", not "worthless" — and fall back to fitness.
 */
export function byValue(a, b) {
  const av = a?.value, bv = b?.value;
  if (av != null && bv != null && av !== bv) return bv - av;
  if (av != null && bv == null) return -1;
  if (av == null && bv != null) return 1;
  return (b?.fitness ?? -1) - (a?.fitness ?? -1);
}

/**
 * The levels.fyi estimate a row carries, or null.
 *
 * Only where the posting publishes no pay — an estimate is what people at the company
 * reported, not what this posting offers, and it never stands in for published pay.
 * Kept small, because it rides on every row of the table.
 */
export function payEstimateOf(pay, rec) {
  if (pay || !rec || rec.none || rec.base == null) return null;
  return {
    base: rec.base, low: rec.baseLow ?? null, high: rec.baseHigh ?? null, total: rec.total ?? null,
    kind: rec.kind, level: rec.level ?? null, count: rec.count, company: rec.company ?? null,
    url: rec.url ?? null,
  };
}

/**
 * What the pay column shows, from three sources in order:
 *   1. the posting's own pay field;
 *   2. pay stated in the description (lib/pay-text.js) — Clera's said "Salary range:
 *      $150,000 to $250,000 USD annually" with the field empty;
 *   3. only then a levels.fyi estimate, which is what people at the company reported
 *      rather than anything this posting says.
 * `payFrom` says which of the first two it was, so the board can say so.
 */
export function payForRow(posted, textPay, estimateRec) {
  if (posted) return { pay: posted, payFrom: 'posting', payEst: null };
  const fromText = paySummary(textPay);
  if (fromText) return { pay: fromText, payFrom: 'description', payEst: null };
  return { pay: null, payFrom: null, payEst: payEstimateOf(null, estimateRec) };
}
