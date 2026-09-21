import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byValue } from '../lib/board-row.js';

// The server sorted by fitness and sliced the top 600; the page then sorted what it
// got by `value`. Every posting under two days old scored below the fitness cutoff
// (0.32) and was never sent — so the board's freshest row was two days old while
// seven newer ones sat on disk. A slice on one ordering cannot serve a view ordered
// by another.

const row = (o) => ({ value: null, fitness: null, similarity: null, ...o });

test('orders by value, descending — the column the board actually sorts on', () => {
  const rows = [row({ value: 0.2 }), row({ value: 0.9 }), row({ value: 0.5 })];
  assert.deepEqual(rows.sort(byValue).map(r => r.value), [0.9, 0.5, 0.2]);
});

test('a fresh low-fitness posting outranks a stale high-fitness one when value says so', () => {
  const fresh = row({ value: 0.77, fitness: 0.20 });
  const stale = row({ value: 0.60, fitness: 0.85 });
  assert.deepEqual([stale, fresh].sort(byValue), [fresh, stale],
    'sorting by fitness is what hid the fresh postings');
});

test('rows without a value fall to the back, not the front', () => {
  const rows = [row({ value: null }), row({ value: 0.1 }), row({ value: null }), row({ value: 0.8 })];
  const sorted = rows.sort(byValue);
  assert.deepEqual(sorted.slice(0, 2).map(r => r.value), [0.8, 0.1]);
  assert.equal(sorted[2].value, null);
});

test('among rows with no value, fitness then similarity decide', () => {
  const rows = [
    row({ value: null, fitness: null, similarity: 0.4 }),
    row({ value: null, fitness: 0.7 }),
    row({ value: null, fitness: null, similarity: 0.9 }),
  ];
  const sorted = rows.sort(byValue);
  assert.equal(sorted[0].fitness, 0.7, 'a judged posting beats an unjudged one');
  assert.equal(sorted[1].similarity, 0.9);
});

test('a zero value is not treated as missing', () => {
  const sorted = [row({ value: null }), row({ value: 0 })].sort(byValue);
  assert.equal(sorted[0].value, 0, '0 is a computed value; null is not');
});

test('the comparator is stable enough to be transitive on equal values', () => {
  const rows = [row({ value: 0.5, fitness: 0.1 }), row({ value: 0.5, fitness: 0.9 })];
  const sorted = [...rows].sort(byValue);
  assert.equal(sorted[0].fitness, 0.9, 'ties fall through to fitness');
});
