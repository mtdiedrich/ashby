// Pay stated in a job description, for postings whose ATS compensation field is empty.
//
// Surveyed 2026-10-02: of 2,380 scored postings with no structured pay, 1,458 had a
// money-looking line in the description, in a handful of shapes — Greenhouse's pay
// block ("$221,000—$331,000 USD"), a sentence ("The annual base salary range for this
// role is $180,000-$300,000"), K forms ("$200-235K"), hourly rates, other currencies,
// regional bands. Clera's read "Salary range: $150,000 to $250,000 USD annually" and
// the board showed nothing.
//
// The same descriptions are full of money that is not pay: funding rounds ("$400
// million Series D"), market size ("a $50B industry"), benefits ("Up to $25K
// reimbursement"). So:
//   - a RANGE is read anywhere, as long as one end carries a currency;
//   - a SINGLE figure only in a sentence about pay, never one about funding/benefits;
//   - anything in millions or billions is never pay;
//   - every figure has to be plausible for the period it claims (per year, hour, month).
// A wrong figure in the pay column is worse than none, so ambiguity resolves to null.

const CODES = 'USD|CAD|EUR|GBP|AUD|CHF|SGD';
const SIGN_CURRENCY = { '$': 'USD', '€': 'EUR', '£': 'GBP' };

// One money token as it appears in text, matched loosely and parsed by parseTok().
// The magnitude suffix owns its leading space, so "$200,000 + bonus" is not read as
// an open-ended "$200,000+"; a per-period unit may follow each figure
// ("$220,000/year - $260,000/year").
const UNIT = '(?:\\s?/\\s?(?:year|yr|hour|hr|month|mo)\\b)?';
const SUFFIX = '(?:\\s?(?:million|billion|bn|k|K|M|B))?(?![a-zA-Z])';
const TOK = `(?:(?:${CODES})(?:/[A-Z]{3})*\\s*)?[$€£]?\\s?\\d[\\d,.]*${SUFFIX}${UNIT}\\+?(?:\\s?(?:${CODES})\\b)?`;
// A token that carries a currency — a sign or a code. A bare number is never money.
const MONEY_TOK = `(?:(?:${CODES})(?:/[A-Z]{3})*\\s*[$€£]?\\s?|[$€£]\\s?)\\d[\\d,.]*${SUFFIX}${UNIT}\\+?(?:\\s?(?:${CODES})\\b)?`;
const RANGE = new RegExp(`(${TOK})(\\s*(?:-|–|—|~|to|and)\\s*)(${TOK})`, 'g');
// "from $187,000/year in our lowest market to $322,000/year in our highest"
const FROM_TO = new RegExp(`from\\s+(${TOK})([^\\n;$€£]{0,80}?\\bto\\s+)(${TOK})`, 'gi');
// "$176,612 $243,680 CAD" — no connector at all, so both ends must carry a currency.
// Its own pattern and the last resort: as an alternative connector inside RANGE, it
// paired the "1" of "Region 1 $172,550 - $203,000" with $172,550 and used up the range.
const ADJACENT = new RegExp(`(${MONEY_TOK})(\\s+)(${MONEY_TOK})`, 'g');
const SINGLE = new RegExp(MONEY_TOK, 'g');

const PAY_WORD = /\b(salary|salaries|compensation|pay|wage|wages|rate|base|OTE|earnings|annually)\b|per (hour|month|year)|hourly|p\/hour|\/\s?(hr|year|yr|month|mo)\b/i;
const SALARYISH = /\b(salary|compensation|pay range|base pay|wage|hourly|per hour)\b/i;
const NOT_PAY = /\b(raised|funding|series [a-h]\b|valuation|valued at|revenue|run.?rate|ARR|industry|investment|invested|acquired|reimburs\w*|stipend|subsid\w*|allowance|budget|401\(?k\)?|match|relocation|signing bonus)/i;

const PLAUSIBLE = { year: [15_000, 2_000_000], month: [1_000, 100_000], hour: [7, 1_000] };

function intervalOf(segment) {
  if (/per hour|hourly|p\/hour|\/\s?h(ou)?r\b|an hour\b/i.test(segment)) return 'hour';
  if (/per month|monthly|\/\s?mo(nth)?\b/i.test(segment)) return 'month';
  return 'year';
}

function kindOf(segment) {
  if (/total (cash )?comp|\bOTE\b|on.target/i.test(segment)) return 'total';
  if (/\bbase\b|salary/i.test(segment)) return 'base';
  return null;
}

/** "212,500.00" -> 212500, "120.000" -> 120000; malformed ("140,00") -> null. */
function parseNumber(s) {
  const n = s.replace(/[.,]$/, '');
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(n)) return Number(n.replace(/,/g, ''));
  if (/^\d{1,3}(\.\d{3})+$/.test(n)) return Number(n.replace(/\./g, ''));   // European grouping
  if (/^\d+(\.\d+)?$/.test(n)) return Number(n);
  return null;
}

/** "140,00": a thousands figure missing its last zero, or null if it is not that shape. */
function droppedZero(s) {
  const n = s.replace(/[.,]$/, '');
  return /^\d{1,3},\d{2}$/.test(n) ? Number(n.split(',')[0]) * 1000 : null;
}

const CODE_START = new RegExp('^(' + CODES + ')\\b');
const CODE_END = new RegExp('\\b(' + CODES + ')$');
const codeOf = t => t.match(CODE_START)?.[1] ?? t.match(CODE_END)?.[1] ?? null;
const signOf = t => t.match(/[$€£]/)?.[0] ?? null;

function parseTok(raw) {
  const t = raw.trim();
  const num = t.match(/\d[\d,.]*/)?.[0];
  if (!num) return null;
  const after = t.slice(t.indexOf(num) + num.length);
  const suffix = after.match(/^\s?(million|billion|bn|k|K|M|B)(?![a-zA-Z])/)?.[1] ?? null;
  if (suffix && /^(million|billion|bn|M|B)$/.test(suffix)) return { funding: true };
  let value = parseNumber(num);
  if (value == null) return { malformed: true, repaired: droppedZero(num), code: codeOf(t), sign: signOf(t) };
  const hasK = suffix === 'k' || suffix === 'K';
  // "$174,000K" — a K on a figure already in thousands is a typo, not 174 million.
  if (hasK && value < 1000) value *= 1000;
  // Open-ended only when the plus is attached: "$140,000+", not "$200,000 + bonus".
  return { value, hasK, code: codeOf(t), sign: signOf(t), plus: /[\dkKMB]\+/.test(t) };
}

const currencyOf = (...toks) =>
  toks.find(t => t?.code)?.code ?? SIGN_CURRENCY[toks.find(t => t?.sign)?.sign] ?? null;

const plausible = (v, interval) => v >= PLAUSIBLE[interval][0] && v <= PLAUSIBLE[interval][1];

function segmentsOf(text) {
  return String(text ?? '').split(/\n+/)
    .flatMap(line => line.split(/(?<=[.!?])\s+(?=[A-Z0-9$€£(•\-])/))
    .map(s => s.trim()).filter(Boolean);
}

/** Every pay statement in one segment of text. */
function candidatesIn(segment) {
  const salaryish = SALARYISH.test(segment);
  if (NOT_PAY.test(segment) && !salaryish) return [];
  const interval = intervalOf(segment);
  const kind = kindOf(segment);
  const out = [];
  let sawRange = false, unreadable = false;

  for (const re of [RANGE, FROM_TO, ADJACENT]) {
    if (out.length) break;                       // later shapes are fallbacks
    for (const m of segment.matchAll(re)) {
      sawRange = true;
      const a = parseTok(m[1]), b = parseTok(m[3]);
      if (!a || !b || a.funding || b.funding) continue;
      // "$140,00 - $180,000": a dropped zero, next to an end that is well formed.
      for (const [x, y] of [[a, b], [b, a]]) {
        if (x.malformed && x.repaired != null && !y.malformed && y.value >= 10_000) {
          Object.assign(x, { malformed: false, value: x.repaired, hasK: false });
        }
      }
      if (a.malformed || b.malformed) { unreadable = true; continue; }
      if (!(a.code || a.sign || b.code || b.sign)) continue;    // "2022 - 2024", "3-5 years"
      // "$200-235K": a K on one end belongs to both.
      if (b.hasK && !a.hasK && a.value < 1000) a.value *= 1000;
      if (a.hasK && !b.hasK && b.value < 1000) b.value *= 1000;
      const [min, max] = [a.value, b.value];
      if (!(min <= max) || !plausible(min, interval) || !plausible(max, interval)) continue;
      out.push({ min, max, currency: currencyOf(a, b), interval, kind, text: segment, isRange: true });
    }
  }
  if (out.length || unreadable || (sawRange && !PAY_WORD.test(segment))) return out;

  // A single figure, only where the sentence is about pay.
  if (!PAY_WORD.test(segment) || NOT_PAY.test(segment)) return out;
  for (const m of segment.matchAll(SINGLE)) {
    const t = parseTok(m[0]);
    if (!t || t.funding || t.malformed || !plausible(t.value, interval)) continue;
    // "up to $200" is a ceiling, not the pay.
    const ceiling = /up to\s*$/i.test(segment.slice(Math.max(0, m.index - 8), m.index));
    out.push({ min: ceiling ? null : t.value, max: t.plus ? null : t.value, currency: currencyOf(t),
               interval, kind, text: segment, isRange: false });
  }
  return out;
}

/**
 * The pay a description states, or null.
 * @returns {null | {min, max, currency, interval, kind, ranges, text}}
 *   max is null for an open-ended "$500k+", min null for a ceiling ("up to $200");
 *   kind is 'base', 'total' or null; ranges counts the distinct ranges combined
 *   (regional bands give their full span).
 */
export function payFromText(text) {
  const all = segmentsOf(text).flatMap(candidatesIn);
  if (!all.length) return null;

  // Ranges beat single figures; USD beats other currencies; a year beats other periods.
  let pick = all.some(c => c.isRange) ? all.filter(c => c.isRange) : all;
  if (pick.some(c => c.currency === 'USD')) pick = pick.filter(c => c.currency === 'USD');
  else pick = pick.filter(c => c.currency === pick[0].currency);
  const interval = pick.some(c => c.interval === 'year') ? 'year' : pick[0].interval;
  pick = pick.filter(c => c.interval === interval);

  const distinct = [...new Map(pick.map(c => [`${c.min}-${c.max}`, c])).values()];
  const kinds = new Set(distinct.map(c => c.kind));
  const min = distinct.some(c => c.min == null) ? null : Math.min(...distinct.map(c => c.min));
  const max = distinct.some(c => c.max == null) ? null : Math.max(...distinct.map(c => c.max));
  // An open figure ("$90K+") beside a ceiling ("up to $20k") leaves neither end — no
  // figure at all. 67 postings did this once every description was stored.
  if (min == null && max == null) return null;
  return {
    min,
    max,
    currency: distinct[0].currency,
    interval,
    kind: kinds.size === 1 ? distinct[0].kind : null,
    ranges: distinct.length,
    text: distinct[0].text.slice(0, 240),
  };
}

// One formatter, not toLocaleString(locale, options) per call — that builds a new one
// each time, and the board formats a figure for each of ~230,000 rows per request.
const NUMBER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

const SYMBOL = { USD: '$', EUR: '€', GBP: '£', CAD: 'CA$', AUD: 'A$', SGD: 'S$', CHF: 'CHF ' };

/** "$150K – $250K", "$30 – $50/hr", "€60K – €120K", "$500K+", "up to $200/hr" — or null. */
export function paySummary(p) {
  // Neither end: payFromText no longer produces it, but a crawl before that stored it
  // as descPay on rows that will not be rewritten until their posting changes.
  if (!p || (p.min == null && p.max == null)) return null;
  const sym = SYMBOL[p.currency] ?? (p.currency ? p.currency + ' ' : '');
  const fmt = v => p.interval === 'year'
    ? sym + Math.round(v / 1000) + 'K'
    : sym + NUMBER.format(v);
  const per = p.interval === 'hour' ? '/hr' : p.interval === 'month' ? '/mo' : '';
  if (p.min == null) return 'up to ' + fmt(p.max) + per;
  if (p.max == null) return fmt(p.min) + '+' + per;
  if (p.min === p.max) return fmt(p.min) + per;
  return fmt(p.min) + ' – ' + fmt(p.max) + per;
}

/**
 * The pay a corpus record's description states. Crawl reads it once and stores it as
 * `descPay` (null when the text states none), since the corpus no longer carries the
 * text; only a row written before that is parsed here.
 */
export function statedPay(rec) {
  const p = rec && 'descPay' in rec ? rec.descPay : payFromText(rec?.description ?? '');
  // A figure with neither end, stored before payFromText stopped producing one.
  return p && (p.min != null || p.max != null) ? p : null;
}
