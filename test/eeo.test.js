import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Exercises the real injected artifact rather than a copy of it: fill.browser.js is
// evaluated the same way apply.js evaluates it, with a stub window. Its top level
// touches no DOM, so this works and cannot drift from what the page actually runs.
const src = fs.readFileSync(new URL('../lib/fill.browser.js', import.meta.url), 'utf8');
const window = {};
new Function('window', src)(window);
const { declineIndex, isDemographic } = window.__ashby._;

const idx = (...opts) => declineIndex(opts);

// ---- the real option sets, read off live boards --------------------------

test('gender: picks the decline option', () => {
  const opts = ['Man', 'Woman', 'Non-Binary, Non-Conforming', 'Decline to Self Identify'];
  assert.equal(idx(...opts), 3);
});

test('ethnicity: picks the decline option out of a long list', () => {
  const opts = ['African American or Black', 'East Asian (Chinese, Japanese, Korean or Mongolian)',
    'Hispanic, Latinx or Spanish', 'Multiracial', 'White', 'Decline to Self Identify'];
  assert.equal(idx(...opts), 5);
});

test('veteran: "I don\'t wish to answer", not "I am not a protected Veteran"', () => {
  const opts = ['I am not a  protected Veteran',
    'I identify as one or more of the classifications of a protected veteran',
    "I don't wish to answer"];
  assert.equal(idx(...opts), 2);
});

test('disability: "I don\'t want to answer", not "No, I do not have a disability"', () => {
  const opts = ['Yes, I have a disability, or have had one in the past',
    'No, I do not have a disability and have not had one in the past',
    "I don't want to answer"];
  assert.equal(idx(...opts), 2);
});

test('the long federal veteran wording', () => {
  const opts = ['I IDENTIFY AS ONE OR MORE OF THE CLASSIFICATIONS OF A PROTECTED VETERAN',
    'I AM NOT A PROTECTED VETERAN',
    'I DECLINE TO SELF-IDENTIFY FOR PROTECTED VETERAN STATUS'];
  assert.equal(idx(...opts), 2);
});

// ---- the phrasings boards actually use -----------------------------------

for (const phrase of [
  'Decline to Self Identify', 'Decline to self-identify', 'I decline to answer',
  'I decline to self-identify for protected veteran status',
  "I don't wish to answer", "I don't want to answer", 'I do not want to answer',
  'I prefer not to answer', 'Prefer not to say', 'Prefer not to disclose',
  'I choose not to self-identify', 'I do not wish to disclose',
  'Decline to state', 'I would rather not say',
]) {
  test(`decline phrasing: "${phrase}"`, () => {
    assert.equal(idx('Some Real Answer', phrase), 1, `should have matched "${phrase}"`);
  });
}

// ---- the part that matters: never a substantive answer -------------------

test('a substantive answer is never read as a decline', () => {
  for (const opt of [
    'I am not a protected Veteran',
    'No, I do not have a disability and have not had one in the past',
    'Non-Binary, Non-Conforming',
    'No',
    'White',
    'Not Hispanic or Latino',
    'I am not Hispanic or Latino',
    'No, I am not a veteran',
    'I have not served in the military',
  ]) {
    assert.equal(declineIndex([opt]), -1, `"${opt}" must not count as declining`);
  }
});

test('no decline option present means do nothing', () => {
  assert.equal(idx('Yes', 'No'), -1);
  assert.equal(declineIndex([]), -1);
  assert.equal(declineIndex(null), -1);
});

// ---- which fields this applies to ----------------------------------------

test('recognises the self-identification questions', () => {
  for (const label of ['Gender', 'Gender Identity', 'Ethnicity', 'Race', 'Race/Ethnicity',
    'Veteran Status', 'Protected Veteran Status', 'Disability', 'Disability Status',
    'Voluntary Self-Identification of Disability', 'Hispanic/Latino']) {
    assert.equal(isDemographic(label), true, `"${label}" should be demographic`);
  }
});

test('does not treat consent or eligibility questions as demographic', () => {
  for (const label of [
    'I agree to the arbitration agreement',
    'I certify that the answers given by me are true and complete',
    'Do you require visa sponsorship?',
    'Are you legally authorized to work in the United States?',
    'Have you ever worked for this company?',
    'Are you at least 18 years of age?',
    'How did you hear about us?',
    'Why do you want to work here?',
    'Are you willing to relocate?',
  ]) {
    assert.equal(isDemographic(label), false, `"${label}" must not be demographic`);
  }
});
