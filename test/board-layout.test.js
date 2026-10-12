import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

// Layout of the board's columns, on the real web/ui.html at a laptop-ish width.
//
// The location cell was `white-space: nowrap`, so the longest location on the board —
// multi-city postings run past 100 characters — set the column's width and pushed
// every column to its right off the page.

const HTML = fs.readFileSync(new URL('../web/ui.html', import.meta.url), 'utf8');
const LONG = 'San Francisco, CA; New York, NY; Seattle, WA; Austin, TX; Washington, D.C.; Remote - US';
const job = (id, location) => ({ id, title: 'Role ' + id, slug: 'co', location, state: 'judged',
  pay: '$150K – $250K', fitness: 0.5, fresh: 0.5, value: 0.5, daysLive: 1 });
const BOARD = { jobs: [job('long', LONG), job('short', 'Remote')], total: 2,
  counts: { fitness: 2, value: 2, queued: 0, applied: 0 } };

let browser, page;
before(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.route('http://board.test/**', route => {
    const u = new URL(route.request().url());
    if (u.pathname === '/') return route.fulfill({ contentType: 'text/html', body: HTML });
    if (u.pathname === '/api/board') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(BOARD) });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('http://board.test/');
  await page.waitForSelector('tr.r');
});
after(async () => { await browser?.close(); });

test('a long location wraps instead of widening its column', async () => {
  const box = await page.locator('tr.r[data-id="long"] td.loc').boundingBox();
  assert.ok(box.width <= 260, `location column is ${Math.round(box.width)}px wide`);
  // Counted as rendered text lines, which does not depend on what else is in the row.
  const lines = await page.evaluate(() => {
    const r = document.createRange();
    r.selectNodeContents(document.querySelector('tr.r[data-id="long"] td.loc'));
    return r.getClientRects().length;
  });
  assert.ok(lines > 1, `the long location runs onto more than one line (${lines})`);
});

test('nothing is pushed off the right edge of the page', async () => {
  const pay = await page.locator('tr.r[data-id="long"] td.pay').boundingBox();
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  assert.ok(pay.x + pay.width <= width, `pay column ends at ${Math.round(pay.x + pay.width)}px of ${width}`);
  const scrolls = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  assert.equal(scrolls, false, 'no horizontal scroll');
});

test('the whole location is still there', async () => {
  assert.equal((await page.locator('tr.r[data-id="long"] td.loc').innerText()).replace(/\s+/g, ' ').trim(), LONG);
});
