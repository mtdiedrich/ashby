import { test } from 'node:test';
import assert from 'node:assert/strict';
import { payFromText, paySummary } from '../lib/pay-text.js';

// Pay written into the job description rather than the ATS's compensation field.
// Surveyed 2026-10-02: of 2,380 scored postings with no structured pay, 1,458 had a
// money-looking line in the description. Clera's read "Salary range: $150,000 to
// $250,000 USD annually" and the board showed no pay at all.
//
// Every phrasing below is taken from a real posting in the corpus.

const range = (text) => { const p = payFromText(text); return p && [p.min, p.max, p.currency, p.interval]; };

// ---- the formats -----------------------------------------------------------------

test('Clera: "Salary range: $X to $Y USD annually"', () => {
  assert.deepEqual(range('COMPENSATION & BENEFITS\nSalary range: $150,000 to $250,000 USD annually'),
    [150000, 250000, 'USD', 'year']);
});

test('the Greenhouse pay block: "$221,000—$331,000 USD"', () => {
  assert.deepEqual(range('Pay range\n$221,000—$331,000 USD'), [221000, 331000, 'USD', 'year']);
});

test('in a sentence, with a hyphen or an en dash', () => {
  assert.deepEqual(range('The annual base salary range for this role is $180,000-$300,000 (USD) , which does not include bonus.'),
    [180000, 300000, 'USD', 'year']);
  assert.deepEqual(range('Base salary: $250,000–$325,000 USD annually. Equity: 0.15%–0.30%.'),
    [250000, 325000, 'USD', 'year']);
});

test('"ranges from $X to $Y" and "between $X and $Y"', () => {
  assert.deepEqual(range('the reasonably estimated salary for this role ranges from $311,850 to $350,625, plus equity.'),
    [311850, 350625, 'USD', 'year']);
  assert.deepEqual(range('The pay range for this role is between $180,000 and $250,000, depending on skills.'),
    [180000, 250000, 'USD', 'year']);
});

test('"from $X/year in our lowest market to $Y/year in our highest"', () => {
  assert.deepEqual(range('The base pay for this position ranges from $187,000/year in our lowest geographic market to $322,000/year in our highest geographic market.'),
    [187000, 322000, 'USD', 'year']);
});

test('K forms, including a K shared by both ends', () => {
  assert.deepEqual(range('Compensation: The base salary range is $200-235K, with flexibility.'), [200000, 235000, 'USD', 'year']);
  assert.deepEqual(range('- The base salary range for this role is $150K – $250K, depending on experience.'), [150000, 250000, 'USD', 'year']);
  assert.deepEqual(range('$150k-170k'), [150000, 170000, 'USD', 'year']);
});

test('decimals in the figures', () => {
  assert.deepEqual(range('the expected total cash compensation range for the role is currently $212,500.00 - $275,000.00.'),
    [212500, 275000, 'USD', 'year']);
});

test('a K on a figure already in thousands is a typo, not millions', () => {
  assert.deepEqual(range('The base pay for this position ranges from $174,000K/year to $299,000K/year.'),
    [174000, 299000, 'USD', 'year']);
});

test('hourly ranges and rates', () => {
  assert.deepEqual(range('We offer a pay range of $30-$50 per hour, with the exact rate determined later.'), [30, 50, 'USD', 'hour']);
  assert.deepEqual(range('The expected hourly salary range for this position is $25-$30 p/hour, based on experience.'), [25, 30, 'USD', 'hour']);
  assert.deepEqual(range('$90 per hour'), [90, 90, 'USD', 'hour']);
});

test('other currencies are kept as they are', () => {
  assert.deepEqual(range('Salary range: 60,000 to 120,000 EUR annually'), [60000, 120000, 'EUR', 'year']);
  assert.deepEqual(range('💰 £115,000 - £150,000 + Incentive Awards'), [115000, 150000, 'GBP', 'year']);
  assert.deepEqual(range('$157,400—$196,800 CAD'), [157400, 196800, 'CAD', 'year']);
});

test('given a USD range and another currency, USD wins', () => {
  assert.deepEqual(range('Pay Range: USD $172,000-$215,000 (United States) / CAD $172,000-$220,000 (Canada)'),
    [172000, 215000, 'USD', 'year']);
  assert.deepEqual(range('base salary range for this role is between $200,000-$220,000 (€170,000-€190,000).'),
    [200000, 220000, 'USD', 'year']);
});

test('several regional USD ranges give their full span', () => {
  const p = payFromText('Region 1: $172,550 - $203,000\nRegion 2: $155,300 - $182,700\nRegion 3: $146,700 - $172,550');
  assert.deepEqual([p.min, p.max, p.ranges], [146700, 203000, 3]);
});

test('a single figure counts in a sentence about pay', () => {
  const p = payFromText('- $500k+ total compensation including base salary, bonus, equity');
  assert.deepEqual([p.min, p.max, p.kind], [500000, null, 'total']);
});

// ---- what is not pay ---------------------------------------------------------------

test('funding, valuation and market size are not pay', () => {
  for (const t of [
    'Lightmatter raised $400 million in its Series D round, reaching a valuation of $4.4 billion.',
    'In a $50B industry hungry for change, Nava is built to win.',
    'We are around 180 people, fully remote, backed by a $150M Series C investment from a16z.',
    'With $43M in funding from Founders Fund, Greylock and others.',
    'Backed by our founders’ exits, acquired for a combined $180M in 2022.',
    'We have scaled from $0 to a multi-eight-figure run rate in a matter of months',
  ]) assert.equal(payFromText(t), null, t);
});

test('benefits amounts are not pay', () => {
  for (const t of [
    'Up to $25K reimbursement for fertility, adoption, and parental planning services',
    '401k (+ 50% company match up to 6% of pay), FSA, HSA, life insurance',
    'A $2,000 annual learning stipend and a $500 home office budget',
  ]) assert.equal(payFromText(t), null, t);
});

test('implausible magnitudes are rejected for the period they claim', () => {
  assert.equal(payFromText('Salary: $12 - $18 USD annually'), null);
  assert.equal(payFromText('Pay range: $90,000 - $120,000 per hour'), null);
});

test('no description, no pay', () => {
  assert.equal(payFromText(''), null);
  assert.equal(payFromText(null), null);
  assert.equal(payFromText('Competitive salary and 401k with employer match'), null);
});

test('the matched text rides along, so the board can show where it came from', () => {
  const p = payFromText('Intro.\nSalary range: $150,000 to $250,000 USD annually\nMore.');
  assert.match(p.text, /Salary range: \$150,000 to \$250,000 USD annually/);
});

test('base or total is read off the wording', () => {
  assert.equal(payFromText('The annual base salary range for this role is $180,000-$300,000').kind, 'base');
  assert.equal(payFromText('the expected total cash compensation range is $212,500 - $275,000').kind, 'total');
  assert.equal(payFromText('$221,000—$331,000 USD').kind, null);
});

// ---- how it reads in the pay column -----------------------------------------------------

test('summaries read like the posted pay they sit beside', () => {
  assert.equal(paySummary(payFromText('Salary range: $150,000 to $250,000 USD annually')), '$150K – $250K');
  assert.equal(paySummary(payFromText('$30-$50 per hour')), '$30 – $50/hr');
  assert.equal(paySummary(payFromText('Salary range: 60,000 to 120,000 EUR annually')), '€60K – €120K');
  assert.equal(paySummary(payFromText('$157,400—$196,800 CAD')), 'CA$157K – CA$197K');
  assert.equal(paySummary(payFromText('- $500k+ total compensation')), '$500K+');
  assert.equal(paySummary(payFromText('$90 per hour')), '$90/hr');
  assert.equal(paySummary(null), null);
});

// ---- found running it over the real corpus, 2026-10-02 ------------------------------

test('two amounts side by side, both with a currency, are a range', () => {
  assert.deepEqual(range('Our salary range is $176,612 $243,680 CAD'), [176612, 243680, 'CAD', 'year']);
});

test('a unit on each end: "$220,000/year - $260,000/year"', () => {
  assert.deepEqual(range('- $220,000/year - $260,000/year + equity + benefits'), [220000, 260000, 'USD', 'year']);
});

test('a dropped zero inside a range is read as the thousands it obviously is', () => {
  // Four postings: "$140,00 - $180,000", "$180,000 - $220,00", "$152,00/year to
  // $261,000/year", "$167,00 - $227,000". Next to a well-formed end, "140,00" is 140,000.
  assert.deepEqual(range('The estimated total compensation range for this position is $140,00 - $180,000 (base plus bonus).'),
    [140000, 180000, 'USD', 'year']);
  assert.deepEqual(range('the minimum and maximum full-time annual base salary for this role is $180,000 - $220,00 at the time of posting'),
    [180000, 220000, 'USD', 'year']);
  assert.deepEqual(range('The base pay for this position ranges from $152,00/year to $261,000/year.'),
    [152000, 261000, 'USD', 'year']);
});

test('"+ bonus" after a figure is not an open-ended salary', () => {
  const p = payFromText('The base salary range for this position is $200,000 + bonus + stock options + benefits');
  assert.deepEqual([p.min, p.max], [200000, 200000]);
  const q = payFromText('Base salary: $140,000+, depending on experience, skills, and location.');
  assert.deepEqual([q.min, q.max], [140000, null], 'attached, it is');
});

test('"up to $X" is a ceiling, not the pay', () => {
  const p = payFromText('Researchers looking for your skills tend to pay up to $200 per hour.');
  assert.deepEqual([p.min, p.max, p.interval], [null, 200, 'hour']);
  assert.equal(paySummary(p), 'up to $200/hr');
});

test('a monthly figure is pay, and reads with thousands separators', () => {
  assert.equal(paySummary(payFromText('- $8,000 per month')), '$8,000/mo');
  assert.equal(paySummary(payFromText('- Compensation: $12-15k/month depending on experience')), '$12,000 – $15,000/mo');
});

test('small monthly and yearly perks still are not pay', () => {
  for (const t of ['- $500 per month credit for waiving medical benefits', '- $500/year Function Health subscription',
    '- USD 2,500 per year for flights home', '- $200/month Health & Wellness stipend']) {
    assert.equal(payFromText(t), null, t);
  }
});

test('regional bands with no colon: "Region 1 $172,550 - $203,000"', () => {
  // A bare-space connector once paired the "1" with "$172,550", which used up the
  // real range and lost Oura's pay entirely.
  const p = payFromText('Region 1 $172,550 - $203,000\nRegion 2 $158,950 - $187,000\nRegion 3 $147,900 - $174,000');
  assert.deepEqual([p.min, p.max, p.ranges], [147900, 203000, 3]);
});

test('a housing subsidy is not pay', () => {
  assert.equal(payFromText('- Housing subsidy of $2,500 per month for those living within walking distance of the office'), null);
  assert.equal(payFromText('Housing subsidy of $2,000/month for those living within walking distance of the office'), null);
});

// Once every description was stored, 67 postings came back with pay that had neither
// end — an open figure ("$90K+") combined with a ceiling ("up to $20k"), or "up to
// $125,000+" — and the board crashed formatting it. No end is no figure: ambiguity
// resolves to null.
test('pay with neither a floor nor a ceiling is no pay, not a crash', () => {
  assert.equal(payFromText('Earning Potential: up to $125,000+ per year (Based on caseload volume)'), null);
  assert.equal(payFromText('- $70k with the ability to earn up to $20k in incentives (Therapists with a CA license in hand are eligible for base salary of $90K+ monthly productivity incentive.)'), null);
});

test('paySummary of a stored figure with neither end is null', () => {
  // descPay stored by a crawl before the fix above, on a row the next crawl leaves alone.
  assert.equal(paySummary({ min: null, max: null, currency: 'USD', interval: 'year' }), null);
});

test('statedPay treats a stored figure with neither end as no pay', async () => {
  const { statedPay } = await import('../lib/pay-text.js');
  assert.equal(statedPay({ descPay: { min: null, max: null, currency: 'USD', interval: 'year' } }), null);
});
