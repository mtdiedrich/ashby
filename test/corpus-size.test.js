import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ATS, postingUrl } from '../lib/ats.js';

// Fetching one posting back on demand — the board's stage button uses it for a
// posting crawled before every description was stored.

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
