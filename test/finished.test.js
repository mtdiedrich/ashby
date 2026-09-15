import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finished, vectorIds } from '../lib/select.js';

// poll.js drops "finished" postings from fresh.jsonl, and every scorer reads only
// fresh.jsonl. So a posting counted as finished while still missing a score can
// never acquire it: it is gone from the only worklist anything looks at.
//
// This is how 15 postings ended up with fitness and coverage but no vector, and
// therefore no `score` and no `value` — permanently unrankable.

const ids = (...xs) => new Set(xs);

test('finished means all three, not two', () => {
  const d = finished({ fitness: ids('a', 'b'), coverage: ids('a', 'b'), vectors: ids('a') });
  assert.deepEqual([...d], ['a'], 'b has no vector, so b is not finished');
});

test('a posting with every score is finished', () => {
  const d = finished({ fitness: ids('a'), coverage: ids('a'), vectors: ids('a') });
  assert.deepEqual([...d], ['a']);
});

test('missing any one front keeps it on the worklist', () => {
  const all = ids('x');
  const none = ids();
  assert.equal(finished({ fitness: none, coverage: all, vectors: all }).size, 0);
  assert.equal(finished({ fitness: all, coverage: none, vectors: all }).size, 0);
  assert.equal(finished({ fitness: all, coverage: all, vectors: none }).size, 0);
});

test('vector keys carry a job: prefix that has to come off', () => {
  const v = vectorIds([
    { key: 'job:abc' }, { key: 'job:def' }, { key: 'resume' },
  ]);
  assert.deepEqual([...v].sort(), ['abc', 'def'], 'the resume is not a posting');
});

test('a malformed vector row does not poison the set', () => {
  const v = vectorIds([{ key: 'job:a' }, {}, null, { key: null }]);
  assert.deepEqual([...v], ['a']);
});

test('empty inputs are empty, not an error', () => {
  assert.equal(finished({ fitness: ids(), coverage: ids(), vectors: ids() }).size, 0);
  assert.equal(vectorIds([]).size, 0);
  assert.equal(vectorIds(null).size, 0);
});
