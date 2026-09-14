import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalise, dot, mean, centre, encode, decode } from '../lib/vec.js';

const close = (a, b, eps = 1e-5) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('normalise gives a unit vector', () => {
  const v = normalise([3, 4, 0, 0]);
  close(v[0], 0.6); close(v[1], 0.8);
  close(dot(v, v), 1);
});

test('dot of identical unit vectors is 1, orthogonal is 0', () => {
  const a = normalise([1, 0]), b = normalise([0, 1]);
  close(dot(a, a), 1);
  close(dot(a, b), 0);
});

test('base64 round-trips a float32 vector', () => {
  const v = normalise([0.1, -0.2, 0.3, 0.4]);
  const back = decode(encode(v));
  assert.equal(back.length, v.length);
  for (let i = 0; i < v.length; i++) close(back[i], v[i]);
});

test('mean averages componentwise', () => {
  const m = mean([new Float32Array([0, 2]), new Float32Array([2, 4])]);
  close(m[0], 1); close(m[1], 3);
});

test('mean of nothing is null', () => {
  assert.equal(mean([]), null);
});

test('centring removes the shared direction', () => {
  // Three vectors that all lean the same way plus a little of their own.
  const raw = [[10, 1, 0], [10, 0, 1], [10, 1, 1]].map(v => normalise(v));
  const mu = mean(raw);
  const rawSpread = Math.max(...raw.map(a => dot(raw[0], a))) - Math.min(...raw.map(a => dot(raw[0], a)));
  const cen = raw.map(v => centre(v, mu));
  const cenSpread = Math.max(...cen.map(a => dot(cen[0], a))) - Math.min(...cen.map(a => dot(cen[0], a)));
  assert.ok(cenSpread > rawSpread,
    `centring should spread similarities apart (raw ${rawSpread.toFixed(3)} -> centred ${cenSpread.toFixed(3)})`);
});

test('centre with no mean is a no-op', () => {
  const v = normalise([1, 2, 3]);
  assert.deepEqual(Array.from(centre(v, null)), Array.from(v));
});
