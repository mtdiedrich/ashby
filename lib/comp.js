// Compensation parsing for the Ashby posting API.
//
// Verified against live boards 2026-09-13. The shape is:
//   compensation.summaryComponents[] = {
//     compensationType: 'Salary' | 'EquityPercentage' | 'Bonus' | 'Commission' | ...,
//     interval: '1 YEAR' | '1 HOUR' | '1 MONTH' | '1 WEEK' | 'NONE',
//     currencyCode: 'USD' | 'EUR' | ... | null,
//     minValue: number | null,
//     maxValue: number | null,
//   }
// compensationTierSummary is a STRING ("€110K – €185K • Offers Equity"), not an object.
// When an org publishes nothing, summaryComponents is [] and the summaries are null.

// Rough FX, USD per unit. Only used to compare against a USD pay floor, so
// precision does not matter much. Refresh occasionally.
const FX = {
  USD: 1, EUR: 1.08, GBP: 1.27, CAD: 0.73, AUD: 0.66, NZD: 0.61,
  CHF: 1.12, SEK: 0.095, NOK: 0.093, DKK: 0.145, JPY: 0.0067,
  SGD: 0.75, INR: 0.012, BRL: 0.18, MXN: 0.05, PLN: 0.25, ILS: 0.27,
};

// Hours/periods per year, for annualising.
const PER_YEAR = { '1 YEAR': 1, '1 MONTH': 12, '1 WEEK': 52, '1 DAY': 260, '1 HOUR': 2080 };

/**
 * Pull the salary component out of a posting.
 * @returns {null | {min, max, currency, interval, annualUsdMin, annualUsdMax, summary}}
 *          null when the posting publishes no salary range at all.
 */
export function salaryOf(job) {
  const c = job?.compensation;
  if (!c) return null;

  const pools = [c.summaryComponents, ...(c.compensationTiers ?? []).map(t => t.components)];
  let comp = null;
  for (const pool of pools) {
    comp = (pool ?? []).find(x => x?.compensationType === 'Salary' &&
                                 (x.minValue != null || x.maxValue != null));
    if (comp) break;
  }
  if (!comp) return null;

  const mult = PER_YEAR[comp.interval];
  const fx = FX[comp.currencyCode];
  // Unknown interval or currency: report the raw numbers but no USD comparison,
  // so the hard filter lets it through and the model reads the description.
  const usd = (v) => (v == null || mult == null || fx == null) ? null : Math.round(v * mult * fx);

  return {
    min: comp.minValue,
    max: comp.maxValue,
    currency: comp.currencyCode,
    interval: comp.interval,
    annualUsdMin: usd(comp.minValue),
    annualUsdMax: usd(comp.maxValue),
    summary: c.scrapeableCompensationSalarySummary ?? c.compensationTierSummary ?? null,
  };
}

/**
 * Hard pay filter. Deliberately permissive: unknown pay passes so the model can
 * read the description. Only a *stated* range that tops out below the floor fails.
 * @returns {{pass: boolean, known: boolean, salary: object|null}}
 */
export function payPasses(job, floorUsd) {
  const s = salaryOf(job);
  if (!s) return { pass: true, known: false, salary: null };
  const top = s.annualUsdMax ?? s.annualUsdMin;
  if (top == null) return { pass: true, known: false, salary: s };
  return { pass: top >= floorUsd, known: true, salary: s };
}
