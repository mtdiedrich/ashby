import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summaryOf, detailOf, HEAVY } from '../lib/board-row.js';

// One /api/board response was 5.8 MB for 600 rows — 3.4 MB of job descriptions and
// 1.7 MB of requirement evidence, for detail panes that are hidden until a row is
// expanded. The table needs none of it to draw a row.

const row = () => ({
  id: 'a', title: 'ML Engineer', slug: 'acme', location: 'Remote - US', pay: '$200K',
  fitness: 0.8, coverage: 0.6, similarity: 0.4, score: 0.6, fresh: 0.9, value: 0.75,
  daysLive: 2, state: 'judged', met: 6, reqTotal: 10,
  applyUrl: 'u1', jobUrl: 'u2', department: 'Eng', team: 'ML',
  workplaceType: 'Remote', employmentType: 'FullTime',
  judgedAt: '2026-09-20', fitnessModel: 'claude-sonnet-5',
  // the heavy half
  description: 'x'.repeat(5000),
  requirements: [{ text: 'PyTorch', score: 3, evidence: 'y'.repeat(200), kind: 'skill' }],
  why: 'a reason', concerns: ['one'], gaps: ['two'], constraints: ['three'],
});

test('the summary carries everything the table draws', () => {
  const s = summaryOf(row());
  for (const k of ['id', 'title', 'slug', 'location', 'pay', 'fitness', 'coverage',
                   'similarity', 'score', 'fresh', 'value', 'daysLive', 'state',
                   'met', 'reqTotal']) {
    assert.ok(k in s, `summary is missing ${k}, which a column reads`);
  }
});

test('the summary carries none of the heavy detail', () => {
  const s = summaryOf(row());
  for (const k of HEAVY) assert.ok(!(k in s), `${k} should not ride on every row`);
});

test('a summary is a fraction of the size', () => {
  const r = row();
  const full = JSON.stringify(r).length;
  const lean = JSON.stringify(summaryOf(r)).length;
  assert.ok(lean < full / 10, `summary is ${lean} of ${full} bytes — expected under a tenth`);
});

test('the detail carries what the expanded pane draws, and nothing else', () => {
  const d = detailOf(row());
  for (const k of HEAVY) assert.ok(k in d, `detail is missing ${k}`);
  assert.ok(!('fitness' in d), 'the numbers are already on the summary');
});

test('together they lose nothing the pane needs', () => {
  const r = row();
  const merged = { ...summaryOf(r), ...detailOf(r) };
  for (const k of ['description', 'requirements', 'why', 'concerns', 'gaps', 'constraints',
                   'applyUrl', 'jobUrl', 'department', 'workplaceType', 'judgedAt']) {
    assert.deepEqual(merged[k], r[k], `${k} did not survive the split`);
  }
});

test('missing fields do not become undefined keys', () => {
  const s = summaryOf({ id: 'a' });
  assert.equal(s.id, 'a');
  const d = detailOf({ id: 'a' });
  assert.deepEqual(d.requirements, [], 'an absent list is empty, not undefined');
  assert.deepEqual(d.concerns, []);
  assert.equal(d.description, '');
});

test('nullish input does not throw', () => {
  assert.equal(summaryOf(null).id, undefined);
  assert.deepEqual(detailOf(null).requirements, []);
});

// The similarity column showed the raw centred cosine (~0.10–0.25) while fitness and
// coverage showed 0–1, so the three columns could not be read against each other.
// The normalised value is what `score` already uses.
test('the summary carries the normalised similarity', () => {
  const s = summaryOf({ ...row(), nSimilarity: 0.62 });
  assert.equal(s.nSimilarity, 0.62);
});

test('nSimilarity is null when there is nothing to normalise', () => {
  const s = summaryOf({ id: 'a' });
  assert.equal(s.nSimilarity, null, 'missing must be null, not undefined');
});

test('the raw similarity is still carried, for the tooltip', () => {
  const s = summaryOf({ ...row(), nSimilarity: 0.62 });
  assert.equal(s.similarity, 0.4);
});
