import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finished } from '../lib/select.js';

// poll.js drops "finished" postings from fresh.jsonl, and the scorer reads only
// fresh.jsonl. So a posting counted as finished while still missing its score can
// never acquire it: it is gone from the only worklist anything looks at.
//
// Similarity, then the Sonnet fitness judgement, then coverage were dropped on
// 2026-10-02. Jev's fitness is the only front: a posting is finished once it has one.

const ids = (...xs) => new Set(xs);

test('a posting with a fitness score is finished', () => {
  assert.deepEqual([...finished({ fitness: ids('a') })], ['a']);
});

test('coverage no longer finishes anything', () => {
  assert.deepEqual([...finished({ fitness: ids('a'), coverage: ids('a', 'b') })], ['a']);
});

test('empty inputs are empty, not an error', () => {
  assert.equal(finished({ fitness: ids() }).size, 0);
  assert.equal(finished({}).size, 0);
});
