import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest } from '../lib/ai.js';

// Extended thinking is the one knob that separates Haiku 4.5's fitness scores from
// Sonnet's. Measured: Haiku emitted 5,153 output tokens on 30 postings against
// Sonnet's 17,526, and scored 20 of 30 into a single 0.2-wide band — it was not
// reasoning about the bad matches at all.
//
// The shape is model-dependent and was verified against the live API, not assumed:
// Haiku 4.5 returns 400 "adaptive thinking is not supported on this model" for
// {type:'adaptive'}, and accepts {type:'enabled', budget_tokens:N}. Sonnet 5 and
// Opus 5 are the other way round — they reject budget_tokens. Sending the wrong one
// is a 400 on every request in the run, which is the failure class this project
// preflights for rather than repeating 1,396 times.

test('no thinking budget means no thinking block, as before', () => {
  const req = buildRequest('sys', 'user', { model: 'claude-haiku-4-5' });
  assert.equal(req.thinking, undefined);
});

test('a budget becomes enabled/budget_tokens for a model that takes it', () => {
  const req = buildRequest('sys', 'user', { model: 'claude-haiku-4-5', thinkBudget: 4000 });
  assert.deepEqual(req.thinking, { type: 'enabled', budget_tokens: 4000 });
});

test('a dated haiku id is still haiku', () => {
  const req = buildRequest('sys', 'user', { model: 'claude-haiku-4-5-20251001', thinkBudget: 4000 });
  assert.deepEqual(req.thinking, { type: 'enabled', budget_tokens: 4000 });
});

test('budget_tokens is refused for models that reject it, before any request', () => {
  // Sonnet 5 and Opus 5 400 on budget_tokens and think adaptively on their own.
  // Throwing here is the difference between one clear error and one per posting.
  for (const model of ['claude-sonnet-5', 'claude-opus-5', 'claude-fable-5-1']) {
    assert.throws(
      () => buildRequest('sys', 'user', { model, thinkBudget: 4000 }),
      /does not take an explicit thinking budget/,
      `${model} should refuse a budget`,
    );
  }
});

test('a budget at or above max_tokens is refused', () => {
  // The API requires budget_tokens < max_tokens; catching it here keeps it from
  // being a 400 on every request in the run.
  assert.throws(
    () => buildRequest('sys', 'user', { model: 'claude-haiku-4-5', thinkBudget: 16000, maxTokens: 16000 }),
    /below max_tokens/,
  );
});

test('thinking does not disturb the cached prefix or the schema slot', () => {
  const plain = buildRequest('sys', 'user', { model: 'claude-haiku-4-5' });
  const thinking = buildRequest('sys', 'user', { model: 'claude-haiku-4-5', thinkBudget: 4000 });
  assert.deepEqual(thinking.system, plain.system, 'system block must stay byte-identical');
  assert.deepEqual(thinking.messages, plain.messages);
  assert.deepEqual(thinking.output_config, plain.output_config);
});
