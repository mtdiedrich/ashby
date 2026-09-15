import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tempHome, cleanup } from './helpers.js';
import { P } from '../lib/paths.js';
import { compactCorpus, corpus } from '../lib/corpus.js';

const row = (id, fetchedAt, extra = {}) =>
  JSON.stringify({ id, company: 'acme', title: 'ML Engineer', fetchedAt, ...extra });

const withCorpus = (body, fn) => {
  const home = tempHome();
  try { if (body !== null) fs.writeFileSync(P.corpus, body); return fn(); }
  finally { cleanup(home); }
};

// corpus.jsonl is append-only, so a posting re-crawled with different content is
// written again rather than replaced. That is fine until a change touches most of
// the file at once: a storage-policy change rewrote 60,903 Ashby rows, the file
// passed Node's 512 MB string limit, and every command that reads it died.

test('keeps only the newest row per posting', () => withCorpus(
  [row('a', '2026-01-01', { description: 'old' }),
   row('b', '2026-01-01'),
   row('a', '2026-02-01', { description: 'new' })].join('\n') + '\n',
  () => {
    const r = compactCorpus();
    assert.equal(r.before, 3);
    assert.equal(r.after, 2);
    const c = corpus();
    assert.equal(c.size, 2);
    assert.equal(c.get('a').description, 'new', 'the newest row must survive');
  }));

test('ties resolve the way corpus() does — the later line wins', () => withCorpus(
  [row('a', '2026-01-01', { description: 'first' }),
   row('a', '2026-01-01', { description: 'second' })].join('\n') + '\n',
  () => {
    compactCorpus();
    assert.equal(corpus().get('a').description, 'second');
  }));

test('a file with nothing superseded is left byte-identical', () => {
  const body = [row('a', '2026-01-01'), row('b', '2026-01-01')].join('\n') + '\n';
  return withCorpus(body, () => {
    const r = compactCorpus();
    assert.equal(r.before, r.after);
    assert.equal(fs.readFileSync(P.corpus, 'utf8'), body, 'nothing to do means no rewrite');
  });
});

test('the result is exactly what corpus() would have returned', () => withCorpus(
  [row('a', '2026-01-01', { description: 'x' }),
   row('b', '2026-03-01'),
   row('a', '2026-02-01', { description: 'y' }),
   row('c', '2026-01-01'),
   row('b', '2026-01-01')].join('\n') + '\n',
  () => {
    const before = corpus();
    compactCorpus();
    const after = corpus();
    assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort());
    for (const [id, rec] of before) assert.deepEqual(after.get(id), rec, `${id} changed`);
  }));

test('rows of the wrong shape are dropped, not carried forward', () => withCorpus(
  [row('a', '2026-01-01'),
   JSON.stringify({ id: 'p', slug: 'acme', descriptionPlain: 'poll-shaped' }),
   'not json at all'].join('\n') + '\n',
  () => {
    assert.equal(compactCorpus().after, 1);
    assert.equal(corpus().size, 1);
  }));

test('a missing or empty corpus is not an error', () => {
  withCorpus(null, () => {
    assert.deepEqual(compactCorpus(), { before: 0, after: 0, bytesBefore: 0, bytesAfter: 0 });
  });
  withCorpus('', () => assert.equal(compactCorpus().after, 0));
});

test('the original survives a failed rewrite', () => {
  const body = [row('a', '2026-01-01'), row('a', '2026-02-01')].join('\n') + '\n';
  return withCorpus(body, () => {
    // A directory where the temp file wants to go makes the write fail.
    fs.mkdirSync(P.corpus + '.compacting');
    assert.throws(() => compactCorpus());
    assert.equal(fs.readFileSync(P.corpus, 'utf8'), body, 'corpus must survive a failed compaction');
  });
});
