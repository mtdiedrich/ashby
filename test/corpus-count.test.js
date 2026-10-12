import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tempHome, cleanup } from './helpers.js';
import { P } from '../lib/paths.js';
import { corpus, corpusAndCount, rawLineCount } from '../lib/corpus.js';

const row = (id, fetchedAt, extra = {}) =>
  JSON.stringify({ id, company: 'acme', title: 'ML Engineer', fetchedAt, ...extra });

const withCorpus = (body, fn) => {
  const home = tempHome();
  try { fs.writeFileSync(P.corpus, body); return fn(); } finally { cleanup(home); }
};

// crawl.js read the whole corpus four times in one run — once for the known set,
// twice for the compaction check, once for the closing line. At 190 MB that is about
// twelve seconds of a run that already prints nothing while it works.

test('returns the same map corpus() does, plus the raw line count', () => withCorpus(
  [row('a', '2026-01-01'), row('b', '2026-01-01'), row('a', '2026-02-01')].join('\n') + '\n',
  () => {
    const { map, lines } = corpusAndCount();
    assert.equal(lines, 3, 'every line, revisions included');
    assert.equal(map.size, 2, 'distinct postings');
    assert.deepEqual([...map.keys()].sort(), [...corpus().keys()].sort());
  }));

test('the count includes rows of the wrong shape, which rawLineCount did not', () => withCorpus(
  [row('a', '2026-01-01'),
   JSON.stringify({ id: 'p', slug: 'acme', descriptionPlain: 'poll-shaped' })].join('\n') + '\n',
  () => {
    const { map, lines } = corpusAndCount();
    assert.equal(map.size, 1, 'the poll-shaped row is not a posting');
    assert.equal(lines, 2, 'but it is still a line, and still costs bytes');
  }));

test('an empty corpus counts zero', () => withCorpus('', () => {
  const { map, lines } = corpusAndCount();
  assert.equal(map.size, 0);
  assert.equal(lines, 0);
}));

test('rawLineCount still agrees with it', () => withCorpus(
  [row('a', '2026-01-01'), row('a', '2026-02-01'), row('b', '2026-01-01')].join('\n') + '\n',
  () => assert.equal(rawLineCount(), corpusAndCount().lines)));
