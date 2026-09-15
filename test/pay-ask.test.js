import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../lib/fill.browser.js', import.meta.url), 'utf8');
const window = {};
new Function('window', src)(window);
const { salaryAsk } = window.__ashby._;

const ME = { salaryExpectation: 165000, hourlyRate: 150 };
const salaried = { employmentType: 'FullTime' };
const contract = { employmentType: 'Contract' };
const range = (min, max, interval = '1 YEAR', currency = 'USD') =>
  ({ salary: { min, max, interval, currency } });

// ---- the plain cases -----------------------------------------------------

test('a salaried role asks the stated expectation', () => {
  const a = salaryAsk('Salary expectations', ME, salaried);
  assert.deepEqual([a.value, a.unit], [165000, 'year']);
});

test('a contract role asks the hourly rate instead', () => {
  const a = salaryAsk('Salary expectations', ME, contract);
  assert.deepEqual([a.value, a.unit], [150, 'hour']);
});

test('a field asking explicitly for an hourly rate is hourly regardless', () => {
  const a = salaryAsk('Desired hourly rate', ME, salaried);
  assert.deepEqual([a.value, a.unit], [150, 'hour']);
});

test('a field asking explicitly for an annual figure is annual regardless', () => {
  const a = salaryAsk('Expected annual salary', ME, contract);
  assert.deepEqual([a.value, a.unit], [165000, 'year']);
});

// ---- the floor bump ------------------------------------------------------

test('a posting floor above the ask raises it slightly above the floor', () => {
  const a = salaryAsk('Salary expectations', ME, { ...salaried, ...range(205000, 300000) });
  assert.equal(a.unit, 'year');
  assert.ok(a.value > 205000, 'must clear the floor');
  assert.ok(a.value <= 220000, `should be slightly above, got ${a.value}`);
  assert.equal(a.bumped, true);
});

test('a posting floor below the ask leaves the ask alone', () => {
  const a = salaryAsk('Salary expectations', ME, { ...salaried, ...range(120000, 160000) });
  assert.equal(a.value, 165000);
  assert.ok(!a.bumped);
});

test('the bump lands on a round number, not a raw percentage', () => {
  const a = salaryAsk('Salary expectations', ME, { ...salaried, ...range(205000, 300000) });
  assert.equal(a.value % 1000, 0, `${a.value} should be a whole thousand`);
});

test('an hourly posting floor bumps the hourly ask', () => {
  const a = salaryAsk('Desired rate', ME, { ...contract, ...range(200, 250, '1 HOUR') });
  assert.equal(a.unit, 'hour');
  assert.ok(a.value > 200 && a.value <= 230, `got ${a.value}`);
  assert.equal(a.value % 5, 0, `${a.value} should be a round multiple of 5`);
});

test('an annual posting range converts before comparing to an hourly ask', () => {
  // $400k/yr is ~$192/hr, above the $150 ask, so the hourly ask must rise.
  const a = salaryAsk('Desired hourly rate', ME, { ...contract, ...range(400000, 500000) });
  assert.equal(a.unit, 'hour');
  assert.ok(a.value > 192, `should clear ~$192/hr, got ${a.value}`);
});

test('a range stating only a top has no floor to bump against', () => {
  const a = salaryAsk('Salary expectations', ME, { ...salaried, ...range(null, 300000) });
  assert.equal(a.value, 165000);
  assert.ok(!a.bumped);
});

test('a posting with no published range asks the stated expectation', () => {
  const a = salaryAsk('Salary expectations', ME, salaried);
  assert.equal(a.value, 165000);
});

test('a non-USD range is not bumped — that would mix currencies', () => {
  const a = salaryAsk('Salary expectations', ME, { ...salaried, ...range(200000, 260000, '1 YEAR', 'EUR') });
  assert.equal(a.value, 165000);
  assert.ok(!a.bumped);
});

// ---- which fields, and what happens without config -----------------------

test('matches the ways boards word this', () => {
  for (const label of ['Salary expectations', 'What are your salary expectations?',
    'Desired salary', 'Expected compensation', 'Compensation expectations',
    'Desired hourly rate', 'What is your expected base salary?', 'Rate expectations']) {
    assert.ok(salaryAsk(label, ME, salaried), `"${label}" should be a pay-expectation field`);
  }
});

test('does not fire on unrelated fields', () => {
  for (const label of ['Why do you want to work here?', 'Current employer',
    'Are you legally authorized to work in the United States?', 'Notice period',
    'How did you hear about us?', 'Gender Identity']) {
    assert.equal(salaryAsk(label, ME, salaried), null, `"${label}" must not be a pay field`);
  }
});

test('nothing configured means nothing filled', () => {
  assert.equal(salaryAsk('Salary expectations', {}, salaried), null);
  assert.equal(salaryAsk('Desired hourly rate', { salaryExpectation: 165000 }, contract), null);
});

// ---- the separation the user asked for -----------------------------------

test('the expectation is not a screening floor', () => {
  // A stated ask must never leak into the modules that decide what gets scored.
  for (const f of ['lib/select.js', 'lib/comp.js', 'lib/filters.js', 'bin/poll.js']) {
    const s = fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    assert.ok(!/salaryExpectation|hourlyRate/.test(s),
      `${f} must not read the pay expectation — it is an ask, not a floor`);
  }
});

// A posting that publishes its range per hour is an hourly engagement whatever its
// employmentType says — Intern, Temporary and PartTime all appear in the corpus with
// hourly ranges. Answering those in annual terms is the wrong shape of answer.
test('an hourly published range makes the ask hourly, whatever the employment type', () => {
  for (const employmentType of ['Intern', 'Temporary', 'PartTime', 'FullTime']) {
    const a = salaryAsk('Salary expectations', ME,
      { employmentType, salary: { min: 40, max: 55, interval: '1 HOUR', currency: 'USD' } });
    assert.equal(a.unit, 'hour', `${employmentType} with an hourly range should ask hourly`);
    assert.equal(a.value, 150);
  }
});

test('an annual published range still asks annually for a salaried role', () => {
  const a = salaryAsk('Salary expectations', ME,
    { employmentType: 'FullTime', salary: { min: 120000, max: 160000, interval: '1 YEAR', currency: 'USD' } });
  assert.equal(a.unit, 'year');
});
