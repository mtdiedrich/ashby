import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completeBatch } from '../lib/batch.js';

// fitness.js sends 8 postings per request and matches replies on an index the model
// echoes back. When it returns 7, the 8th posting was silently dropped — 16 of 856
// postings (1.9%) went unscored that way, against 1 for the one-at-a-time scorer.

test('a complete reply needs no retry', async () => {
  let calls = 0;
  const { results, missing } = await completeBatch([0, 1, 2], async (want) => {
    calls++;
    return want.map(i => ({ index: i, fitness: 0.5 }));
  });
  assert.equal(calls, 1);
  assert.equal(results.length, 3);
  assert.deepEqual(missing, []);
});

test('re-asks for exactly the indices that came back missing', async () => {
  const asked = [];
  const { results, missing } = await completeBatch([0, 1, 2, 3], async (want) => {
    asked.push([...want]);
    // First pass drops 1 and 3; the retry returns them.
    return want.filter(i => asked.length > 1 || i % 2 === 0).map(i => ({ index: i }));
  });
  assert.deepEqual(asked, [[0, 1, 2, 3], [1, 3]], 'retry must ask only for the gaps');
  assert.deepEqual(results.map(r => r.index).sort(), [0, 1, 2, 3]);
  assert.deepEqual(missing, []);
});

test('gives up after the retry budget and reports what is still missing', async () => {
  let calls = 0;
  const { results, missing } = await completeBatch([0, 1, 2], async (want) => {
    calls++;
    return want.filter(i => i !== 2).map(i => ({ index: i }));
  }, { retries: 2 });
  assert.equal(calls, 3, 'one call plus two retries');
  assert.deepEqual(missing, [2]);
  assert.deepEqual(results.map(r => r.index).sort(), [0, 1]);
});

test('a throw on the retry keeps what the first pass returned', async () => {
  const { results, missing } = await completeBatch([0, 1], async (want) => {
    if (want.length === 1) throw new Error('boom');
    return [{ index: 0 }];
  });
  assert.deepEqual(results.map(r => r.index), [0], 'the good half survives');
  assert.deepEqual(missing, [1]);
});

test('a throw on the FIRST pass propagates — that is a real failure', async () => {
  await assert.rejects(
    () => completeBatch([0, 1], async () => { throw new Error('rate limited'); }),
    /rate limited/);
});

test('an index nobody asked for is not smuggled into the results', async () => {
  const { results } = await completeBatch([0, 1], async () => [
    { index: 0 }, { index: 1 }, { index: 99 },
  ]);
  assert.deepEqual(results.map(r => r.index).sort((a, b) => a - b), [0, 1]);
});

test('a duplicated index is not counted twice', async () => {
  const { results, missing } = await completeBatch([0, 1], async () => [
    { index: 0, fitness: 0.1 }, { index: 0, fitness: 0.9 }, { index: 1 },
  ]);
  assert.equal(results.length, 2);
  assert.deepEqual(missing, []);
});

test('retries default to one, so a bad batch cannot loop forever', async () => {
  let calls = 0;
  await completeBatch([0], async () => { calls++; return []; });
  assert.equal(calls, 2);
});
