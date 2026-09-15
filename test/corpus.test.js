import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tempHome, cleanup, jsonl, corpusRecord } from './helpers.js';

let home;
afterEach(() => { if (home) cleanup(home); home = null; });
const load = async () => import('../lib/corpus.js?' + Math.random());

test('corpus ignores rows that are not corpus-shaped', async () => {
  // match.js --to-fresh once appended poll-shaped records here. A record with
  // descriptionPlain instead of description would read back with no description
  // at all, and the scorers would judge it blind.
  home = tempHome({ 'data/corpus.jsonl': jsonl([
    corpusRecord({ id: 'good' }),
    { id: 'bad', slug: 'acme', title: 'ML Engineer', descriptionPlain: 'poll-shaped' },
  ]) });
  const { corpus } = await load();
  const c = corpus();
  assert.ok(c.has('good'), 'well-formed record kept');
  assert.equal(c.has('bad'), false, 'poll-shaped record rejected');
});

test('a torn or truncated line does not lose the rest of the file', async () => {
  home = tempHome({ 'data/corpus.jsonl':
    JSON.stringify(corpusRecord({ id: 'a' })) + '\n{ not json\n' + JSON.stringify(corpusRecord({ id: 'b' })) + '\n' });
  const { corpus } = await load();
  const c = corpus();
  assert.deepEqual([...c.keys()].sort(), ['a', 'b']);
});

test('asPosting converts corpus shape to the shape the scorers read', async () => {
  const { asPosting } = await load();
  const out = asPosting(corpusRecord({ id: 'x', company: 'acme', description: 'body' }), 0.5, () => null);
  assert.equal(out.slug, 'acme');
  assert.equal(out.descriptionPlain, 'body');
  assert.equal(out.similarity, 0.5);
  assert.equal('company' in out, false, 'must not carry corpus field names through');
});
