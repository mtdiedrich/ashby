import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, eta } from '../lib/progress.js';

test('bar is empty at the start and full at the end', () => {
  assert.match(render({ done: 0, total: 10, width: 10 }), /\[ {10}\]/);
  assert.match(render({ done: 10, total: 10, width: 10 }), /\[█{10}\]/);
});

test('bar fills proportionally', () => {
  const half = render({ done: 5, total: 10, width: 10 });
  assert.match(half, /\[█{5} {5}\]/);
});

test('shows count and percentage', () => {
  const s = render({ done: 3, total: 12, width: 8 });
  assert.match(s, /3\/12/);
  assert.match(s, /25%/);
});

test('a label is included when given', () => {
  assert.match(render({ done: 1, total: 2, width: 4, label: 'judging' }), /judging/);
});

test('total of zero does not divide by zero or render NaN', () => {
  const s = render({ done: 0, total: 0, width: 6 });
  assert.doesNotMatch(s, /NaN|Infinity/);
});

test('done never exceeds total, even if over-ticked', () => {
  const s = render({ done: 99, total: 10, width: 10 });
  assert.match(s, /\[█{10}\]/);
  assert.doesNotMatch(s, /█{11}/);
});

test('eta is blank until there is something to extrapolate from', () => {
  assert.equal(eta(0, 10, 5000), '');
});

test('eta estimates from the rate so far', () => {
  // 2 of 10 in 4s -> 2s each -> 16s left
  assert.match(eta(2, 10, 4000), /16s/);
});

test('eta switches to minutes when it is long', () => {
  // 1 of 100 in 10s -> 10s each -> 990s left
  assert.match(eta(1, 100, 10_000), /m/);
});

test('eta is blank once finished', () => {
  assert.equal(eta(10, 10, 5000), '');
});
