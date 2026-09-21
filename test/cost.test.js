import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costOf, PRICES, summarise } from '../lib/cost.js';

// Nothing in this project recorded response.usage, so the bill could only ever be
// estimated from the code. Adaptive thinking on Sonnet 5 is billed as output and
// never appears in the stored results, which made the largest unknown invisible.

test('prices the four token kinds at their own rates', () => {
  const u = { input_tokens: 1e6, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  assert.equal(costOf(u, 'claude-sonnet-5'), 2);
  assert.equal(costOf({ ...u, input_tokens: 0, output_tokens: 1e6 }, 'claude-sonnet-5'), 10);
});

test('cache reads are a tenth of input, writes a quarter more', () => {
  const read = costOf({ cache_read_input_tokens: 1e6 }, 'claude-sonnet-5');
  const write = costOf({ cache_creation_input_tokens: 1e6 }, 'claude-sonnet-5');
  assert.equal(read, 0.2, 'reads bill at 0.1x input');
  assert.equal(write, 2.5, 'writes bill at 1.25x input');
});

test('haiku is priced separately from sonnet', () => {
  assert.equal(costOf({ input_tokens: 1e6 }, 'claude-haiku-4-5'), 1);
  assert.equal(costOf({ output_tokens: 1e6 }, 'claude-haiku-4-5'), 5);
});

test('a dated model id resolves to its family', () => {
  assert.equal(costOf({ input_tokens: 1e6 }, 'claude-haiku-4-5-20251001'), 1);
});

test('an unknown model costs null rather than silently zero', () => {
  assert.equal(costOf({ input_tokens: 1e6 }, 'some-future-model'), null);
});

test('missing usage fields count as zero, not NaN', () => {
  assert.equal(costOf({}, 'claude-sonnet-5'), 0);
  assert.equal(costOf(null, 'claude-sonnet-5'), 0);
});

test('batch halves everything, cache reads included', () => {
  const u = { input_tokens: 1e6, output_tokens: 1e6, cache_read_input_tokens: 1e6 };
  const std = costOf(u, 'claude-sonnet-5');
  const bat = costOf(u, 'claude-sonnet-5', { batch: true });
  assert.equal(bat, std / 2);
});

test('the price table records when it was checked', () => {
  assert.match(PRICES.checkedOn, /^\d{4}-\d{2}-\d{2}$/, 'rates go stale; the report must say when');
});

// ---- rolling a log up ----------------------------------------------------

const rows = [
  { at: '2026-09-20T10:00:00Z', label: 'fitness', model: 'claude-sonnet-5',
    usage: { input_tokens: 15312, output_tokens: 926, cache_read_input_tokens: 8585 }, items: 8 },
  { at: '2026-09-20T10:00:01Z', label: 'coverage:extract', model: 'claude-haiku-4-5',
    usage: { input_tokens: 1778, output_tokens: 263 }, items: 1 },
];

test('rolls a log up by label, with per-item cost', () => {
  const s = summarise(rows);
  const fit = s.byLabel.find(r => r.label === 'fitness');
  assert.equal(fit.calls, 1);
  assert.equal(fit.items, 8);
  assert.ok(fit.cost > 0);
  assert.ok(Math.abs(fit.perItem - fit.cost / 8) < 1e-12);
});

test('reports the share of the bill each label carries', () => {
  const s = summarise(rows);
  const total = s.byLabel.reduce((a, r) => a + r.cost, 0);
  assert.ok(Math.abs(total - s.total) < 1e-12);
  for (const r of s.byLabel) assert.ok(r.share > 0 && r.share <= 1);
});

test('surfaces the cache hit rate, which is the caching lever\'s only evidence', () => {
  const s = summarise(rows);
  const fit = s.byLabel.find(r => r.label === 'fitness');
  // 8585 read of (15312 + 8585) billed input
  assert.ok(Math.abs(fit.cacheHitRate - 8585 / 23897) < 1e-9);
});

test('an empty log summarises to zero rather than throwing', () => {
  const s = summarise([]);
  assert.equal(s.total, 0);
  assert.deepEqual(s.byLabel, []);
});

// Two scoring runs at once write to the same log, and without a run id their spend
// blends — which is exactly what happened the first time this log was used.
test('summarise can be scoped to one run', async () => {
  const { summarise } = await import('../lib/cost.js');
  const mixed = [
    { run: 'a', label: 'fitness', model: 'claude-sonnet-5', usage: { input_tokens: 1e6 }, items: 1 },
    { run: 'b', label: 'fitness', model: 'claude-sonnet-5', usage: { input_tokens: 1e6 }, items: 1 },
  ];
  assert.equal(summarise(mixed).total, 4);
  assert.equal(summarise(mixed.filter(r => r.run === 'a')).total, 2);
});
