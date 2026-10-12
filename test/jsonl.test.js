import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { appendRows } from '../lib/jsonl.js';

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ashby-')), 'out.jsonl');
const linesIn = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

// fitness.js accumulated every score in memory and wrote once, after the last batch.
// Ctrl-C, a crash or a killed terminal threw away everything already scored and paid
// for. Scores are written as each batch lands now, the way coverage and embed do.

test('writes one line per row', () => {
  const f = tmpFile();
  appendRows(f, [{ id: 'a' }, { id: 'b' }]);
  assert.deepEqual(linesIn(f), [{ id: 'a' }, { id: 'b' }]);
});

test('appends rather than replacing', () => {
  const f = tmpFile();
  appendRows(f, [{ id: 'a' }]);
  appendRows(f, [{ id: 'b' }]);
  assert.deepEqual(linesIn(f).map(r => r.id), ['a', 'b']);
});

test('an empty batch writes nothing at all', () => {
  const f = tmpFile();
  appendRows(f, [{ id: 'a' }]);
  appendRows(f, []);
  // A stray blank line would be harmless to the readers but makes wc -l lie.
  assert.equal(fs.readFileSync(f, 'utf8'), '{"id":"a"}\n');
});

test('nullish rows are not an error', () => {
  const f = tmpFile();
  appendRows(f, null);
  appendRows(f, undefined);
  assert.equal(fs.existsSync(f), false, 'nothing to write means no file');
});

test('every batch ends with a newline, so the next append starts clean', () => {
  const f = tmpFile();
  for (let i = 0; i < 5; i++) appendRows(f, [{ i }]);
  const body = fs.readFileSync(f, 'utf8');
  assert.ok(body.endsWith('\n'));
  assert.ok(!body.includes('\n\n'), 'no blank lines between batches');
  assert.equal(linesIn(f).length, 5);
});

test('a row containing a newline does not break the line-per-row shape', () => {
  const f = tmpFile();
  appendRows(f, [{ why: 'line one\nline two' }, { id: 'b' }]);
  assert.equal(linesIn(f).length, 2, 'JSON.stringify escapes it');
  assert.equal(linesIn(f)[0].why, 'line one\nline two');
});
