import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { familyFor, seniorityOf, levelMatch, estimateFrom, parseNextData, levelsSlug, needsEstimate,
  estimatesById, due, isBlocked, nameMatches }
  from '../lib/levels.js';

// Pay estimates from levels.fyi, for postings that publish no pay. Display only.
//
// Shapes below are trimmed from live pages, 2026-10-02. Two facts drove the design:
//   - levels.fyi has no machine-learning-engineer family; ML engineers are filed
//     under software-engineer with a focus tag. Titles have to map onto families.
//   - the family-wide `percentiles` can describe ANOTHER COUNTRY even on the
//     /locations/united-states URL (DailyPay: United Kingdom; Scale AI: Switzerland,
//     one sample). The per-level `averages` are US-filtered, and their samples carry
//     a countryId (254 = United States) that can be checked.

// ---- fixtures ----------------------------------------------------------------

const US = 254, UK = 253;
const sample = (countryId = US) => ({ countryId, baseSalary: 1, totalCompensation: 1 });
const avg = (level, names, count, base, total, countries = [US]) => ({
  count, base, total, level, secondaryLevelName: names[1] ?? names[0], titles: names,
  samples: countries.map(sample),
});

// Pinterest software-engineer, US: IC levels with a title per level.
const PINTEREST = {
  company: { name: 'Pinterest', slug: 'pinterest' },
  jobFamilySlug: 'software-engineer',
  percentiles: { base_salary: { p25: 198000, p50: 201000, p75: 250000 }, tc: { p50: 380000 }, count: 32, locationName: 'United States' },
  averages: [
    avg('ic13', ['IC13', 'Software Engineer I'], 19, 162658, 206320),
    avg('ic14', ['IC14', 'Software Engineer II'], 12, 198008, 286084),
    avg('ic15', ['IC15', 'Senior Software Engineer'], 10, 243500, 429067),
    avg('ic16', ['IC16', 'Staff Software Engineer'], 4, 276346, 735343),
    avg('ic17', ['IC17', 'Senior Staff Software Engineer'], 7, 315878, 1052015),
    avg('ic18', ['IC18', 'Principal Software Engineer'], 2, 400000, 1600000),
  ],
};
// Anthropic: titles are the level names, and there is a Lead level.
const ANTHROPIC = {
  company: { name: 'Anthropic', slug: 'anthropic' },
  jobFamilySlug: 'software-engineer',
  percentiles: { base_salary: { p25: 290000, p50: 320000, p75: 400000 }, tc: { p50: 560000 }, count: 23, locationName: 'United States' },
  averages: [
    avg('software-engineer', ['Software Engineer'], 3, 300000, 400000),
    avg('senior-software-engineer', ['Senior Software Engineer'], 13, 340000, 520000),
    avg('lead-software-engineer', ['Lead Software Engineer'], 10, 380000, 700000),
    avg('staff-software-engineer', ['Staff Software Engineer'], 4, 420000, 900000),
  ],
};
// DailyPay: thin, and its family percentiles are the UK's.
const DAILYPAY = {
  company: { name: 'DailyPay', slug: 'dailypay' },
  jobFamilySlug: 'software-engineer',
  percentiles: { base_salary: { p25: 54000, p50: 150000, p75: 160000 }, tc: { p50: 160000 }, count: 16, locationName: 'United Kingdom' },
  averages: [
    avg('software-engineer-i', ['Software Engineer I'], 2, 120000, 125000),
    avg('senior-software-engineer', ['Senior Software Engineer'], 3, 175000, 190000, [US, US, UK]),
  ],
};

// ---- titles to families -------------------------------------------------------

test('engineering titles, ML and AI included, are the software-engineer family', () => {
  for (const t of ['Senior Machine Learning Engineer', 'AI Engineer', 'Staff ML Platform Engineer (MLOps)',
    'Senior Software Engineer, Applied AI', 'Research Engineer', 'LLM Application Engineer', 'Senior Python Engineer - LLM Code Evaluation']) {
    assert.equal(familyFor(t), 'software-engineer', t);
  }
});

test('data scientists and engineering managers have their own families', () => {
  assert.equal(familyFor('Product-Focused Data Scientist (LLM Products)'), 'data-scientist');
  assert.equal(familyFor('Engineering Manager, ML Platform'), 'software-engineering-manager');
  assert.equal(familyFor('Manager, Machine Learning Engineering'), 'software-engineering-manager');
});

test('a title with no reliable family gets none, rather than the nearest', () => {
  for (const t of ['Research Scientist', 'Applied AI Scientist, Autonomous Defense', 'Solutions Engineer',
    'Sales Engineer', 'Account Executive', 'Customer Support Engineer']) {
    assert.equal(familyFor(t), null, t);
  }
});

test('seniority is read from the title', () => {
  assert.equal(seniorityOf('Senior Machine Learning Engineer'), 'senior');
  assert.equal(seniorityOf('Sr. AI Engineer, CX'), 'senior');
  assert.equal(seniorityOf('Senior Staff Software Engineer'), 'senior staff');
  assert.equal(seniorityOf('Staff ML Platform Engineer (MLOps)'), 'staff');
  assert.equal(seniorityOf('Principal Engineer'), 'principal');
  assert.equal(seniorityOf('Lead AI Engineer'), 'lead');
  assert.equal(seniorityOf('Machine Learning Engineer'), null);
});

// ---- titles to levels ---------------------------------------------------------

test('an exact title match is an exact match', () => {
  const m = levelMatch('Senior Software Engineer', PINTEREST.averages);
  assert.equal(m.kind, 'exact');
  assert.equal(m.row.level, 'ic15');
});

test('the same seniority at the company is a same-level match', () => {
  const m = levelMatch('Senior Machine Learning Engineer', PINTEREST.averages);
  assert.equal(m.kind, 'same level');
  assert.equal(m.row.level, 'ic15', 'not Senior Staff');
});

test('staff is staff, not senior staff', () => {
  assert.equal(levelMatch('Staff ML Engineer', PINTEREST.averages).row.level, 'ic16');
  assert.equal(levelMatch('Senior Staff ML Engineer', PINTEREST.averages).row.level, 'ic17');
});

test('a lead level matches a lead title', () => {
  assert.equal(levelMatch('Lead AI Engineer', ANTHROPIC.averages).row.level, 'lead-software-engineer');
});

test('a title with no seniority word matches no level', () => {
  assert.equal(levelMatch('Machine Learning Engineer', PINTEREST.averages), null);
});

// ---- estimates ----------------------------------------------------------------

test('a level match gives that level\'s US base and total', () => {
  const e = estimateFrom(PINTEREST, 'Senior Machine Learning Engineer');
  assert.equal(e.kind, 'same level');
  assert.equal(e.level, 'Senior Software Engineer');
  assert.equal(e.base, 243500);
  assert.equal(e.total, 429067);
  assert.equal(e.count, 10);
  assert.equal(e.company, 'Pinterest');
});

test('no level match falls back to the company\'s US figures across all levels', () => {
  const e = estimateFrom(PINTEREST, 'Machine Learning Engineer');
  assert.equal(e.kind, 'all levels');
  assert.equal(e.base, 201000);
  assert.deepEqual([e.baseLow, e.baseHigh], [198000, 250000]);
  assert.equal(e.count, 32);
});

test('company-wide figures for another country are never used', () => {
  assert.equal(estimateFrom(DAILYPAY, 'Machine Learning Engineer'), null,
    'DailyPay\'s family percentiles are the UK\'s, even on the US page');
});

test('a level whose samples include another country is not used', () => {
  assert.equal(estimateFrom(DAILYPAY, 'Senior ML Engineer'), null);
});

test('a level with no submissions is not a match', () => {
  const page = { ...PINTEREST, averages: PINTEREST.averages.map(a => a.level === 'ic15' ? { ...a, count: 0 } : a) };
  assert.equal(estimateFrom(page, 'Senior ML Engineer').kind, 'all levels');
});

test('no page, no estimate', () => {
  assert.equal(estimateFrom(null, 'Senior ML Engineer'), null);
});

// ---- the page itself ----------------------------------------------------------

test('page data is read out of __NEXT_DATA__', () => {
  const html = '<html><script id="__NEXT_DATA__" type="application/json">' +
    JSON.stringify({ page: '/companies/[company]/salaries/[job-family]/locations/[location]', props: { pageProps: PINTEREST } }) +
    '</script></html>';
  assert.equal(parseNextData(html).company.name, 'Pinterest');
});

test('a levels.fyi 404 page is no data, not an empty company', () => {
  const html = '<script id="__NEXT_DATA__" type="application/json">' +
    JSON.stringify({ page: '/404', props: { pageProps: {} } }) + '</script>';
  assert.equal(parseNextData(html), null);
  assert.equal(parseNextData('<html>no data</html>'), null);
});

// ---- which company, which postings ---------------------------------------------

test('the board slug is the levels.fyi slug unless overridden', () => {
  assert.equal(levelsSlug('pinterest', {}), 'pinterest');
  assert.equal(levelsSlug('andurilindustries', { andurilindustries: 'anduril' }), 'anduril');
  assert.equal(levelsSlug('clera', { clera: null }), null, 'null in the overrides means never look this one up');
});

test('only scored, unpaid, US postings with a known family need an estimate', () => {
  const scored = new Set(['a', 'b', 'c', 'd', 'e']);
  const p = (id, o) => ({ id, title: 'Senior ML Engineer', location: 'Remote - US', compensation: null, ...o });
  assert.equal(needsEstimate(p('a'), scored), true);
  assert.equal(needsEstimate(p('z'), scored), false, 'not scored');
  assert.equal(needsEstimate(p('b', { compensation: { summaryComponents: [{ compensationType: 'Salary', minValue: 150000, maxValue: 200000, currencyCode: 'USD', interval: '1 YEAR' }] } }), scored), false, 'publishes pay');
  assert.equal(needsEstimate(p('c', { location: 'London, UK' }), scored), false, 'not US');
  assert.equal(needsEstimate(p('d', { title: 'Research Scientist' }), scored), false, 'no family');
});

// ---- display only ----------------------------------------------------------------

test('nothing that selects or scores reads the estimates', () => {
  for (const f of ['lib/select.js', 'lib/comp.js', 'lib/filters.js', 'bin/poll.js', 'bin/fitness.js']) {
    const src = fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /payEstimates|levels\.js|payEst\b/, `${f} must not read pay estimates`);
  }
});

// ---- the estimates file ---------------------------------------------------------

test('the newest record per posting wins, whatever the line order', () => {
  const rows = [
    { id: 'a', at: '2026-10-02T00:00:00Z', base: 2 },
    { id: 'a', at: '2026-09-01T00:00:00Z', base: 1 },
    { id: 'b', at: '2026-09-01T00:00:00Z', none: 'no levels.fyi page' },
  ];
  const m = estimatesById(rows);
  assert.equal(m.get('a').base, 2);
  assert.equal(m.get('b').none, 'no levels.fyi page');
});

test('a posting is due when it has no record, or its record is over 30 days old', () => {
  const now = new Date('2026-10-02T00:00:00Z');
  assert.equal(due(undefined, now), true);
  assert.equal(due({ at: '2026-09-25T00:00:00Z', base: 1 }, now), false);
  assert.equal(due({ at: '2026-08-25T00:00:00Z', base: 1 }, now), true);
  assert.equal(due({ at: '2026-09-25T00:00:00Z', none: 'x' }, now), false, 'a miss is remembered too');
  assert.equal(due({ at: '2026-09-25T00:00:00Z', base: 1 }, now, { refresh: true }), true);
});

// ---- being blocked -------------------------------------------------------------
//
// levels.fyi sits behind AWS WAF. After ~380 quick requests it began answering 405 with
// an `x-amzn-waf-action: captcha` header and a "Human Verification" page. The command
// only stopped on 403/429, so it carried on and recorded 846 postings as "no
// levels.fyi page (405)" — false misses, remembered for 30 days. A challenge is not an
// answer about the company, and is never recorded as one.

const resp = (status, headers = {}) => ({ status, headers: new Headers(headers) });

test('a WAF challenge is a block, whatever its status', () => {
  assert.equal(isBlocked(resp(405, { 'x-amzn-waf-action': 'captcha' })), true);
  assert.equal(isBlocked(resp(200, { 'x-amzn-waf-action': 'challenge' })), true);
});

test('403 and 429 are blocks', () => {
  assert.equal(isBlocked(resp(403)), true);
  assert.equal(isBlocked(resp(429)), true);
});

test('an unexpected 405 is a block too, not a missing company', () => {
  assert.equal(isBlocked(resp(405)), true);
});

test('a page, and a genuine 404, are not blocks', () => {
  assert.equal(isBlocked(resp(200)), false);
  assert.equal(isBlocked(resp(404)), false);
});

test('the levels command stops on a block instead of recording it', () => {
  const src = fs.readFileSync(new URL('../bin/levels.js', import.meta.url), 'utf8');
  assert.match(src, /isBlocked\(r\)/);
  assert.doesNotMatch(src, /r\.status === 403 \|\| r\.status === 429/, 'a hand-rolled status check missed the 405 challenge');
});

// ---- a mapped slug must land on the right company ---------------------------------
//
// config/levels-companies.json maps board slugs to levels.fyi slugs by hand or by
// guess. A wrong slug that happens to exist would attach another company's pay, so a
// mapped page is used only if its company name plausibly matches the board slug.

test('a mapped page whose name contains the board slug, or the reverse, matches', () => {
  assert.equal(nameMatches('andurilindustries', 'Anduril'), true);
  assert.equal(nameMatches('aloyoga', 'Alo Yoga'), true);
  assert.equal(nameMatches('mistral.ai', 'Mistral AI'), true);
  assert.equal(nameMatches('bumbleinc', 'Bumble'), true);
});

test('a different company does not match', () => {
  assert.equal(nameMatches('c3iot', 'C3 AI'), false, 'near is not the same');
  assert.equal(nameMatches('junior', 'Junior Achievement Worldwide'), false);
  assert.equal(nameMatches('sable', 'Sabre'), false);
  assert.equal(nameMatches('agency', 'Agent'), false);
});

test('a very short name is never a substring match', () => {
  assert.equal(nameMatches('bio', 'Biogen'), false);
  assert.equal(nameMatches('ai', 'Airbnb'), false);
});

test('a stopped run does not report a full bar', () => {
  // finish() forces 100% and prints "N in 0s"; after a block that is a false claim.
  const src = fs.readFileSync(new URL('../bin/levels.js', import.meta.url), 'utf8');
  assert.match(src, /results\.stopped\s*\?[^:]*:\s*bar\.finish\(\)/);
});

test('"scored" means has a fitness score — coverage was dropped', () => {
  const src = fs.readFileSync(new URL('../bin/levels.js', import.meta.url), 'utf8');
  assert.match(src, /rowsOf\(P\.jevFitness\)/);
  assert.doesNotMatch(src, /P\.coverage/);
});

test('a posting whose description states its pay needs no estimate', () => {
  const p = { id: 'a', title: 'Senior ML Engineer', location: 'Remote - US', compensation: null,
    description: 'COMPENSATION & BENEFITS\nSalary range: $150,000 to $250,000 USD annually' };
  assert.equal(needsEstimate(p, new Set(['a'])), false);
  assert.equal(needsEstimate({ ...p, description: 'We raised $40M.' }, new Set(['a'])), true);
});
