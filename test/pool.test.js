import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../lib/pool.js';

const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));

test('results come back in input order, not completion order', async () => {
  // Later items finish first, so a naive push-on-complete would scramble these.
  const out = await pool([50, 30, 10, 1], async n => { await tick(n); return n; }, { limit: 4 });
  assert.deepEqual(out.map(r => r.value), [50, 30, 10, 1]);
});

test('never runs more than the limit at once', async () => {
  let active = 0, peak = 0;
  await pool([...Array(30).keys()], async () => {
    peak = Math.max(peak, ++active);
    await tick(5);
    active--;
  }, { limit: 4 });
  assert.equal(peak, 4, `peak concurrency was ${peak}`);
});

test('actually runs concurrently', async () => {
  const started = Date.now();
  await pool([...Array(12).keys()], () => tick(40), { limit: 6 });
  const ms = Date.now() - started;
  assert.ok(ms < 300, `12 x 40ms at 6 wide should take ~80ms, took ${ms}ms`);
});

test('one failure does not abort the rest', async () => {
  const out = await pool([1, 2, 3, 4], async n => {
    if (n === 2) throw new Error('boom');
    return n * 10;
  }, { limit: 2 });
  assert.deepEqual(out.map(r => r.ok), [true, false, true, true]);
  assert.equal(out[1].error.message, 'boom');
  assert.deepEqual(out.filter(r => r.ok).map(r => r.value), [10, 30, 40]);
});

test('reports progress once per completed item', async () => {
  let n = 0;
  await pool([...Array(9).keys()], () => tick(2), { limit: 3, onDone: () => n++ });
  assert.equal(n, 9);
});

test('an empty list is not an error', async () => {
  assert.deepEqual(await pool([], async () => 1, { limit: 4 }), []);
});

test('limit 1 is sequential', async () => {
  const order = [];
  await pool([30, 20, 10], async n => { await tick(n); order.push(n); }, { limit: 1 });
  assert.deepEqual(order, [30, 20, 10]);
});

// The prompt cache is written by the first call and read by the rest. Firing the
// whole first wave at once means every one of them misses, and each pays the
// cache-WRITE premium instead of one paying it and the rest reading cheaply.
test('warmup runs the first item alone before opening up', async () => {
  let active = 0;
  const peakDuringFirst = [];
  await pool([...Array(10).keys()], async i => {
    active++;
    if (i === 0) { await tick(30); peakDuringFirst.push(active); }
    else await tick(5);
    active--;
  }, { limit: 5, warmup: true });
  assert.deepEqual(peakDuringFirst, [1], 'the first item must run on its own');
});

test('warmup still returns every result in order', async () => {
  const out = await pool([1, 2, 3, 4, 5], async n => n * 2, { limit: 3, warmup: true });
  assert.deepEqual(out.map(r => r.value), [2, 4, 6, 8, 10]);
});

test('a failed warmup does not sink the run', async () => {
  const out = await pool([1, 2, 3], async n => {
    if (n === 1) throw new Error('cold');
    return n;
  }, { limit: 2, warmup: true });
  assert.equal(out[0].ok, false);
  assert.deepEqual(out.slice(1).map(r => r.value), [2, 3]);
});

// ---- --jobs / ASHBY_JOBS -------------------------------------------------

import { jobsFlag } from '../lib/pool.js';

test('--jobs N wins, then ASHBY_JOBS, then the default', () => {
  const prev = process.env.ASHBY_JOBS;
  try {
    delete process.env.ASHBY_JOBS;
    assert.equal(jobsFlag(['--jobs', '12']), 12);
    assert.equal(jobsFlag([]), 6);
    process.env.ASHBY_JOBS = '3';
    assert.equal(jobsFlag([]), 3);
    assert.equal(jobsFlag(['--jobs', '10']), 10, '--jobs overrides the env');
  } finally {
    if (prev === undefined) delete process.env.ASHBY_JOBS; else process.env.ASHBY_JOBS = prev;
  }
});

test('nonsense concurrency falls back rather than hanging or stampeding', () => {
  const prev = process.env.ASHBY_JOBS;
  try {
    delete process.env.ASHBY_JOBS;
    for (const bad of ['0', '-4', 'lots', '', undefined]) {
      assert.equal(jobsFlag(['--jobs', bad]), 6, `--jobs ${bad} should fall back`);
    }
    assert.equal(jobsFlag(['--jobs', '2.7']), 2, 'a fraction floors');
  } finally {
    if (prev === undefined) delete process.env.ASHBY_JOBS; else process.env.ASHBY_JOBS = prev;
  }
});

// ---- aborting a doomed run -----------------------------------------------

import { isAuthError } from '../lib/keys.js';

test('stopOn halts the run instead of repeating a doomed call', async () => {
  let calls = 0;
  const out = await pool([...Array(50).keys()], async (i) => {
    calls++;
    if (i >= 2) { const e = new Error('401 invalid x-api-key'); e.status = 401; throw e; }
    return i;
  }, { limit: 4, stopOn: isAuthError });

  assert.ok(calls < 50, `should have stopped early, made ${calls} of 50 calls`);
  assert.deepEqual(out.slice(0, 2).map(r => r.value), [0, 1], 'work already done is kept');
  assert.ok(out.some(r => !r.ok), 'the failure is recorded');
});

test('stopOn reports why it stopped', async () => {
  const out = await pool([0, 1, 2], async () => {
    const e = new Error('401 invalid x-api-key'); e.status = 401; throw e;
  }, { limit: 1, stopOn: isAuthError });
  assert.equal(out.stopped?.message, '401 invalid x-api-key');
});

test('an ordinary failure does not stop anything', async () => {
  let calls = 0;
  const out = await pool([...Array(10).keys()], async (i) => {
    calls++;
    if (i === 3) throw new Error('structured output failed to parse');
    return i;
  }, { limit: 2, stopOn: isAuthError });
  assert.equal(calls, 10, 'every item should still be attempted');
  assert.equal(out.filter(r => r.ok).length, 9);
  assert.equal(out.stopped, undefined);
});

test('without stopOn the behaviour is exactly as before', async () => {
  let calls = 0;
  await pool([...Array(8).keys()], async () => {
    calls++;
    const e = new Error('401'); e.status = 401; throw e;
  }, { limit: 2 });
  assert.equal(calls, 8);
});
