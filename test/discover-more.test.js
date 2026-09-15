import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugsFromCdxJson, ycCandidates } from '../lib/discover.js';

// Common Crawl's index returns one JSON object per line, not CDX text.
test('reads urls out of Common Crawl JSONL', () => {
  const body = [
    JSON.stringify({ url: 'https://jobs.ashbyhq.com/acme/1163af7a-d1d6-41db-a8ea-fc49', status: '200' }),
    JSON.stringify({ url: 'https://jobs.ashbyhq.com/beta' }),
    'not json at all',
    JSON.stringify({ nourl: true }),
    '',
  ].join('\n');
  assert.deepEqual([...slugsFromCdxJson(body)].sort(), ['acme', 'beta']);
});

test('a Common Crawl error page is not a slug', () => {
  const body = JSON.stringify({ url: 'https://jobs.ashbyhq.com/100vh' });
  assert.deepEqual([...slugsFromCdxJson(body)], []);
});

// YC publishes a company's own slug, display name and website. An Ashby slug is
// usually one of those three, so all three are tried — 507 of the boards already
// known were reachable this way, which is what makes guessing worth doing at all.
test('takes the slug, the name and the domain', () => {
  const c = { slug: 'deepmark', name: 'DeepMark', website: 'https://www.deepmark.me' };
  assert.deepEqual([...ycCandidates(c)].sort(), ['deepmark']);
});

test('a multi-word name becomes a hyphenated slug', () => {
  const c = { name: 'Array Behavioral Care', slug: 'array-behavioral-care' };
  assert.deepEqual([...ycCandidates(c)], ['array-behavioral-care']);
});

test('strips the scheme, www and the tld from a website', () => {
  assert.ok(ycCandidates({ website: 'https://www.scale.com/' }).has('scale'));
  assert.ok(ycCandidates({ website: 'http://ramp.io' }).has('ramp'));
  assert.ok(ycCandidates({ website: 'https://foo.dev/careers' }).has('foo'));
});

test('a name and a domain that differ both become candidates', () => {
  const c = { name: 'Bland AI', website: 'https://bland.ai' };
  const out = ycCandidates(c);
  assert.ok(out.has('bland-ai'), 'the name');
  assert.ok(out.has('bland'), 'the domain');
});

test('rubbish in gives nothing out, not a crash', () => {
  assert.equal(ycCandidates({}).size, 0);
  assert.equal(ycCandidates(null).size, 0);
  assert.equal(ycCandidates({ name: '', website: '   ' }).size, 0);
  assert.equal(ycCandidates({ name: '!' }).size, 0, 'a single character is not a slug');
});

test('candidates are lowercase and carry no stray punctuation', () => {
  const out = [...ycCandidates({ name: "O'Reilly & Sons, Inc." })];
  for (const s of out) assert.match(s, /^[a-z0-9][a-z0-9.-]*$/, `"${s}" is not slug-shaped`);
});
