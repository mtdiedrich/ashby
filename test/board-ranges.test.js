import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

// The board's score-range filter, exercised on the real web/ui.html in a browser.
// Nothing here touches the server or data/: /api/board is answered by the test.
//
// Each numeric column gets a min and a max. A row is shown only when every bound
// that is set holds. A row with NO value for a bounded column is hidden — an
// unscored posting is not "within" a range, it is outside what can be judged.

const HTML = fs.readFileSync(new URL('../web/ui.html', import.meta.url), 'utf8');
const job = (id, o) => ({
  id, title: 'Role ' + id, slug: 'co' + id, location: 'Remote', state: 'judged', pay: null,
  fresh: null, value: null, daysLive: 1, met: 1, reqTotal: 2, ...o,
});
const JOBS = [
  job('a', { fitness: 0.4, alignment: 0.8, fresh: 1.0, value: 0.95 }),
  job('b', { fitness: 0.6, alignment: 0.3, fresh: 0.5, value: 0.50 }),
  job('c', { fitness: 0.9, fresh: 0.1, value: 0.20 }),      // one-question answer: no alignment yet
  job('d', {}),                                             // nothing scored yet
];
const BOARD = { jobs: JOBS, total: JOBS.length,
  counts: { fitness: 3, alignment: 2, value: 3, queued: 0, applied: 0 } };

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function board(ctx) {
  ctx ??= await browser.newContext();
  const page = await ctx.newPage();
  await page.route('http://board.test/**', route => {
    const u = new URL(route.request().url());
    if (u.pathname === '/') return route.fulfill({ contentType: 'text/html', body: HTML });
    if (u.pathname === '/api/board') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(BOARD) });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('http://board.test/');
  await page.waitForSelector('tr.r');
  return page;
}
const ids = page => page.$$eval('tr.r', rs => rs.map(r => r.dataset.id).sort());
async function setBound(page, key, which, value) {
  await page.fill(`input.rng[data-k="${key}"][data-b="${which}"]`, String(value), { timeout: 2000 });
  await page.waitForTimeout(250);                          // past the debounce
}

test('every numeric column has a min and a max', async () => {
  const page = await board();
  for (const k of ['fitness', 'alignment', 'fresh', 'value']) {
    for (const b of ['min', 'max']) {
      assert.equal(await page.locator(`input.rng[data-k="${k}"][data-b="${b}"]`).count(), 1, `${k} ${b}`);
    }
  }
  await page.close();
});

test('a minimum hides rows below it, and rows with no value', async () => {
  const page = await board();
  assert.deepEqual(await ids(page), ['a', 'b', 'c', 'd']);
  await setBound(page, 'fresh', 'min', 0.5);
  assert.deepEqual(await ids(page), ['a', 'b']);
  await page.close();
});

test('a maximum hides rows above it', async () => {
  const page = await board();
  await setBound(page, 'fitness', 'max', 0.75);
  assert.deepEqual(await ids(page), ['a', 'b']);
  await page.close();
});

test('bounds are inclusive', async () => {
  const page = await board();
  await setBound(page, 'fresh', 'min', 0.5);
  await setBound(page, 'fresh', 'max', 0.5);
  assert.deepEqual(await ids(page), ['b']);
  await page.close();
});

test('bounds on different columns all have to hold', async () => {
  const page = await board();
  await setBound(page, 'fresh', 'min', 0.5);
  await setBound(page, 'fitness', 'min', 0.5);
  assert.deepEqual(await ids(page), ['b']);
  await page.close();
});

// Similarity was dropped 2026-10-02: no column, no bound, and the bulk 'stage top 25'
// button that ranked by it is gone too.
test('there is no similarity column, bound, or similarity-ranked staging', async () => {
  const page = await board();
  assert.equal(await page.locator('thead th[data-s="nSimilarity"], thead th[data-s="similarity"]').count(), 0);
  assert.equal(await page.locator('input.rng[data-k="nSimilarity"]').count(), 0);
  assert.equal(await page.locator('#stagetop').count(), 0);
  assert.doesNotMatch(await page.locator('thead').innerText(), /similarity/i);
  assert.doesNotMatch(await page.locator('#stamp').innerText(), /similarity/i);
  await page.close();
});

test('a range remembered for the old similarity column is ignored', async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.route('http://board.test/**', route => {
    const u = new URL(route.request().url());
    if (u.pathname === '/') return route.fulfill({ contentType: 'text/html', body: HTML });
    if (u.pathname === '/api/board') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(BOARD) });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.addInitScript(() => localStorage.setItem('ashby.ranges', JSON.stringify({ nSimilarity: { min: 0.99 } })));
  await page.goto('http://board.test/');
  await page.waitForSelector('tr.r');
  assert.deepEqual(await ids(page), ['a', 'b', 'c', 'd']);
  await ctx.close();
});

test('clearing a bound brings the rows back', async () => {
  const page = await board();
  await setBound(page, 'fresh', 'min', 0.5);
  await setBound(page, 'fresh', 'min', '');
  assert.deepEqual(await ids(page), ['a', 'b', 'c', 'd']);
  await page.close();
});

test('"clear ranges" resets every bound', async () => {
  const page = await board();
  await setBound(page, 'fresh', 'min', 0.5);
  await setBound(page, 'value', 'max', 0.6);
  await page.click("#clearranges", { timeout: 2000 });
  await page.waitForTimeout(250);
  assert.deepEqual(await ids(page), ['a', 'b', 'c', 'd']);
  assert.equal(await page.inputValue('input.rng[data-k="fresh"][data-b="min"]'), '');
  await page.close();
});

test('ranges survive a reload', async () => {
  const ctx = await browser.newContext();
  const page = await board(ctx);
  await setBound(page, 'fresh', 'min', 0.5);
  await page.reload();
  await page.waitForSelector('tr.r');
  assert.deepEqual(await ids(page), ['a', 'b']);
  assert.equal(await page.inputValue('input.rng[data-k="fresh"][data-b="min"]'), '0.5');
  await ctx.close();
});

test('the search box and the ranges combine', async () => {
  const page = await board();
  await setBound(page, 'fresh', 'min', 0.5);
  await page.fill('#q', 'role b');
  await page.waitForTimeout(250);
  assert.deepEqual(await ids(page), ['b']);
  await page.close();
});

// The score and coverage columns were dropped 2026-10-02. FITNESS is the score now.
test('no score or coverage column; fitness has a range bound', async () => {
  // Fitness is the score now (2026-10-02), so it is bounded like any score column.
  const page = await board();
  for (const k of ['score', 'coverage']) {
    assert.equal(await page.locator(`thead th[data-s="${k}"]`).count(), 0, k);
    assert.equal(await page.locator(`input.rng[data-k="${k}"]`).count(), 0, k);
  }
  assert.equal(await page.locator('input.rng[data-k="fitness"]').count(), 2);
  assert.doesNotMatch(await page.locator('#stamp').innerText(), /coverage/i);
  await page.close();
});

// ---- the FITNESS column -------------------------------------------------------------

// Two answers since 2026-10-12: qualified (resume → role) and aligned (role → resume).
test('qualified and aligned are the first columns, before fresh and value', async () => {
  const page = await board();
  const heads = await page.$$eval('thead tr:first-child th', ths => ths.map(t => t.dataset.s));
  assert.deepEqual(heads.slice(0, 4), ['fitness', 'alignment', 'fresh', 'value']);
  assert.match(await page.locator('thead th[data-s="fitness"]').innerText(), /qualified/i);
  assert.match(await page.locator('thead th[data-s="alignment"]').innerText(), /aligned/i);
  await page.close();
});

test('a row shows its alignment, and a dash where it has not been asked', async () => {
  const page = await board();
  const second = id => page.locator(`tr.r[data-id="${id}"] td`).nth(1);
  assert.equal((await second('a').innerText()).trim(), '0.80');
  assert.equal((await second('c').innerText()).trim(), '—', 'a one-question answer has no alignment');
  await page.close();
});

test('an alignment minimum hides rows below it, and rows not yet asked', async () => {
  const page = await board();
  await setBound(page, 'alignment', 'min', 0.5);
  assert.deepEqual(await ids(page), ['a']);
  await page.close();
});

test('a row shows its fitness, and a dash where there is none', async () => {
  const page = await board();
  const first = id => page.locator(`tr.r[data-id="${id}"] td`).first();
  assert.equal((await first('a').innerText()).trim(), '0.40');
  assert.equal((await first('d').innerText()).trim(), '—');
  await page.close();
});

test('sorting by fitness orders by it, and value is untouched', async () => {
  const page = await board();
  await page.click('thead th[data-s="fitness"]');
  const order = await page.$$eval('tr.r', rs => rs.map(r => r.dataset.id));
  assert.deepEqual(order.slice(0, 3), ['c', 'b', 'a'], 'highest fitness first');
  await page.close();
});
