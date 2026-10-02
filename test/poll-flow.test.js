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
  const { candidates, finished } = await import('../lib/select.js?' + Math.random());
  return { corpus, candidates, finished };
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

// Jev's fitness is the only front since 2026-10-02. Through the real finished(), so
// the rule cannot change underneath this test.
test('a posting stops being proposed once it has a fitness score, and not before', async () => {
  home = tempHome({
    'data/corpus.jsonl': jsonl([corpusRecord({ id: 'a' }), corpusRecord({ id: 'b' })]),
    'data/jev-fitness.jsonl': jsonl([{ id: 'a', fitness: 0.3, at: '2026-09-01T00:00:00.000Z' }]),
  });
  const { corpus, candidates, finished } = await load();
  const fit = new Set(fs.readFileSync(home + '/data/jev-fitness.jsonl', 'utf8')
    .split('\n').filter(Boolean).map(l => JSON.parse(l).id));
  const done = finished({ fitness: fit });
  assert.deepEqual(candidates(corpus(), { done }).map(r => r.id), ['b']);
});

test('selection is stable, so the worklist can be rewritten rather than appended', async () => {
  home = tempHome({ 'data/corpus.jsonl': jsonl([corpusRecord({ id: 'a' })]) });
  const { corpus, candidates } = await load();
  assert.deepEqual(candidates(corpus(), {}).map(r => r.id), ['a']);
  assert.deepEqual(candidates(corpus(), {}).map(r => r.id), ['a'], 'same answer every time');
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
