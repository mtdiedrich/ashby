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
