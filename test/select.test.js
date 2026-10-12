import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidates } from '../lib/select.js';
import { corpusRecord, comp } from './helpers.js';

const asMap = (...recs) => new Map(recs.map(r => [r.id, r]));
const ids = rows => rows.map(r => r.id).sort();

test('returns postings in the shape the scorers read, without the description', () => {
  const c = asMap(corpusRecord({ id: 'a' }));
  const [row] = candidates(c, {});
  // corpus uses company/compensation; scorers read slug/salary
  assert.equal(row.slug, 'acme');
  assert.ok('salary' in row);
  assert.equal(row.id, 'a');
  // The worklist is every unscored posting — ~225,000 of them. Carrying descriptions
  // made it 1.3 GB; the scorer reads each from descriptions.jsonl when it asks.
  assert.equal('descriptionPlain' in row, false);
});

test('every title is a candidate — there is no title filter', () => {
  const c = asMap(
    corpusRecord({ id: 'a', title: 'ML Engineer' }),
    corpusRecord({ id: 'b', title: 'Machine Learning Intern' }),
    corpusRecord({ id: 'c', title: 'Office Manager' }),
  );
  assert.deepEqual(ids(candidates(c, {})), ['a', 'b', 'c']);
});

test('only US postings are candidates — non-US roles are not scored', () => {
  const c = asMap(
    corpusRecord({ id: 'sf', location: 'San Francisco' }),
    corpusRecord({ id: 'stl', location: 'St. Louis, MO' }),
    corpusRecord({ id: 'remote', location: 'Remote' }),
    corpusRecord({ id: 'ldn', location: 'London' }),
    corpusRecord({ id: 'blr', location: 'Bengaluru, India' }),
  );
  assert.deepEqual(ids(candidates(c, {})), ['remote', 'sf', 'stl']);
});

test('stated pay does not exclude a posting', () => {
  const c = asMap(
    corpusRecord({ id: 'rich', compensation: comp(200000, 300000) }),
    corpusRecord({ id: 'poor', compensation: comp(80000, 120000) }),
  );
  assert.deepEqual(ids(candidates(c, { minPay: 150000 })), ['poor', 'rich']);
});

test('age does not exclude a posting', () => {
  const old = new Date(Date.now() - 400 * 86400000).toISOString();
  const c = asMap(corpusRecord({ id: 'new' }), corpusRecord({ id: 'old', publishedAt: old }));
  assert.deepEqual(ids(candidates(c, { maxAgeDays: 90 })), ['new', 'old']);
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
