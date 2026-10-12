import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tempHome, cleanup, jsonl } from './helpers.js';
import { P } from '../lib/paths.js';
import { descriptionOf, describe, splitRecord, compactDescriptions, descriptionIndex }
  from '../lib/descriptions.js';
import { ATS } from '../lib/ats.js';
import { statedPay } from '../lib/pay-text.js';

// Every description is stored now — there is no title filter deciding which. In
// corpus.jsonl that is ~1.2 billion characters, almost all of them two-byte strings
// once parsed, held by poll, the board and crawl at once: about 2.5 GB against a 4 GB
// heap. So descriptions live in their own file, read one at a time by byte offset,
// and the corpus stays metadata the board can afford to keep in memory.

const row = (id, hash, description) => ({ id, hash, description });

test('a description is read back by id, and the newest row wins', () => {
  const home = tempHome();
  try {
    fs.writeFileSync(P.descriptions, jsonl([row('a', 'h1', 'old'), row('b', 'h1', 'bee'), row('a', 'h2', 'new')]));
    assert.equal(descriptionOf('a'), 'new');
    assert.equal(descriptionOf('b'), 'bee');
    assert.equal(descriptionOf('nope'), null);
    assert.equal(descriptionIndex().get('a').hash, 'h2');
  } finally { cleanup(home); }
});

test('offsets are bytes, so multi-byte text before a row does not shift it', () => {
  const home = tempHome();
  try {
    fs.writeFileSync(P.descriptions, jsonl([row('a', 'h', 'Zürich — “quotes” 🚀'.repeat(50)), row('b', 'h', 'after ✓')]));
    assert.equal(descriptionOf('b'), 'after ✓');
    assert.equal(descriptionOf('a'), 'Zürich — “quotes” 🚀'.repeat(50));
  } finally { cleanup(home); }
});

test('a row appended after the index was built is seen', () => {
  const home = tempHome();
  try {
    fs.writeFileSync(P.descriptions, jsonl([row('a', 'h', 'one')]));
    assert.equal(descriptionOf('a'), 'one');
    fs.appendFileSync(P.descriptions, jsonl([row('a', 'h2', 'two'), row('c', 'h', 'see')]));
    assert.equal(descriptionOf('a'), 'two');
    assert.equal(descriptionOf('c'), 'see');
  } finally { cleanup(home); }
});

test('a torn line is skipped rather than thrown on', () => {
  const home = tempHome();
  try {
    fs.writeFileSync(P.descriptions, jsonl([row('a', 'h', 'ok')]) + '{"id":"b","hash":"h","descr\n' + jsonl([row('c', 'h', 'fine')]));
    assert.equal(descriptionOf('a'), 'ok');
    assert.equal(descriptionOf('b'), null);
    assert.equal(descriptionOf('c'), 'fine');
  } finally { cleanup(home); }
});

test('a missing file is no descriptions, not an error', () => {
  const home = tempHome();
  try { assert.equal(descriptionOf('a'), null); } finally { cleanup(home); }
});

test('describe prefers the store, and falls back to a description the record carries', () => {
  const home = tempHome();
  try {
    fs.writeFileSync(P.descriptions, jsonl([row('a', 'h', 'stored')]));
    assert.equal(describe({ id: 'a', description: 'legacy' }), 'stored');
    assert.equal(describe({ id: 'b', description: 'legacy' }), 'legacy', 'corpus rows written before the store');
    assert.equal(describe({ id: 'c', descriptionPlain: 'poll shape' }), 'poll shape');
    assert.equal(describe({ id: 'd' }), '');
  } finally { cleanup(home); }
});

test('splitRecord: metadata for the corpus, the text for the store', () => {
  const rec = ATS.ashby.normalize({ id: 'a1', title: 'Recruiter',
    descriptionPlain: 'Salary range: $150,000 to $250,000 USD annually.' }, 'acme', 'now');
  rec.hash = 'hh';
  const { meta, desc } = splitRecord(rec);
  assert.equal('description' in meta, false, 'the corpus row carries no description');
  assert.equal(meta.title, 'Recruiter');
  assert.equal(meta.hash, 'hh');
  assert.equal(meta.descPay.min, 150000, 'pay stated in the text is read once, at crawl time');
  assert.deepEqual(Object.keys(desc), ['id', 'hash', 'description'], 'id first, so the index reads it off the front');
  assert.match(desc.description, /Salary range/);
});

test('splitRecord records "no pay in the text" as null, not as missing', () => {
  const rec = { ...ATS.ashby.normalize({ id: 'a1', title: 'X', descriptionPlain: 'Nothing.' }, 'acme', 'now'), hash: 'h' };
  const { meta } = splitRecord(rec);
  assert.ok('descPay' in meta);
  assert.equal(meta.descPay, null);
});

test('statedPay uses the crawl-time answer, and parses only a record that predates it', () => {
  assert.equal(statedPay({ descPay: null, description: 'Salary: $150,000 - $200,000' }), null,
    'descPay was computed from the full text and wins');
  assert.equal(statedPay({ descPay: { min: 1, max: 2 } }).min, 1);
  assert.equal(statedPay({ description: 'Salary range: $150,000 to $250,000 USD' }).min, 150000);
  assert.equal(statedPay({}), null);
});

test('normalize always keeps the description — nothing decides which titles deserve one', () => {
  const gh = ATS.greenhouse.normalize({ id: 5, title: 'Account Executive', content: '&lt;p&gt;Sell things.&lt;/p&gt;' }, 'acme', 'now');
  assert.match(gh.description, /Sell things/);
  assert.equal('descriptionStored' in gh, false);
  const ab = ATS.ashby.normalize({ id: 'a1', title: 'Warehouse Associate', descriptionPlain: 'Hello' }, 'acme', 'now');
  assert.equal(ab.description, 'Hello');
});

test('compactDescriptions keeps the newest row of each live id and drops the rest', () => {
  const home = tempHome();
  try {
    fs.writeFileSync(P.descriptions, jsonl([row('a', 'h1', 'old'), row('b', 'h', 'closed'), row('a', 'h2', 'new'), row('c', 'h', 'see')]));
    const r = compactDescriptions({ keep: new Set(['a', 'c']) });
    assert.deepEqual([r.before, r.after], [4, 2]);
    assert.equal(descriptionOf('a'), 'new');
    assert.equal(descriptionOf('b'), null);
    assert.equal(descriptionOf('c'), 'see');
    assert.equal(fs.readFileSync(P.descriptions, 'utf8').split('\n').filter(Boolean).length, 2);
  } finally { cleanup(home); }
});
