import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appliedIds, openedIds, dropFromQueue } from '../lib/applog.js';

// log.jsonl records one line per posting apply.js opens. Before this, the board
// called every one of those "applied" — opening a tab and closing it without
// submitting counted the same as sending the application.

test('submitted:true is applied', () => {
  assert.deepEqual([...appliedIds([{ job: 'a', submitted: true }])], ['a']);
});

test('submitted:false is not applied', () => {
  assert.deepEqual([...appliedIds([{ job: 'a', submitted: false }])], []);
});

test('you cannot un-submit: any true wins over a later false', () => {
  const rows = [
    { job: 'a', submitted: true, at: '2026-09-15T10:00:00Z' },
    { job: 'a', submitted: false, at: '2026-09-15T11:00:00Z' },
  ];
  assert.deepEqual([...appliedIds(rows)], ['a']);
});

// The 13 existing records predate the submitted field. Treating them as not-applied
// would silently un-apply real applications; there is no way to recover that
// information, so the old meaning is preserved for old records only.
test('a legacy record with no submitted field keeps its old meaning', () => {
  assert.deepEqual([...appliedIds([{ job: 'a', outcome: 'filled' }])], ['a']);
});

test('a legacy record does not resurrect an explicit no', () => {
  const rows = [{ job: 'a', outcome: 'filled' }, { job: 'a', submitted: false }];
  assert.deepEqual([...appliedIds(rows)], ['a'], 'the legacy record still counts');
  const rows2 = [{ job: 'b', submitted: false }, { job: 'b', submitted: false }];
  assert.deepEqual([...appliedIds(rows2)], []);
});

test('an errored run is not an application', () => {
  assert.deepEqual([...appliedIds([{ job: 'a', outcome: 'error', error: 'timeout' }])], []);
});

test('opened but not submitted is its own state', () => {
  const rows = [{ job: 'a', submitted: true }, { job: 'b', submitted: false }];
  assert.deepEqual([...openedIds(rows)], ['b'], 'b was seen but not sent');
});

test('empty and nullish are empty', () => {
  assert.equal(appliedIds([]).size, 0);
  assert.equal(appliedIds(null).size, 0);
  assert.equal(openedIds(null).size, 0);
});

// The queue was rewritten once, after the whole run. Ctrl-C part way through lost
// every removal, so a re-run reopened everything already dealt with.
test('dropFromQueue removes exactly one posting', () => {
  const q = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(dropFromQueue(q, 'b').map(r => r.id), ['a', 'c']);
});

test('dropping something absent is a no-op, not an error', () => {
  const q = [{ id: 'a' }];
  assert.deepEqual(dropFromQueue(q, 'zzz').map(r => r.id), ['a']);
  assert.deepEqual(dropFromQueue([], 'a'), []);
});

test('the rest of the queue is preserved intact', () => {
  const q = [{ id: 'a', title: 'One', applyUrl: 'u1' }, { id: 'b', title: 'Two' }];
  assert.deepEqual(dropFromQueue(q, 'b'), [{ id: 'a', title: 'One', applyUrl: 'u1' }]);
});
