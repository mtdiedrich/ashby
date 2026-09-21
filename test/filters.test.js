import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wantedTitle, usLocation } from '../lib/filters.js';

test('wantedTitle accepts the role shapes we are looking for', () => {
  for (const t of [
    'Machine Learning Engineer', 'ML Engineer', 'Senior MLOps Engineer',
    'ML Ops Infrastructure Engineer', 'LLM Engineer', 'AI Engineer',
    'ML Infrastructure Engineer',
    'Systems Architect AI/ML Infrastructure', 'Computer Vision Engineer',
    'Deep Learning Engineer', 'NLP Engineer', 'Applied AI Engineer',
  ]) assert.ok(wantedTitle(t), `should accept: ${t}`);
});

// Dropped from WANT: they matched too much that was not the job. A bare "Research
// Engineer" is a research-lab title, "Applied Scientist" is Amazon's name for a
// research role, and "Foundation Model" reaches pretraining teams. The ML ones still
// arrive through their own keyword — "Research Engineer, Machine Learning" matches
// on "machine learning" — which is the same reason "research scientist" came out.
test('wantedTitle no longer accepts bare research and applied-science titles', () => {
  for (const t of [
    'Applied Scientist', 'Research Engineer', 'Senior Applied Scientist',
    'Foundation Model Engineer', 'Research Engineer, Robotics',
  ]) assert.equal(wantedTitle(t), false, `should reject: ${t}`);
});

test('but the same roles still arrive when the title says ML', () => {
  for (const t of [
    'Research Engineer, Machine Learning', 'Applied Scientist, LLM',
    'Research Scientist, Machine Learning', 'Foundation Model ML Engineer',
  ]) assert.ok(wantedTitle(t), `should accept: ${t}`);
});

// "lead" and "leader" are not the same cut. A Lead ML Engineer is usually a staff
// IC title and sits inside the mid-to-senior scope; an AI Leader is management.
// Rejecting "lead" outright removed 78 postings, about half of them senior IC.
test('wantedTitle keeps lead-titled roles, which are usually senior IC', () => {
  for (const t of [
    'Lead Machine Learning Engineer', 'ML Engineer, Team Lead',
    'Lead AI Engineer', 'Technical Lead - Machine Learning',
    'Lead Applied AI Engineer', 'Lead AI/ML Engineer',
  ]) assert.ok(wantedTitle(t), `should accept: ${t}`);
});

test('wantedTitle rejects leader-titled roles, which are management', () => {
  for (const t of [
    'Enterprise Applied AI Leader', 'Machine Learning Engineer, Team Leader',
    'AI Engineering Leader', 'Leader, Machine Learning Platform',
  ]) assert.equal(wantedTitle(t), false, `should reject: ${t}`);
});

// Two things REJECT could plausibly catch by accident and does not. Both are here
// because the list holds phrases, not their individual words: "developer advocate"
// cannot match a bare Developer, and "people ops" cannot match ML Ops.
test('REJECT does not catch developers through "developer advocate"', () => {
  for (const t of [
    'Machine Learning Developer', 'Senior AI Engineer / Developer',
    'LLM Developer',
  ]) assert.ok(wantedTitle(t), `should accept: ${t}`);
  assert.equal(wantedTitle('AI Developer Advocate'), false, 'the phrase itself still rejects');
});

test('REJECT does not catch ML Ops through "people ops"', () => {
  for (const t of [
    'ML Ops Engineer', 'MLOps Engineer', 'Senior ML Ops Platform Engineer',
  ]) assert.ok(wantedTitle(t), `should accept: ${t}`);
  assert.equal(wantedTitle('People Ops Manager'), false, 'the phrase itself still rejects');
});

test('wantedTitle rejects titles that merely mention ML', () => {
  for (const t of [
    'Machine Learning Intern',
    'Senior Manager, Imaging Machine Learning',
    'Director of Machine Learning',
    'Product Counsel - Machine Learning & AI',
    'Account Executive - AI Native',
    'SDET, Inference Platform',
    'Senior Software Engineer (Frontend) - AI/ML',
    'Technical Program Manager, ML Infrastructure',
    'AI Silicon Physical Design Engineer',
  ]) assert.equal(wantedTitle(t), false, `should reject: ${t}`);
});

test('wantedTitle rejects unrelated roles outright', () => {
  for (const t of ['Backend Engineer', 'Office Manager', 'Paralegal', 'Designer'])
    assert.equal(wantedTitle(t), false, `should reject: ${t}`);
});

test('usLocation accepts US cities, states and bare remote', () => {
  for (const l of [
    'San Francisco', 'Palo Alto, CA', 'New York, NY', 'Remote',
    'USA | Remote', 'United States', 'Cedar Rapids, Iowa', 'Austin', 'Seattle',
  ]) assert.ok(usLocation(l, l), `should accept: ${l}`);
});

test('usLocation rejects locations abroad', () => {
  for (const l of [
    'Tokyo, Japan', 'London, UK', 'Seoul, South Korea', 'Paris',
    'Toronto', 'Remote - European Union', 'Singapore', 'Bangalore, India',
  ]) assert.equal(usLocation(l, l), false, `should reject: ${l}`);
});

test('a US city in secondaryLocations does not drag in a London posting', () => {
  // This was a real bug: testing the combined string let abroad roles through.
  assert.equal(usLocation('London', 'London | San Francisco'), false);
  assert.equal(usLocation('Toronto', 'Toronto | New York'), false);
});

test('a US primary with foreign secondaries is still US', () => {
  assert.ok(usLocation('San Francisco', 'San Francisco | London'));
});

test('usLocation does not match the "us" inside other words', () => {
  // \b boundaries: "Museum" and "Customer Site" contain "us" but are not the US.
  assert.equal(usLocation('Museum District, Berlin', 'Museum District, Berlin'), false);
});

// "Research Scientist" is no longer a reason on its own to include a posting — that
// term is what dragged in wet-lab, pharma and philosophy roles. A research scientist
// role that names ML or AI still qualifies; the title was never the problem, the
// absence of any ML signal was.
test('a bare research scientist title is not enough on its own', () => {
  for (const t of [
    'Research Scientist',
    'Senior Research Scientist',
    'Research Scientist (Philosophy)',
    'Member of Platform Science (Research Scientist, In-vivo)',
  ]) {
    assert.equal(wantedTitle(t), false, `"${t}" should not qualify`);
  }
});

test('a research scientist role that names ML or AI still qualifies', () => {
  for (const t of [
    'Research Scientist, Machine Learning',
    'ML Research Scientist - Representation Learning',
  ]) {
    assert.equal(wantedTitle(t), true, `"${t}" should still pass`);
  }
});

// "Research Scientist, Foundation Models" used to reach the board on "foundation
// model" alone. With that term dropped it no longer names ML or AI anywhere in the
// title, and a research-lab title with no ML keyword is exactly what came out.
test('a research title with no ML keyword left does not qualify', () => {
  for (const t of [
    'Research Scientist, Foundation Models',
    'Research Engineer', 'Senior Research Engineer',
    'Applied Scientist', 'Senior Applied Scientist',
  ]) {
    assert.equal(wantedTitle(t), false, `"${t}" should not qualify`);
  }
});

test('the same titles qualify again once they name ML', () => {
  for (const t of ['Research Engineer, LLM', 'ML Scientist', 'Applied Scientist, NLP']) {
    assert.equal(wantedTitle(t), true, `"${t}" should still pass`);
  }
});

// Wet-lab, pharma and chemistry roles reach the board through a real ML keyword —
// "Machine Learning Scientist, Protein Design" matches WANT on "machine learning".
// The title is ML; the job is bench science. Checked against the live corpus: these
// terms hit 15 postings and collide with nothing wanted.
test('bench-science roles are rejected even when the title says ML', () => {
  for (const t of [
    'Machine Learning Scientist I / II, Protein Design',
    'Senior ML Scientist, AI for Protein Engineering',
    'Principal Scientist, Machine Learning - Biomolecules',
    'Senior ML Scientist, Biological Systems',
    'Senior/Principal ML Scientist, Translational Biology',
    'Senior Bioinformatics Research Engineer',
    'Computational Chemist (Machine Learning) I / II',
    'Staff Software Engineer, Machine Learning and Computational Chemistry',
    'Scientist II / Senior ML Scientist, Data-Efficient Learning for Drug Discovery',
    'ML Research Scientist - Representation Learning for Molecular AI',
  ]) {
    assert.equal(wantedTitle(t), false, `"${t}" should be rejected`);
  }
});

test('ML infrastructure is not bench science, whatever the adjacent word', () => {
  for (const t of [
    'Senior AI Infrastructure Engineer, Physical Infrastructure',
    'Principal Machine Learning Researcher (Physical AI)',
    'Senior Machine Learning Engineer, AI Infrastructure',
    'Machine Learning Engineer, Search Quality',
  ]) {
    assert.equal(wantedTitle(t), true, `"${t}" should still pass`);
  }
});
