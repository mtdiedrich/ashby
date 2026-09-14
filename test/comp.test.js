import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salaryOf, payPasses } from '../lib/comp.js';
import { posting, comp } from './helpers.js';

test('salaryOf returns null when no compensation is published', () => {
  assert.equal(salaryOf(posting({ compensation: null })), null);
  assert.equal(salaryOf(posting({ compensation: { summaryComponents: [], compensationTiers: [] } })), null);
});

test('salaryOf reads summaryComponents, not the tier summary string', () => {
  const s = salaryOf(posting({ compensation: comp(150000, 250000) }));
  assert.equal(s.min, 150000);
  assert.equal(s.max, 250000);
  assert.equal(s.annualUsdMax, 250000);
});

test('hourly pay is annualised at 2080 hours', () => {
  const s = salaryOf(posting({ compensation: comp(60, 100, { interval: '1 HOUR' }) }));
  assert.equal(s.annualUsdMin, 124800);
  assert.equal(s.annualUsdMax, 208000);
});

test('monthly pay is annualised at 12 months', () => {
  const s = salaryOf(posting({ compensation: comp(10000, 20000, { interval: '1 MONTH' }) }));
  assert.equal(s.annualUsdMax, 240000);
});

test('non-USD is converted before comparison', () => {
  const s = salaryOf(posting({ compensation: comp(100000, 200000, { currency: 'GBP' }) }));
  assert.ok(s.annualUsdMax > 200000, 'GBP should convert upward');
});

test('unknown currency reports the raw numbers but no USD comparison', () => {
  const s = salaryOf(posting({ compensation: comp(100, 200, { currency: 'XYZ' }) }));
  assert.equal(s.max, 200);
  assert.equal(s.annualUsdMax, null);
});

test('payPasses lets unstated pay through, and says it is unknown', () => {
  const r = payPasses(posting({ compensation: null }), 150000);
  assert.equal(r.pass, true);
  assert.equal(r.known, false);
});

test('payPasses compares against the top of a stated range', () => {
  // $120k-$180k against a $150k floor: the top clears, so it passes.
  const r = payPasses(posting({ compensation: comp(120000, 180000) }), 150000);
  assert.equal(r.pass, true);
  assert.equal(r.known, true);
});

test('payPasses rejects when even the top of the range is below the floor', () => {
  const r = payPasses(posting({ compensation: comp(80000, 120000) }), 150000);
  assert.equal(r.pass, false);
});

test('a floor of 0 never rejects', () => {
  assert.equal(payPasses(posting({ compensation: comp(10, 20) }), 0).pass, true);
});
