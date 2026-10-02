import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { effortFlag, thinkFlag, buildRequest, EFFORTS } from '../lib/ai.js';

// Parsed in lib rather than in the script, for the reason jobsFlag is: a flag
// parser inside bin/ cannot be tested, because importing a script in this project
// runs it and spends money.
//
// Checked against the live API: Sonnet 5 accepts all five levels, and output tokens
// climb with them (119 / 144 / 184 / 190 / 1740 on one fixed prompt). fitness.js has
// always sent the default 'high' and never had a way to ask for less.

test('no flag means the fallback, high unless the caller says otherwise', () => {
  assert.equal(effortFlag(['node', 'fitness.js']), 'high');
  assert.equal(effortFlag(['node', 'fitness.js', '--force']), 'high');
  assert.equal(effortFlag(['node', 'fitness.js'], 'low'), 'low');
});

test('an explicit flag beats the fallback', () => {
  assert.equal(effortFlag(['node', 'x', '--effort', 'max'], 'low'), 'max');
});

// Measured over 30 postings, twice each: Sonnet at effort=low agrees with effort=high
// at rho 0.919 and 0.093 mean absolute difference, against a NOISE FLOOR of rho 0.953
// and 0.053 — Sonnet's disagreement with its own previous run on the same input. It
// keeps the spread (sd 0.236 vs 0.234) and the bottom-end discrimination that makes
// fitness worth paying for, at 62% fewer output tokens: $9.30 against $14.08 to
// rescore the whole corpus batched. high is a flag away when a run deserves it.

test('a level is read off the flag', () => {
  for (const level of EFFORTS) {
    assert.equal(effortFlag(['node', 'x', '--effort', level]), level);
  }
});

test('an unknown level is refused rather than sent', () => {
  // The API would 400 on every request in the run — the same answer every time,
  // which is the class of failure this project preflights for.
  assert.throws(() => effortFlag(['node', 'x', '--effort', 'lowest']), /not an effort level/);
  assert.throws(() => effortFlag(['node', 'x', '--effort']), /not an effort level/);
});

test('effort reaches the request for a model that takes it', () => {
  const req = buildRequest('sys', 'user', { model: 'claude-sonnet-5', effort: 'low' });
  assert.equal(req.output_config.effort, 'low');
});

test('effort is still withheld from haiku, which rejects it', () => {
  const req = buildRequest('sys', 'user', { model: 'claude-haiku-4-5', effort: 'low' });
  assert.equal(req.output_config.effort, undefined);
});

test('the thinking budget parses the same way', () => {
  assert.equal(thinkFlag(['node', 'x']), null);
  assert.equal(thinkFlag(['node', 'x', '--think', '4000']), 4000);
  assert.throws(() => thinkFlag(['node', 'x', '--think', 'lots']), /token budget/);
  assert.throws(() => thinkFlag(['node', 'x', '--think']), /token budget/);
});
