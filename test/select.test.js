import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidates } from '../lib/select.js';
import { corpusRecord, comp } from './helpers.js';

const asMap = (...recs) => new Map(recs.map(r => [r.id, r]));
const ids = rows => rows.map(r => r.id).sort();

test('returns matching postings in the shape the scorers read', () => {
  const c = asMap(corpusRecord({ id: 'a' }));
  const [row] = candidates(c, {});
  // corpus uses company/description/compensation; scorers read slug/descriptionPlain/salary
  assert.equal(row.slug, 'acme');
  assert.equal(row.descriptionPlain, 'Train and serve models.');
  assert.ok('salary' in row);
  assert.equal(row.id, 'a');
});

test('drops titles that are not the job', () => {
  const c = asMap(
    corpusRecord({ id: 'keep', title: 'ML Engineer' }),
    corpusRecord({ id: 'drop', title: 'Machine Learning Intern' }),
    corpusRecord({ id: 'drop2', title: 'Backend Engineer' }),
  );
  assert.deepEqual(ids(candidates(c, {})), ['keep']);
});

test('--all keeps every title', () => {
  const c = asMap(
    corpusRecord({ id: 'a', title: 'ML Engineer' }),
    corpusRecord({ id: 'b', title: 'Office Manager' }),
  );
  assert.deepEqual(ids(candidates(c, { all: true })), ['a', 'b']);
});

test('drops postings abroad when us is set', () => {
  const c = asMap(
    corpusRecord({ id: 'sf', location: 'San Francisco' }),
    corpusRecord({ id: 'ldn', location: 'London' }),
  );
  assert.deepEqual(ids(candidates(c, { us: true })), ['sf']);
});

test('skips anything already scored on every front', () => {
  const c = asMap(corpusRecord({ id: 'a' }), corpusRecord({ id: 'b' }));
  assert.deepEqual(ids(candidates(c, { done: new Set(['a']) })), ['b']);
});

test('being staged does not exclude a posting — only being finished does', () => {
  // fresh.jsonl is a worklist the scorers re-read, not a queue the first one drains.
  const c = asMap(corpusRecord({ id: 'a' }), corpusRecord({ id: 'b' }));
  assert.deepEqual(ids(candidates(c, {})), ['a', 'b']);
});

test('skips anything dismissed', () => {
  const c = asMap(corpusRecord({ id: 'a' }), corpusRecord({ id: 'b' }));
  assert.deepEqual(ids(candidates(c, { dismissed: new Set(['a']) })), ['b']);
});

test('drops postings whose stated pay tops out below the floor', () => {
  const c = asMap(
    corpusRecord({ id: 'rich', compensation: comp(200000, 300000) }),
    corpusRecord({ id: 'poor', compensation: comp(80000, 120000) }),
    corpusRecord({ id: 'silent', compensation: null }),
  );
  // Unstated pay passes on purpose — that was in the spec and stays.
  assert.deepEqual(ids(candidates(c, { minPay: 150000 })), ['rich', 'silent']);
});

test('maxAgeDays drops stale postings, and 0 disables the check', () => {
  const old = new Date(Date.now() - 200 * 86400000).toISOString();
  const c = asMap(
    corpusRecord({ id: 'new' }),
    corpusRecord({ id: 'old', publishedAt: old }),
  );
  assert.deepEqual(ids(candidates(c, { maxAgeDays: 90 })), ['new']);
  assert.deepEqual(ids(candidates(c, { maxAgeDays: 0 })), ['new', 'old']);
});

test('newest postings come first', () => {
  const c = asMap(
    corpusRecord({ id: 'older', publishedAt: '2026-01-01T00:00:00.000Z' }),
    corpusRecord({ id: 'newer', publishedAt: '2026-09-01T00:00:00.000Z' }),
  );
  assert.deepEqual(candidates(c, {}).map(r => r.id), ['newer', 'older']);
});

test('an empty corpus yields nothing rather than throwing', () => {
  assert.deepEqual(candidates(new Map(), {}), []);
});

// ---- bulk staging by similarity ----------------------------------------
// This was `match --to-fresh`. The board can only stage one posting at a time,
// so the capability moved here rather than being dropped with the command.

import { topUnscored } from '../lib/select.js';

const row = (id, sim, { fitness = null, coverage = null } = {}) => ({ id, similarity: sim, fitness, coverage });

test('topUnscored takes the highest-similarity postings that still need scoring', () => {
  const rows = [row('a', 0.1), row('b', 0.3), row('c', 0.2)];
  assert.deepEqual(topUnscored(rows, 2).map(r => r.id), ['b', 'c']);
});

test('topUnscored skips anything already scored on both fronts', () => {
  const rows = [row('done', 0.9, { fitness: 0.5, coverage: 0.5 }), row('a', 0.1)];
  assert.deepEqual(topUnscored(rows, 5).map(r => r.id), ['a']);
});

test('a posting with only one score still counts as needing work', () => {
  const rows = [row('half', 0.9, { fitness: 0.5 }), row('a', 0.1)];
  assert.deepEqual(topUnscored(rows, 5).map(r => r.id), ['half', 'a']);
});

test('postings with no similarity yet are not staged by this route', () => {
  const rows = [row('novec', null), row('a', 0.1)];
  assert.deepEqual(topUnscored(rows, 5).map(r => r.id), ['a']);
});

test('asking for more than exist returns what there is', () => {
  assert.equal(topUnscored([row('a', 0.1)], 50).length, 1);
});
