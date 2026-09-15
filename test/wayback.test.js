import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugFromUrl, slugsFromCdx } from '../lib/discover.js';

// The CDX index returns every URL ever crawled under the host, junk included.
// slugsIn() is written for prose and is too permissive here: it would happily read
// a session token or a CSS value out of a malformed URL. These are all real lines
// from a live dump.

test('takes the first path segment, not a deeper one', () => {
  assert.equal(slugFromUrl('https://jobs.ashbyhq.com/anterior/1163af7a-d1d6-41db'), 'anterior');
});

test('lowercases, because Ashby slugs are case-insensitive', () => {
  assert.equal(slugFromUrl('https://jobs.ashbyhq.com/Ramp'), 'ramp');
});

test('percent-decodes before validating', () => {
  assert.equal(slugFromUrl('https://jobs.ashbyhq.com/scale%2Dai'), 'scale-ai');
});

test('keeps dots and dashes — real boards use both', () => {
  assert.equal(slugFromUrl('https://jobs.ashbyhq.com/aro.homes'), 'aro.homes');
  assert.equal(slugFromUrl('https://jobs.ashbyhq.com/array-behavioral-care'), 'array-behavioral-care');
});

test('the bare host has no slug', () => {
  assert.equal(slugFromUrl('https://jobs.ashbyhq.com/'), null);
});

test('a posting uuid is not a board', () => {
  assert.equal(slugFromUrl('https://jobs.ashbyhq.com/1163af7a-d1d6-41db-a8ea-fc49fd97c6b0'), null);
});

test('rejects the junk a URL index actually contains', () => {
  // A datadog config object that leaked into a crawled URL.
  assert.equal(slugFromUrl('https://jobs.ashbyhq.com/%2280e0bf43-e772-45ac%22,%22environment%22'), null);
  // CSS values, from a stylesheet URL that got mangled.
  assert.equal(slugFromUrl('https://jobs.ashbyhq.com/100vh'), null);
  assert.equal(slugFromUrl('https://jobs.ashbyhq.com/24px'), null);
  // A single character is never a board.
  assert.equal(slugFromUrl('https://jobs.ashbyhq.com/a'), null);
  // A bare number is a pagination artifact.
  assert.equal(slugFromUrl('https://jobs.ashbyhq.com/101'), null);
  // A session token: long, and hex all the way down.
  assert.equal(slugFromUrl('https://jobs.ashbyhq.com/18c78c4427514cebaa7039bbf8a8c249'), null);
});

test('a number in a real name is fine — only a bare number is not', () => {
  assert.equal(slugFromUrl('https://jobs.ashbyhq.com/30mpc'), '30mpc');
  assert.equal(slugFromUrl('https://jobs.ashbyhq.com/3commas'), '3commas');
});

test('ignores other hosts entirely', () => {
  assert.equal(slugFromUrl('https://jobs.lever.co/acme'), null);
  assert.equal(slugFromUrl('https://boards.greenhouse.io/beta'), null);
});

test('a line that is not a URL is skipped, not thrown on', () => {
  assert.equal(slugFromUrl('not a url'), null);
  assert.equal(slugFromUrl(''), null);
  assert.equal(slugFromUrl(null), null);
});

test('slugsFromCdx dedupes a whole dump into a set', () => {
  const dump = [
    'https://jobs.ashbyhq.com/acme',
    'https://jobs.ashbyhq.com/acme/1163af7a-d1d6-41db-a8ea-fc49fd97c6b0',
    'https://jobs.ashbyhq.com/Acme/application',
    'https://jobs.ashbyhq.com/beta',
    'https://jobs.ashbyhq.com/100vh',
    '',
  ].join('\n');
  assert.deepEqual([...slugsFromCdx(dump)].sort(), ['acme', 'beta']);
});
