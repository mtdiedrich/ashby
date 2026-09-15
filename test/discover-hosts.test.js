import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugFromUrl, slugsFromCdx } from '../lib/discover.js';

// slugFromUrl was hardcoded to ashbyhq.com. Greenhouse needs the same treatment over
// two hosts, and the junk filtering is identical, so the host became a parameter.

test('defaults to Ashby, so every existing caller is unchanged', () => {
  assert.equal(slugFromUrl('https://jobs.ashbyhq.com/anterior/1163af7a-d1d6-41db'), 'anterior');
  assert.equal(slugFromUrl('https://boards.greenhouse.io/figma'), null, 'not Ashby');
});

test('reads Greenhouse tokens when asked for that host', () => {
  const gh = /(^|\.)greenhouse\.io$/i;
  assert.equal(slugFromUrl('https://job-boards.greenhouse.io/figma', gh), 'figma');
  assert.equal(slugFromUrl('https://boards.greenhouse.io/figma/jobs/5813967004', gh), 'figma');
  assert.equal(slugFromUrl('https://jobs.ashbyhq.com/anterior', gh), null, 'not Greenhouse');
});

test('the junk filters still apply on the other host', () => {
  const gh = /(^|\.)greenhouse\.io$/i;
  assert.equal(slugFromUrl('https://boards.greenhouse.io/100vh', gh), null);
  assert.equal(slugFromUrl('https://boards.greenhouse.io/a', gh), null);
  assert.equal(slugFromUrl('https://boards.greenhouse.io/1163af7a-d1d6-41db-a8ea-fc49fd97c6b0', gh), null);
  assert.equal(slugFromUrl('https://boards.greenhouse.io/', gh), null);
});

test('Greenhouse serves assets from the same host and they are not boards', () => {
  const gh = /(^|\.)greenhouse\.io$/i;
  for (const junk of ['embed', 'assets', 'static', 'robots.txt', 'sitemap.xml', 'favicon.ico']) {
    assert.equal(slugFromUrl(`https://boards.greenhouse.io/${junk}`, gh), null, `"${junk}" is not a board`);
  }
});

test('slugsFromCdx takes the host through', () => {
  const gh = /(^|\.)greenhouse\.io$/i;
  const dump = [
    'https://job-boards.greenhouse.io/figma',
    'https://boards.greenhouse.io/figma/jobs/123',
    'https://boards.greenhouse.io/stripe',
    'https://jobs.ashbyhq.com/anterior',
  ].join('\n');
  assert.deepEqual([...slugsFromCdx(dump, gh)].sort(), ['figma', 'stripe']);
  assert.deepEqual([...slugsFromCdx(dump)].sort(), ['anterior'], 'default is still Ashby');
});
