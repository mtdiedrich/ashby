// A scoring run should leave every staged posting scored — coverage is the only front.
// These tests pin the rules that make that true regardless of the order you run
// the scorers in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidates } from '../lib/select.js';
import { corpusRecord } from './helpers.js';

const asMap = (...recs) => new Map(recs.map(r => [r.id, r]));
const ids = rows => rows.map(r => r.id).sort();

test('a finished posting drops off the worklist', () => {
  const c = asMap(corpusRecord({ id: 'a' }), corpusRecord({ id: 'b' }));
  assert.deepEqual(ids(candidates(c, { done: new Set(['a', 'b']) })), []);
});

test('dismissal still wins over everything', () => {
  const c = asMap(corpusRecord({ id: 'a' }));
  assert.deepEqual(candidates(c, { dismissed: new Set(['a']) }), []);
});

test('selection is idempotent — running it twice proposes the same set', () => {
  const c = asMap(corpusRecord({ id: 'a' }), corpusRecord({ id: 'b' }));
  assert.deepEqual(ids(candidates(c, {})), ids(candidates(c, {})));
});

test('staging does not remove a posting from the worklist on its own', () => {
  // Being staged is not being scored. fresh.jsonl is a worklist that the scorers
  // read repeatedly, not a queue that the first one to run drains.
  const c = asMap(corpusRecord({ id: 'a' }));
  assert.deepEqual(ids(candidates(c, {})), ['a']);
});
