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

// ---- Greenhouse, read off a live job-boards.greenhouse.io form 2026-09-21 ----
//
// The same safety property has to hold on a second ATS, and Greenhouse words every
// one of these differently from Ashby. Captured verbatim from Figma's board, which
// renders the US voluntary self-identification block as react-select comboboxes
// with stable ids (gender, hispanic_ethnicity, veteran_status, disability_status).
//
// The veteran set is the dangerous one: the assertive answer "I am not a protected
// veteran" is the FIRST option, so anything that falls back to index 0, or matches a
// bare /not/, asserts the candidate's veteran status on their behalf.

test('greenhouse gender: Decline To Self Identify', () => {
  assert.equal(idx('Male', 'Female', 'Decline To Self Identify'), 2);
});

test('greenhouse veteran: the decline is last, the assertion is first', () => {
  const opts = [
    'I am not a protected veteran',
    'I identify as one or more of the classifications of a protected veteran',
    "I don't wish to answer",
  ];
  assert.equal(idx(...opts), 2);
  assert.notEqual(idx(...opts), 0, 'must never assert "I am not a protected veteran"');
});

test('greenhouse disability: "I do not want to answer", not "No, I do not have a disability"', () => {
  const opts = [
    'Yes, I have a disability, or have had one in the past',
    'No, I do not have a disability and have not had one in the past',
    'I do not want to answer',
  ];
  assert.equal(idx(...opts), 2);
  assert.notEqual(idx(...opts), 1, 'must never assert the absence of a disability');
});

test('greenhouse hispanic/latino: a bare No is not a decline', () => {
  assert.equal(idx('Yes', 'No', 'Decline To Self Identify'), 2);
});

test('greenhouse demographic labels are recognised as demographic', () => {
  for (const label of ['Gender', 'Are you Hispanic/Latino?', 'Veteran Status', 'Disability Status']) {
    assert.equal(isDemographic(label), true, `should be demographic: ${label}`);
  }
});

test('greenhouse non-demographic questions on the same form are not', () => {
  for (const label of [
    'Are you authorized to work in the country for which you applied? *',
    'Have you ever worked for Figma before, as an employee or a contractor/consultant?',
    'Where did you hear about this job?*',
    'Why do you want to join Figma?*',
    'Preferred First Name',
  ]) {
    assert.equal(isDemographic(label), false, `should NOT be demographic: ${label}`);
  }
});

// ---- the model is never offered a self-identification field --------------
//
// Until now this held by accident rather than by construction. fillDecline() always
// succeeded on Ashby, because a radio group carries its options in the DOM, so a
// demographic field was never still empty by the time pending() ran. On Greenhouse
// the same fields are react-select comboboxes whose options do not exist until the
// menu is opened; the decline failed, the field stayed empty, and it went to the
// model — which could have answered "Male" or "I am not a protected veteran".
//
// fillDecline() is the ONLY thing allowed to touch these, and it can only ever
// select an option that says decline. Everything else leaves them empty, because a
// gap is better than an answer the candidate did not choose. Enforced in two
// places, so a failure in one is not a failure of the property.
const fillSrc = fs.readFileSync(new URL('../lib/fill.browser.js', import.meta.url), 'utf8');

const bodyOf = (name) => {
  const start = fillSrc.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name} not found in fill.browser.js`);
  const end = fillSrc.indexOf('\n  }', start);
  return fillSrc.slice(start, end);
};

test('pending() withholds self-identification fields from the model', () => {
  assert.match(bodyOf('pending'), /isDemographic\(/,
    'pending() must consult isDemographic before describing a field for the model');
});

test('applyPlan() refuses to act on a self-identification field', () => {
  assert.match(bodyOf('applyPlan'), /isDemographic\(/,
    'applyPlan() must refuse a demographic step whatever the model asked for');
});

test('the decline matcher still rejects every assertive answer it has ever seen', () => {
  // One consolidated guard over both boards' wording, so a future edit to DECLINE
  // cannot quietly start asserting on the candidate's behalf.
  const assertive = [
    'I am not a protected veteran',
    'I am not a protected Veteran',
    'I identify as one or more of the classifications of a protected veteran',
    'No, I do not have a disability and have not had one in the past',
    'Yes, I have a disability, or have had one in the past',
    'Male', 'Female', 'Man', 'Woman', 'White', 'Multiracial', 'Yes', 'No',
  ];
  for (const a of assertive) {
    assert.equal(idx(a), -1, `must not treat as a decline: ${a}`);
  }
});

// ---- one matcher, two call sites ----------------------------------------
//
// Greenhouse's demographic comboboxes ignore the synthesized pointer events
// fill.browser.js dispatches in-page — verified against a live form, where the
// menu never opened and every field reported "no decline option offered". Only
// Playwright's trusted click opens them, which puts that one interaction outside
// the page. lib/decline.js re-exports the real artifact's matchers rather than
// letting a second list of decline wording exist.
test('lib/decline.js exposes the same matcher the page uses', async () => {
  const { declineIndex: nodeSide, isDemographic: nodeDemo } = await import('../lib/decline.js');
  assert.equal(nodeSide('Male', 'Female', 'Decline To Self Identify') === undefined, false);
  assert.equal(nodeSide(['Male', 'Female', 'Decline To Self Identify']), 2);
  assert.equal(nodeSide(['I am not a protected veteran', "I don't wish to answer"]), 1);
  assert.equal(nodeDemo('Veteran Status'), true);
  assert.equal(nodeDemo('Where did you hear about this job?'), false);
});

test('apply.js declines through the shared matcher, not its own word list', () => {
  const applySrc = fs.readFileSync(new URL('../bin/apply.js', import.meta.url), 'utf8');
  assert.match(applySrc, /from '\.\.\/lib\/decline\.js'/,
    'apply.js must import the shared matcher');
  assert.doesNotMatch(applySrc, /decline to self identify/i,
    'apply.js must not carry its own copy of the decline wording');
});
