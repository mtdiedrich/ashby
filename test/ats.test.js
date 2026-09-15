import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ATS, adapterFor, htmlToText, inferWorkplace } from '../lib/ats.js';

test('both boards are registered and have distinct hosts', () => {
  assert.deepEqual(Object.keys(ATS).sort(), ['ashby', 'greenhouse']);
  assert.match(ATS.ashby.host, /ashbyhq\.com/);
  assert.match(ATS.greenhouse.host, /greenhouse\.io/);
});

test('a record with no ats field is Ashby — every existing corpus row predates this', () => {
  assert.equal(adapterFor({ id: 'x' }).id, 'ashby');
  assert.equal(adapterFor({ ats: 'greenhouse' }).id, 'greenhouse');
  assert.equal(adapterFor(null).id, 'ashby');
});

// ---- Greenhouse content is ESCAPED html; Ashby's is already plain ---------

test('unescapes and strips Greenhouse content', () => {
  const raw = '&lt;h2&gt;Who we are&lt;/h2&gt;\n&lt;p&gt;We build &lt;b&gt;things&lt;/b&gt;.&lt;/p&gt;';
  const out = htmlToText(raw);
  assert.match(out, /Who we are/);
  assert.match(out, /We build things\./);
  assert.ok(!/[<>]/.test(out), `tags survived: ${out}`);
  assert.ok(!/&lt;|&gt;|&amp;/.test(out), `entities survived: ${out}`);
});

test('block tags become line breaks, so paragraphs do not run together', () => {
  const out = htmlToText('&lt;p&gt;One&lt;/p&gt;&lt;p&gt;Two&lt;/p&gt;');
  // A blank line between paragraphs is right; what matters is that they do not merge.
  assert.match(out, /One\n+Two/);
});

test('list items survive as separate lines', () => {
  const out = htmlToText('&lt;ul&gt;&lt;li&gt;First&lt;/li&gt;&lt;li&gt;Second&lt;/li&gt;&lt;/ul&gt;');
  assert.match(out, /First/);
  assert.match(out, /Second/);
  assert.notEqual(out.replace(/\s+/g, ' ').trim(), 'FirstSecond');
});

test('common entities decode', () => {
  assert.equal(htmlToText('caf&amp;eacute;&amp;nbsp;x').includes('<'), false);
  assert.match(htmlToText('&lt;p&gt;a &amp;amp; b&lt;/p&gt;'), /a & b/);
  assert.match(htmlToText('&lt;p&gt;5 &amp;gt; 3&lt;/p&gt;'), /5 > 3/);
});

test('already-plain text passes through unharmed', () => {
  assert.equal(htmlToText('Just a sentence.'), 'Just a sentence.');
  assert.equal(htmlToText(''), '');
  assert.equal(htmlToText(null), '');
});

// ---- Greenhouse has no workplaceType; it has to come from the location ----

test('infers remote from the location string', () => {
  assert.equal(inferWorkplace('Remote from the US'), 'Remote');
  assert.equal(inferWorkplace('US - Remote'), 'Remote');
  assert.equal(inferWorkplace('Remote'), 'Remote');
  assert.equal(inferWorkplace('Remote - New York'), 'Remote');
});

test('hybrid is not remote', () => {
  assert.equal(inferWorkplace('Hybrid - San Francisco'), 'Hybrid');
  assert.equal(inferWorkplace('San Francisco (Hybrid)'), 'Hybrid');
});

test('a plain office location is left unknown rather than guessed', () => {
  assert.equal(inferWorkplace('San Francisco, CA'), null);
  assert.equal(inferWorkplace(''), null);
  assert.equal(inferWorkplace(null), null);
});

// ---- normalising to the corpus record shape ------------------------------

const ghJob = {
  id: 8172503,
  title: 'Abuse Research Engineer',
  location: { name: 'Remote from the US' },
  departments: [{ name: 'Security Analytics' }],
  offices: [{ name: 'US' }, { name: 'New York' }],
  first_published: '2026-09-09T10:52:09-04:00',
  updated_at: '2026-09-10T13:11:58-04:00',
  absolute_url: 'https://stripe.com/jobs/search?gh_jid=8172503',
  content: '&lt;p&gt;Build things.&lt;/p&gt;',
};

test('a Greenhouse job becomes a corpus record', () => {
  const r = ATS.greenhouse.normalize(ghJob, 'stripe', '2026-09-15T00:00:00Z');
  assert.equal(r.ats, 'greenhouse');
  assert.equal(r.company, 'stripe');
  assert.equal(r.id, 'greenhouse:8172503', 'ids must not collide with Ashby uuids');
  assert.equal(r.title, 'Abuse Research Engineer');
  assert.equal(r.location, 'Remote from the US');
  assert.equal(r.department, 'Security Analytics');
  assert.equal(r.workplaceType, 'Remote');
  assert.equal(r.publishedAt, '2026-09-09T10:52:09-04:00');
  assert.equal(r.description, 'Build things.');
  assert.equal(r.compensation, null, 'Greenhouse publishes none');
});

test('the apply url goes to the Greenhouse form, not the company microsite', () => {
  // absolute_url for Stripe points at stripe.com, which is not a form we can reach.
  const r = ATS.greenhouse.normalize(ghJob, 'stripe', 'now');
  assert.match(r.applyUrl, /job-boards\.greenhouse\.io\/stripe\/jobs\/8172503/);
});

test('secondary locations come from offices', () => {
  const r = ATS.greenhouse.normalize(ghJob, 'stripe', 'now');
  assert.match(r.secondaryLocations, /New York/);
});

test('missing optional fields become null, not undefined', () => {
  const r = ATS.greenhouse.normalize({ id: 1, title: 'X' }, 'acme', 'now');
  for (const k of ['department', 'team', 'employmentType', 'compensation', 'publishedAt']) {
    assert.equal(r[k], null, `${k} should be null`);
  }
  assert.equal(r.location, '');
  assert.equal(r.description, '');
});

test('an Ashby job still normalises exactly as before', () => {
  const j = {
    id: 'abc-123', title: 'ML Engineer', department: 'Eng', team: 'Core',
    location: 'San Francisco', secondaryLocations: [{ location: 'NYC' }],
    isRemote: false, workplaceType: 'Onsite', employmentType: 'FullTime',
    publishedAt: '2026-09-01', jobUrl: 'https://jobs.ashbyhq.com/acme/abc-123',
    applyUrl: 'https://jobs.ashbyhq.com/acme/abc-123/application',
    compensation: { summaryComponents: [] }, descriptionPlain: 'Hello',
  };
  const r = ATS.ashby.normalize(j, 'acme', 'now');
  assert.equal(r.ats, 'ashby');
  assert.equal(r.id, 'abc-123', 'Ashby ids are unprefixed, so existing rows still match');
  assert.equal(r.workplaceType, 'Onsite');
  assert.equal(r.secondaryLocations, 'NYC');
  assert.equal(r.description, 'Hello');
});

test('board urls are built per ATS', () => {
  assert.match(ATS.ashby.boardUrl('acme'), /api\.ashbyhq\.com.*acme/);
  assert.match(ATS.greenhouse.boardUrl('acme'), /boards-api\.greenhouse\.io.*acme.*content=true/);
});

test('postings are pulled out of each response shape', () => {
  assert.deepEqual(ATS.ashby.postingsFrom({ jobs: [{ id: 1 }] }), [{ id: 1 }]);
  assert.deepEqual(ATS.greenhouse.postingsFrom({ jobs: [{ id: 2 }] }), [{ id: 2 }]);
  assert.deepEqual(ATS.ashby.postingsFrom({}), []);
  assert.deepEqual(ATS.greenhouse.postingsFrom(null), []);
});
