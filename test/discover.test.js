import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugsIn, unescapeHtml } from '../lib/discover.js';

test('HN escapes the slashes in a URL; they have to come back', () => {
  assert.equal(unescapeHtml('https:&#x2F;&#x2F;jobs.ashbyhq.com&#x2F;acme'), 'https://jobs.ashbyhq.com/acme');
});

test('pulls the slug out of a real HN comment', () => {
  const comment = 'Apply: <a href="https:&#x2F;&#x2F;jobs.ashbyhq.com&#x2F;anterior&#x2F;1163af7a-d1d6" rel="nofollow">link</a>';
  assert.deepEqual([...slugsIn(comment)], ['anterior']);
});

test('lowercases, because Ashby slugs are case-insensitive', () => {
  assert.deepEqual([...slugsIn('jobs.ashbyhq.com/Ramp')], ['ramp']);
});

test('finds several in one comment and dedupes', () => {
  const t = 'jobs.ashbyhq.com/acme jobs.ashbyhq.com/beta jobs.ashbyhq.com/acme';
  assert.deepEqual([...slugsIn(t)].sort(), ['acme', 'beta']);
});

test('a posting uuid is not a slug', () => {
  // jobs.ashbyhq.com/<slug>/<uuid> — only the first segment is the board.
  const t = 'jobs.ashbyhq.com/1163af7a-d1d6-41db-a8ea-fc49fd97c6b0';
  assert.deepEqual([...slugsIn(t)], []);
});

test('ignores links to other hosts', () => {
  assert.deepEqual([...slugsIn('greenhouse.io/acme lever.co/beta')], []);
});

test('empty and nullish input are empty sets, not errors', () => {
  assert.equal(slugsIn('').size, 0);
  assert.equal(slugsIn(null).size, 0);
});
