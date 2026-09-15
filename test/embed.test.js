import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clip, shrink, MAX_CHARS } from '../lib/embed.js';

test('short text is left alone', () => {
  assert.equal(clip('hello'), 'hello');
});

test('long text is cut to the limit', () => {
  const s = 'x'.repeat(MAX_CHARS * 3);
  assert.ok(clip(s).length <= MAX_CHARS);
});

test('clipping keeps the head and the tail', () => {
  // Requirements live at the bottom of a posting; keeping only the top loses them.
  const s = 'HEAD' + 'x'.repeat(MAX_CHARS * 2) + 'TAIL';
  const out = clip(s);
  assert.ok(out.startsWith('HEAD'), 'keeps the opening');
  assert.ok(out.endsWith('TAIL'), 'keeps the closing');
});

test('nullish input is an empty string, not a crash', () => {
  assert.equal(clip(null), '');
  assert.equal(clip(undefined), '');
});

test('shrink halves an input', () => {
  // The API counts tokens, we can only count characters, and the ratio varies wildly
  // between prose and text dense in code or punctuation. When the API says an input
  // was too long, the answer is to cut and retry rather than guess better.
  const s = 'x'.repeat(1000);
  assert.ok(shrink(s).length < s.length);
  assert.ok(shrink(s).length >= 400, 'halves rather than obliterates');
});

test('shrink keeps head and tail too', () => {
  const s = 'HEAD' + 'y'.repeat(2000) + 'TAIL';
  const out = shrink(s);
  assert.ok(out.startsWith('HEAD'));
  assert.ok(out.endsWith('TAIL'));
});

test('shrink converges to empty rather than looping forever', () => {
  let s = 'x'.repeat(5000);
  for (let i = 0; i < 40; i++) s = shrink(s);
  assert.ok(s.length < 20, `should collapse, got ${s.length}`);
});

test('the character limit leaves real headroom under 8192 tokens', () => {
  // 8192 tokens at a pessimistic ~2.5 chars/token is ~20k chars. The old 28k limit
  // assumed 4 chars/token, which held for prose and failed on dense postings.
  assert.ok(MAX_CHARS <= 20_000, `MAX_CHARS is ${MAX_CHARS}, too optimistic`);
});
