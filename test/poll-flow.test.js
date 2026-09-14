// End-to-end of the selection flow against real files, in a temp home.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tempHome, cleanup, jsonl, corpusRecord } from './helpers.js';

let home;
afterEach(() => { if (home) cleanup(home); home = null; });

// Imported lazily so each test sees the current ASHBY_HOME.
const load = async () => {
  const { corpus } = await import('../lib/corpus.js?' + Math.random());
  const { candidates } = await import('../lib/select.js?' + Math.random());
  return { corpus, candidates };
};

test('the corpus is read newest-record-per-id', async () => {
  home = tempHome({ 'data/corpus.jsonl': jsonl([
    corpusRecord({ id: 'a', title: 'ML Engineer', description: 'old', fetchedAt: '2026-01-01T00:00:00.000Z' }),
    corpusRecord({ id: 'a', title: 'ML Engineer', description: 'new', fetchedAt: '2026-09-01T00:00:00.000Z' }),
  ]) });
  const { corpus } = await load();
  const c = corpus();
  assert.equal(c.size, 1, 'one record per id');
  assert.equal(c.get('a').description, 'new', 'newest wins');
});

test('a judged posting is not proposed again', async () => {
  home = tempHome({
    'data/corpus.jsonl': jsonl([corpusRecord({ id: 'a' }), corpusRecord({ id: 'b' })]),
    'data/fitness.jsonl': jsonl([{ id: 'a', fitness: 0.5, scoredAt: '2026-09-01T00:00:00.000Z' }]),
  });
  const { corpus, candidates } = await load();
  const judged = new Set(JSON.parse('[]').concat(
    fs.readFileSync(home + '/data/fitness.jsonl', 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).id)));
  assert.deepEqual(candidates(corpus(), { judged }).map(r => r.id), ['b']);
});

test('staging twice does not duplicate a posting', async () => {
  home = tempHome({ 'data/corpus.jsonl': jsonl([corpusRecord({ id: 'a' })]) });
  const { corpus, candidates } = await load();
  const first = candidates(corpus(), {});
  assert.equal(first.length, 1);
  const staged = new Set(first.map(r => r.id));
  assert.deepEqual(candidates(corpus(), { staged }), [], 'second pass stages nothing');
});

test('dismissal survives and keeps a posting out permanently', async () => {
  home = tempHome({
    'data/corpus.jsonl': jsonl([corpusRecord({ id: 'a' }), corpusRecord({ id: 'b' })]),
    'data/dismissed.jsonl': jsonl([{ id: 'a', at: '2026-09-01T00:00:00.000Z' }]),
  });
  const { corpus, candidates } = await load();
  const dismissed = new Set(
    fs.readFileSync(home + '/data/dismissed.jsonl', 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).id));
  assert.deepEqual(candidates(corpus(), { dismissed }).map(r => r.id), ['b']);
});

test('a missing corpus is empty, not an error', async () => {
  home = tempHome({});
  const { corpus, candidates } = await load();
  assert.deepEqual(candidates(corpus(), {}), []);
});
