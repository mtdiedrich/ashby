import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ATS } from '../lib/ats.js';
import { keepDescription, postingUrl } from '../lib/ats.js';

// Measured on the real corpus: 380 MB of which 367 MB (96.5%) is descriptions for
// titles the filters will never pass to a scorer. Greenhouse is 3x the postings at a
// sixth the ML/AI density, and storing it the same way projected a 5.5 GB heap —
// past Node's default limit, so corpus() would simply stop loading.
//
// Metadata is kept for everything, so the board still lists every posting and you can
// still stage one. The description is fetched on demand when that happens.

test('a wanted title keeps its description', () => {
  assert.equal(keepDescription('Senior Machine Learning Engineer'), true);
  assert.equal(keepDescription('AI Infrastructure Engineer'), true);
});

test('a title no scorer will ever see does not', () => {
  assert.equal(keepDescription('Account Executive, EMEA'), false);
  assert.equal(keepDescription('Warehouse Associate'), false);
  assert.equal(keepDescription('Staff Accountant'), false);
});

test('a rejected ML title still does not keep it', () => {
  // Matches WANT but REJECT drops it, so it is never scored either.
  assert.equal(keepDescription('Machine Learning Intern'), false);
  assert.equal(keepDescription('Engineering Manager, ML Platform'), false);
});

test('a missing title is not kept, and does not throw', () => {
  assert.equal(keepDescription(null), false);
  assert.equal(keepDescription(''), false);
  assert.equal(keepDescription(undefined), false);
});

test('normalize can drop the description on request', () => {
  const j = { id: 5, title: 'Account Executive', content: '&lt;p&gt;Sell things.&lt;/p&gt;' };
  const full = ATS.greenhouse.normalize(j, 'acme', 'now');
  const lean = ATS.greenhouse.normalize(j, 'acme', 'now', { descriptions: false });
  assert.match(full.description, /Sell things/);
  assert.equal(lean.description, '');
  assert.equal(lean.descriptionStored, false, 'must be marked, or it reads as an empty posting');
  assert.equal(full.descriptionStored, undefined, 'stored ones carry no flag');
});

test('dropping the description keeps every other field', () => {
  const j = { id: 5, title: 'Account Executive', location: { name: 'NYC' },
              first_published: '2026-01-01', content: '&lt;p&gt;x&lt;/p&gt;' };
  const lean = ATS.greenhouse.normalize(j, 'acme', 'now', { descriptions: false });
  assert.equal(lean.title, 'Account Executive');
  assert.equal(lean.location, 'NYC');
  assert.equal(lean.publishedAt, '2026-01-01');
  assert.match(lean.applyUrl, /job-boards\.greenhouse\.io/);
});

test('Ashby honours the same option', () => {
  const j = { id: 'a1', title: 'Recruiter', descriptionPlain: 'Hello' };
  assert.equal(ATS.ashby.normalize(j, 'acme', 'now').description, 'Hello');
  const lean = ATS.ashby.normalize(j, 'acme', 'now', { descriptions: false });
  assert.equal(lean.description, '');
  assert.equal(lean.descriptionStored, false);
});

// ---- fetching one posting back on demand ---------------------------------

test('builds a single-posting url per ATS', () => {
  assert.match(postingUrl(ATS.greenhouse, 'figma', 'greenhouse:5813967004'),
    /boards-api\.greenhouse\.io\/v1\/boards\/figma\/jobs\/5813967004\?content=true/);
  // Ashby has no single-posting endpoint; the board call returns everything.
  assert.match(postingUrl(ATS.ashby, 'acme', 'abc-123'), /job-board\/acme/);
});

test('the greenhouse: prefix is stripped before it reaches the api', () => {
  const u = postingUrl(ATS.greenhouse, 'figma', 'greenhouse:123');
  assert.ok(!u.includes('greenhouse%3A'), 'the prefix is ours, not theirs');
  assert.ok(u.endsWith('/jobs/123?content=true'));
});
