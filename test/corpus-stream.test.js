import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { linesOf } from '../lib/corpus.js';

const tmp = (name, body) => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ashby-')), name);
  fs.writeFileSync(f, body);
  return f;
};

// corpus.jsonl passed Node's maximum string length (0x1fffffe8, ~512 MB) and
// readFileSync(f, 'utf8') threw ERR_STRING_TOO_LONG, taking down poll, crawl and the
// board at once. Nothing may build the whole file as one string any more.

test('reads every line', () => {
  const f = tmp('a.jsonl', 'one\ntwo\nthree\n');
  assert.deepEqual([...linesOf(f)], ['one', 'two', 'three']);
});

test('a missing trailing newline still yields the last line', () => {
  const f = tmp('b.jsonl', 'one\ntwo');
  assert.deepEqual([...linesOf(f)], ['one', 'two']);
});

test('blank lines are skipped', () => {
  const f = tmp('c.jsonl', 'one\n\n\ntwo\n');
  assert.deepEqual([...linesOf(f)], ['one', 'two']);
});

test('a missing file yields nothing rather than throwing', () => {
  assert.deepEqual([...linesOf(path.join(os.tmpdir(), 'nope-' + Date.now() + '.jsonl'))], []);
});

test('an empty file yields nothing', () => {
  assert.deepEqual([...linesOf(tmp('d.jsonl', ''))], []);
});

// The reason to use StringDecoder rather than buf.toString() per chunk: a multi-byte
// character landing across a chunk boundary would otherwise be cut in half and come
// back as replacement characters, silently corrupting descriptions.
test('multi-byte characters survive a chunk boundary', () => {
  // Long enough to cross several 64KB chunks, with emoji and accents throughout.
  const unit = 'héllo 🚀 café — naïve ✨ ';
  const line = unit.repeat(400);
  const body = Array.from({ length: 60 }, (_, i) => `${i}:${line}`).join('\n') + '\n';
  const f = tmp('e.jsonl', body);
  const got = [...linesOf(f)];
  assert.equal(got.length, 60);
  assert.equal(got[0], `0:${line}`);
  assert.equal(got[59], `59:${line}`);
  assert.ok(!got.join('').includes('\uFFFD'), 'no replacement characters');
});

test('lines longer than one chunk are reassembled whole', () => {
  const long = 'x'.repeat(300_000);
  const f = tmp('f.jsonl', `short\n${long}\nalso-short\n`);
  const got = [...linesOf(f)];
  assert.deepEqual([got[0], got[2]], ['short', 'also-short']);
  assert.equal(got[1].length, 300_000);
});

test('json parses back out identically', () => {
  const rows = [{ id: 'a', description: 'é🚀' }, { id: 'b', description: 'x'.repeat(50_000) }];
  const f = tmp('g.jsonl', rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  assert.deepEqual([...linesOf(f)].map(l => JSON.parse(l)), rows);
});
