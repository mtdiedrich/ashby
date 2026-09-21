import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collect, idFor, indexOf } from '../lib/batch-api.js';

// The Batch API returns results in ANY order. Keying by position instead of
// custom_id attaches a score to the wrong posting — the same class of bug as
// fitness's echoed index, and just as silent.

test('custom ids round-trip through an index', () => {
  for (const i of [0, 1, 7, 42, 1399]) assert.equal(indexOf(idFor(i)), i);
});

test('an id that is not ours yields null, not 0', () => {
  assert.equal(indexOf('something-else'), null);
  assert.equal(indexOf(''), null);
  assert.equal(indexOf(null), null);
  assert.equal(indexOf('r-notanumber'), null);
});

const ok = (i, text) => ({
  custom_id: idFor(i),
  result: { type: 'succeeded', message: {
    content: [{ type: 'text', text }],
    usage: { input_tokens: 10, output_tokens: 5 },
    stop_reason: 'end_turn',
  } },
});

test('results are keyed by custom_id, not by arrival order', () => {
  const out = collect([ok(2, 'third'), ok(0, 'first'), ok(1, 'second')]);
  assert.equal(out.get(0).text, 'first');
  assert.equal(out.get(1).text, 'second');
  assert.equal(out.get(2).text, 'third');
});

test('an errored request is recorded, not silently dropped', () => {
  const out = collect([
    ok(0, 'fine'),
    { custom_id: idFor(1), result: { type: 'errored', error: { type: 'invalid_request', message: 'bad' } } },
  ]);
  assert.equal(out.get(0).ok, true);
  assert.equal(out.get(1).ok, false);
  assert.match(out.get(1).error, /invalid_request|bad/);
});

test('expired and canceled are failures with their reason', () => {
  const out = collect([
    { custom_id: idFor(0), result: { type: 'expired' } },
    { custom_id: idFor(1), result: { type: 'canceled' } },
  ]);
  assert.equal(out.get(0).ok, false);
  assert.match(out.get(0).error, /expired/i);
  assert.match(out.get(1).error, /cancel/i);
});

test('a refusal is a failure even though the request succeeded', () => {
  const out = collect([{
    custom_id: idFor(0),
    result: { type: 'succeeded', message: {
      content: [], usage: {}, stop_reason: 'refusal', stop_details: { category: 'cyber' },
    } },
  }]);
  assert.equal(out.get(0).ok, false);
  assert.match(out.get(0).error, /refus/i);
});

test('usage comes back with each result, for the cost log', () => {
  const out = collect([ok(0, 'x')]);
  assert.deepEqual(out.get(0).usage, { input_tokens: 10, output_tokens: 5 });
});

test('a result for an id we never sent is ignored rather than mis-filed', () => {
  const out = collect([{ custom_id: 'r-999999', result: { type: 'succeeded', message: { content: [{ type: 'text', text: 'x' }], usage: {} } } }], 3);
  assert.equal(out.size, 0, 'out of range for a 3-item batch');
});

test('a partly failed batch keeps every success', () => {
  const out = collect([
    ok(0, 'a'),
    { custom_id: idFor(1), result: { type: 'errored', error: { message: 'boom' } } },
    ok(2, 'c'),
  ]);
  assert.equal([...out.values()].filter(r => r.ok).length, 2);
  assert.equal(out.size, 3);
});

test('text is joined across blocks, as the sync path does', () => {
  const out = collect([{
    custom_id: idFor(0),
    result: { type: 'succeeded', message: {
      content: [{ type: 'thinking', thinking: 'ignored' }, { type: 'text', text: 'a' }, { type: 'text', text: 'b' }],
      usage: {},
    } },
  }]);
  assert.equal(out.get(0).text, 'ab');
});

test('an empty result set is an empty map, not a throw', () => {
  assert.equal(collect([]).size, 0);
  assert.equal(collect(null).size, 0);
});
