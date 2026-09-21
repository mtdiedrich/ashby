import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atsOf } from '../lib/ats.js';

// apply.js gates on the ATS, because fill.browser.js reads a specific DOM. It read
// `job.ats ?? 'ashby'` off the queued row — and the queued row is the FITNESS row,
// whose rowsFrom() copies id/title/slug/location/salary/jobUrl/applyUrl and drops
// `ats`. So every scored Greenhouse posting arrived looking like Ashby and sat 30
// seconds waiting for `[data-field-path]`, a selector Greenhouse does not have.
//
// Stamping `ats` on new rows fixes it going forward; inferring it fixes the rows
// already on disk, which carry no `ats` at all.

test('an explicit ats wins', () => {
  assert.equal(atsOf({ ats: 'greenhouse' }), 'greenhouse');
  assert.equal(atsOf({ ats: 'ashby' }), 'ashby');
});

test('a greenhouse-prefixed id is greenhouse', () => {
  assert.equal(atsOf({ id: 'greenhouse:6194289004' }), 'greenhouse');
});

test('a greenhouse apply url is greenhouse', () => {
  assert.equal(atsOf({ applyUrl: 'https://job-boards.greenhouse.io/blueroseresearch/jobs/6194289004' }), 'greenhouse');
  assert.equal(atsOf({ jobUrl: 'https://boards.greenhouse.io/figma/jobs/5426468004?gh_jid=5426468004' }), 'greenhouse');
});

// The project's oldest convention: 62,000 rows predate the field, and every one of
// them is Ashby. An unprefixed id with no greenhouse url must stay Ashby.
test('no ats, no prefix, no greenhouse url is ashby', () => {
  assert.equal(atsOf({ id: '29f36dfd-7d52-4dac-a257-9e197d390775' }), 'ashby');
  assert.equal(atsOf({ applyUrl: 'https://jobs.ashbyhq.com/openai/abc' }), 'ashby');
  assert.equal(atsOf({}), 'ashby');
  assert.equal(atsOf(null), 'ashby');
});

// "greenhouse" inside a company name is not the ATS. A board called
// greenhouseapp on Ashby must not be mistaken for a Greenhouse board.
test('the word greenhouse in a slug is not the ats', () => {
  assert.equal(atsOf({ slug: 'greenhouse-software', id: 'abc-def' }), 'ashby');
  assert.equal(atsOf({ applyUrl: 'https://jobs.ashbyhq.com/greenhouse/xyz' }), 'ashby');
});
