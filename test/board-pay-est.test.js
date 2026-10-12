import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

// The pay column on the real web/ui.html, for postings that publish no pay but have a
// levels.fyi estimate. Display only: marked as an estimate, and never sorted as pay.
// /api/board is answered by the test; nothing touches the server or data/.

const HTML = fs.readFileSync(new URL('../web/ui.html', import.meta.url), 'utf8');
const job = (id, o) => ({
  id, title: 'Role ' + id, slug: 'co' + id, location: 'Remote', state: 'judged', pay: null,
  fitness: 0.5, fresh: 0.5, value: 0.5,
  daysLive: 1, ...o,
});
const JOBS = [
  job('posted', { pay: '$150K - $180K' }),
  job('est', { payEst: { base: 268750, low: null, high: null, total: 380000, kind: 'same level',
    level: 'Staff Software Engineer', count: 4, company: 'Crusoe', url: 'https://www.levels.fyi/x' } }),
  job('wide', { payEst: { base: 210000, low: 164000, high: 250000, total: 300000, kind: 'all levels',
    level: null, count: 21, company: 'Crusoe', url: 'https://www.levels.fyi/y' } }),
  job('nothing'),
  job('desc', { pay: '$150K – $250K', payFrom: 'description' }),
];
const BOARD = { jobs: JOBS, total: JOBS.length,
  counts: { fitness: 4, value: 4, queued: 0, applied: 0 } };

let browser, page;
before(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.route('http://board.test/**', route => {
    const u = new URL(route.request().url());
    if (u.pathname === '/') return route.fulfill({ contentType: 'text/html', body: HTML });
    if (u.pathname === '/api/board') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(BOARD) });
    if (u.pathname === '/api/detail') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      description: '', requirements: [], gaps: [], constraints: [], applyUrl: null, jobUrl: null, department: null,
      team: null, workplaceType: null, employmentType: null,
      payText: u.searchParams.get('id') === 'desc' ? 'Salary range: $150,000 to $250,000 USD annually' : null }) });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('http://board.test/');
  await page.waitForSelector('tr.r');
});
after(async () => { await browser?.close(); });

const payCell = id => page.locator(`tr.r[data-id="${id}"] td.pay`);

test('an estimate is shown, and marked as one', async () => {
  const t = await payCell('est').innerText();
  assert.match(t, /est\./);
  assert.match(t, /\$269K/);
  assert.match(t, /Staff Software Engineer/);
  assert.match(t, /n=4/);
});

test('a company-wide estimate says so and shows its range', async () => {
  const t = await payCell('wide').innerText();
  assert.match(t, /\$164K.\$250K/);
  assert.match(t, /all levels/);
});

test('its tooltip names the source and says it is not this posting\'s pay', async () => {
  const title = await payCell('est').getAttribute('title');
  assert.match(title, /levels\.fyi/);
  assert.match(title, /Crusoe/);
  assert.match(title, /not this posting/i);
});

test('published pay is drawn as before, and nothing reads as an estimate', async () => {
  assert.equal((await payCell('posted').innerText()).trim(), '$150K - $180K');
  assert.equal((await payCell('nothing').innerText()).trim(), '—');
});

test('sorting by pay ranks only stated pay; estimates sort with the blanks', async () => {
  await page.click('thead th[data-s="payNum"]');
  const order = await page.$$eval('tr.r', rs => rs.map(r => r.dataset.id));
  // Stated pay — the posting's field or its description — ranks by its top figure.
  assert.deepEqual(order.slice(0, 2), ['desc', 'posted'], 'description pay is stated pay and sorts as such');
  assert.ok(order.indexOf('est') > order.indexOf('posted'), 'a $269K estimate must not outrank a posted $180K');
  // Leave the default order for the tests that follow.
  await page.click('thead th[data-s="value"]');
});

// ---- pay stated in the description ------------------------------------------------
//
// Not an estimate: the posting says it, just not in its pay field. Drawn as pay, with
// the source named, and the sentence it came from in the expanded row.

test('pay from the description is drawn as pay, not as an estimate', async () => {
  const cell = payCell('desc');
  assert.equal((await cell.innerText()).trim(), '$150K – $250K');
  assert.doesNotMatch(await cell.innerText(), /est\./);
  assert.match(await cell.getAttribute('title'), /job description/i);
  assert.match(await cell.getAttribute('class'), /\bhas\b/);
});

test('the expanded row quotes the sentence the pay came from', async () => {
  await page.click('tr.r[data-id="desc"] td.title');
  const sel = 'tr.detail[data-for="desc"]';
  await page.waitForSelector(sel + ' .paytext');
  assert.match(await page.locator(sel).innerText(), /Salary range: \$150,000 to \$250,000 USD annually/);
});

test('a posting whose pay field is set has no description note', async () => {
  assert.equal(await payCell('posted').getAttribute('title'), null);
});

// ---- the expanded row, now that coverage is gone ----------------------------------

test('the expanded row has no coverage section, and states the fitness', async () => {
  await page.click('tr.r[data-id="posted"] td.title');
  const sel = 'tr.detail[data-for="posted"]';
  await page.waitForSelector(sel + ' .fitline');
  const t = await page.locator(sel).innerText();
  assert.doesNotMatch(t, /coverage|requirement|npm run coverage/i);
  assert.match(t, /0\.50/);
});
