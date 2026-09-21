import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wantedTitle, usLocation } from '../lib/filters.js';

test('wantedTitle accepts the role shapes we are looking for', () => {
  for (const t of [
    'Machine Learning Engineer', 'ML Engineer', 'Senior MLOps Engineer',
    'ML Ops Infrastructure Engineer', 'LLM Engineer', 'AI Engineer',
    'Applied Scientist', 'Research Engineer', 'ML Infrastructure Engineer',
    'Systems Architect AI/ML Infrastructure', 'Computer Vision Engineer',
    'Deep Learning Engineer', 'NLP Engineer', 'Applied AI Engineer',
  ]) assert.ok(wantedTitle(t), `should accept: ${t}`);
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
    'Research Scientist, Foundation Models',
  ]) {
    assert.equal(wantedTitle(t), true, `"${t}" should still pass`);
  }
});

test('research engineer is untouched', () => {
  for (const t of ['Research Engineer', 'Senior Research Engineer', 'Research Engineer, LLM']) {
    assert.equal(wantedTitle(t), true, `"${t}" should still pass`);
  }
});

test('other scientist titles are untouched', () => {
  assert.equal(wantedTitle('Applied Scientist'), true);
  assert.equal(wantedTitle('ML Scientist'), true);
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
    'Robotics / Physical AI Research Engineer',
    'Principal Machine Learning Researcher (Physical AI)',
    'Senior Machine Learning Engineer, AI Infrastructure',
    'Machine Learning Engineer, Search Quality',
  ]) {
    assert.equal(wantedTitle(t), true, `"${t}" should still pass`);
  }
});
