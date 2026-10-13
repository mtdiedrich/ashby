import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appliedIds, openedIds, dropFromQueue, answerEffect, SUBMITTED_PROMPT } from '../lib/applog.js';

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

// ---- the prompt after each posting ---------------------------------------
//
// [s] used to drop the posting it was answering for, like [n]. Hit in place of [k]
// it silently threw away three postings that had not been applied to, and the log
// could not say which ones: [n] and [s] wrote identical records.

test('[s] stops the run and keeps the posting queued', () => {
  assert.deepEqual(answerEffect('s'), { submitted: false, keep: true, stop: true });
});

test('[k] keeps the posting queued and carries on', () => {
  assert.deepEqual(answerEffect('k'), { submitted: false, keep: true, stop: false });
});

test('[n] drops the posting and carries on', () => {
  assert.deepEqual(answerEffect('n'), { submitted: false, keep: false, stop: false });
});

test('[y] records a submission and drops the posting', () => {
  assert.deepEqual(answerEffect('y'), { submitted: true, keep: false, stop: false });
});

test('answers are read case- and whitespace-insensitively', () => {
  assert.deepEqual(answerEffect(' S\n'), answerEffect('s'));
});

test('the prompt lists each answer on its own line, in order', () => {
  const lines = SUBMITTED_PROMPT.split('\n').map(l => l.trim()).filter(l => /^\[/.test(l));
  assert.deepEqual(lines, [
    '[y] yes, submitted',
    '[n] no, drop from queue',
    '[k] not yet, keep in queue',
    '[s] stop here, keep in queue',
  ]);
});

// Pressing "u" at the prompt was read as [n]: the posting was logged as not submitted
// and dropped from the queue, and two postings the user had picked were lost to a
// typo. An answer that is not one of the four is not an answer.
test('an unrecognised key is no answer at all — not [n]', () => {
  for (const a of ['u', 'x', 'yes', 'no', '', '   ', '\n', 'nn', '1'])
    assert.equal(answerEffect(a), null, JSON.stringify(a));
});

test('askSubmitted asks again, saying why, until it gets a valid key', async () => {
  const { askSubmitted } = await import('../lib/applog.js');
  const replies = ['u', '', 'K'];
  const asked = [], said = [];
  const effect = await askSubmitted(q => { asked.push(q); return Promise.resolve(replies.shift()); }, m => said.push(m));
  assert.deepEqual(effect, answerEffect('k'));
  assert.equal(asked.length, 3, 'asked until valid');
  assert.match(said[0], /"u".*not valid/i);
  assert.match(said[1], /not valid/i);
});

test('askSubmitted falls back to "not submitted" only when no answer is possible', async () => {
  // stdin closed or piped: there is no one to ask, and the record must still be written.
  const { askSubmitted } = await import('../lib/applog.js');
  const effect = await askSubmitted(() => Promise.reject(new Error('closed')), () => {});
  assert.deepEqual(effect, answerEffect('n'));
});
