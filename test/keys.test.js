import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikePlaceholder, isAuthError, checkKey } from '../lib/keys.js';

// A run against a bad key made 1,396 requests, printed 1,396 warnings, filled its
// progress bar to 100%, reported "1396 in 25s" and then "0 scored". The only honest
// line in that output was the zero. A 401 is the same for every call and will not
// come right on its own, so it has to stop the run rather than be repeated.

test('spots the placeholders people actually leave behind', () => {
  for (const v of ['YOUR_OPENAI_API_KEY', 'YOUR_ANTHROPIC_API_KEY', 'your-api-key-here',
                   'sk-xxxxxxxx', '<your key>', 'changeme', 'TODO', 'xxx', '']) {
    assert.equal(looksLikePlaceholder(v), true, `"${v}" should read as a placeholder`);
  }
});

test('does not cry wolf on a real-looking key', () => {
  for (const v of ['sk-ant-api03-' + 'a1B2c3D4'.repeat(11),
                   'sk-proj-' + 'Zx9Yw8Vu'.repeat(12)]) {
    assert.equal(looksLikePlaceholder(v), false, 'a real key must pass');
  }
});

test('whitespace and quotes do not disguise a placeholder', () => {
  assert.equal(looksLikePlaceholder('  YOUR_OPENAI_API_KEY  '), true);
  assert.equal(looksLikePlaceholder('"YOUR_OPENAI_API_KEY"'), true);
});

test('a missing key is a placeholder too', () => {
  assert.equal(looksLikePlaceholder(undefined), true);
  assert.equal(looksLikePlaceholder(null), true);
});

// ---- recognising the failure once it comes back --------------------------

test('recognises an authentication failure from either provider', () => {
  assert.equal(isAuthError({ status: 401 }), true);
  assert.equal(isAuthError({ status: 403 }), true);
  assert.equal(isAuthError(new Error('embeddings 401 { "error": { "message": "Incorrect API key provided')), true);
  assert.equal(isAuthError(new Error('401 {"type":"error","error":{"type":"authentication_error"')), true);
  assert.equal(isAuthError(new Error('invalid x-api-key')), true);
});

test('does not mistake an ordinary failure for an auth one', () => {
  assert.equal(isAuthError({ status: 429 }), false);
  assert.equal(isAuthError({ status: 500 }), false);
  assert.equal(isAuthError(new Error('structured output failed to parse')), false);
  assert.equal(isAuthError(new Error('socket hang up')), false);
  // "401" inside a posting title or body must not trip it.
  assert.equal(isAuthError(new Error('no result for "401k Administrator"')), false);
  assert.equal(isAuthError(null), false);
});

// ---- the preflight -------------------------------------------------------

test('checkKey passes a plausible key and names the file when it does not', () => {
  assert.equal(checkKey('ANTHROPIC_API_KEY', 'sk-ant-api03-' + 'a1B2c3D4'.repeat(11)), null);
  const msg = checkKey('ANTHROPIC_API_KEY', 'YOUR_OPENAI_API_KEY');
  assert.match(msg, /ANTHROPIC_API_KEY/);
  assert.match(msg, /\.env/);
  assert.match(msg, /placeholder/i);
});

test('a missing key says so rather than saying placeholder', () => {
  assert.match(checkKey('OPENAI_API_KEY', undefined), /not set/i);
});

// The preflight's own error has to be recognisable too, or the pool keeps going and
// prints the same message once per posting — 1,396 times, in the run that found this.
test('the preflight error reads as an auth error', async () => {
  const { badKeyError } = await import('../lib/keys.js');
  const e = badKeyError('ANTHROPIC_API_KEY', 'YOUR_OPENAI_API_KEY');
  assert.equal(isAuthError(e), true);
  assert.match(e.message, /ANTHROPIC_API_KEY/);
  assert.match(e.message, /\.env/);
});
