import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tidy } from '../lib/text.js';

const NBSP = String.fromCharCode(0xa0);
const ZWSP = String.fromCharCode(0x200b);
const LSEP = String.fromCharCode(0x2028);

test('tidy collapses runs of blank lines to one', () => {
  assert.equal(tidy('a\n\n\n\n\nb'), 'a\n\nb');
});

test('a line holding only a non-breaking space counts as blank', () => {
  // This is what Ashby actually stores; it is why descriptions had 111 blank lines.
  assert.equal(tidy(`a\n${NBSP}\n${NBSP}\nb`), 'a\n\nb');
});

test('zero-width characters are dropped, not turned into spaces', () => {
  assert.equal(tidy(`a${ZWSP}b`), 'ab');
});

test('unicode line separators become real newlines', () => {
  assert.equal(tidy(`a${LSEP}b`), 'a\nb');
});

test('CRLF is normalised', () => {
  assert.equal(tidy('a\r\nb'), 'a\nb');
});

test('trailing whitespace goes, interior spacing stays', () => {
  assert.equal(tidy('a   \nb  c  \n'), 'a\nb  c');
});

test('tidy is idempotent', () => {
  const messy = `x\n${NBSP}\n\n\ny   \r\n${ZWSP}\nz`;
  assert.equal(tidy(tidy(messy)), tidy(messy));
});

test('empty and nullish input give an empty string', () => {
  assert.equal(tidy(''), '');
  assert.equal(tidy(null), '');
  assert.equal(tidy(undefined), '');
});
