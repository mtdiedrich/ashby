import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tempHome, cleanup, jsonl } from './helpers.js';
import { P } from '../lib/paths.js';
import { closedIds, boardKey, compactCorpus, corpus } from '../lib/corpus.js';
import { dropRows } from '../lib/jsonl.js';

// The corpus only ever grew. A posting taken down stayed in it — and on the board —
// forever, and 652 of 3,152 sampled for an off-filter scoring run (21%) turned out to
// be closed when fetched. Closed is now derived the only safe way: the board answered
// and the posting was not on it. A board that failed to answer proves nothing.

const rec = (id, company, ats) => ({ id, company, ...(ats ? { ats } : {}), title: 'ML Engineer' });

test('a posting missing from a board that answered is closed', () => {
  const known = new Map([['a', rec('a', 'acme')], ['b', rec('b', 'acme')]]);
  const boards = new Map([['ashby:acme', new Set(['a'])]]);
  assert.deepEqual([...closedIds(known, boards)], ['b']);
});

test('a board that did not answer closes nothing', () => {
  const known = new Map([['a', rec('a', 'acme')], ['z', rec('z', 'zeta')]]);
  const boards = new Map([['ashby:acme', new Set(['a'])]]);   // zeta failed or was not crawled
  assert.deepEqual([...closedIds(known, boards)], []);
});

test('an empty board is not trusted to close what it used to list', () => {
  // A 200 with no jobs is indistinguishable from a board having a bad moment.
  const known = new Map([['a', rec('a', 'acme')]]);
  const boards = new Map([['ashby:acme', new Set()]]);
  assert.deepEqual([...closedIds(known, boards)], []);
});

test('boards are keyed per ATS — the same slug on two systems is two boards', () => {
  const known = new Map([['greenhouse:1', rec('greenhouse:1', 'acme', 'greenhouse')], ['a', rec('a', 'acme')]]);
  const boards = new Map([['greenhouse:acme', new Set(['greenhouse:1'])]]);
  assert.deepEqual([...closedIds(known, boards)], [], 'the Ashby acme board was not fetched');
  assert.equal(boardKey(rec('a', 'acme')), 'ashby:acme', 'a row with no ats is Ashby');
});

test('compactCorpus drops the ids it is given, every row of them', () => {
  const home = tempHome();
  try {
    fs.writeFileSync(P.corpus, jsonl([
      { ...rec('a', 'acme'), fetchedAt: '1' }, { ...rec('b', 'acme'), fetchedAt: '1' },
      { ...rec('b', 'acme'), fetchedAt: '2' }]));
    const r = compactCorpus({ drop: new Set(['b']) });
    assert.equal(r.after, 1);
    assert.deepEqual([...corpus().keys()], ['a']);
  } finally { cleanup(home); }
});

test('compactCorpus rewrites when there is something to drop even if nothing is superseded', () => {
  const home = tempHome();
  try {
    fs.writeFileSync(P.corpus, jsonl([{ ...rec('a', 'acme'), fetchedAt: '1' }, { ...rec('b', 'acme'), fetchedAt: '1' }]));
    compactCorpus({ drop: new Set(['a']) });
    assert.deepEqual([...corpus().keys()], ['b']);
  } finally { cleanup(home); }
});

test('dropRows removes rows by id and leaves everything else byte for byte', () => {
  const home = tempHome();
  try {
    const f = P.payEstimates;
    fs.writeFileSync(f, jsonl([{ id: 'a', x: 1 }, { id: 'b', x: 2 }]) + 'torn line\n');
    assert.equal(dropRows(f, new Set(['a'])), 1);
    assert.equal(fs.readFileSync(f, 'utf8'), jsonl([{ id: 'b', x: 2 }]) + 'torn line\n');
    assert.equal(dropRows(f, new Set(['nope'])), 0);
    assert.equal(dropRows(f + '.missing', new Set(['a'])), 0, 'a missing file is not an error');
  } finally { cleanup(home); }
});
