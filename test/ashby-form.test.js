import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

// An Ashby form reduced to the shapes that left DailyPay's application mostly
// unfilled, 2026-09-25, run in a real browser against the real injected artifact.
//
// DailyPay asks its yes/no questions as CHECKBOX GROUPS — two boxes, "Yes" and "No",
// both of which can be ticked at once. Checkboxes are never ticked here because
// they are overwhelmingly consent, so all four required questions stayed empty. A
// group that is exactly Yes/No is a question, not an agreement — unless its label
// reads as consent, and then it is still never touched.
const box = (path, label, opts, { required = true } = {}) => `
  <div data-field-path="${path}"><fieldset class="ashby-application-form-input-checkbox-group">
    <label class="ashby-application-form-question-title${required ? ' _required_x_1' : ''}" for="${path}">${label}</label>
    ${opts.map((o, i) => `<div class="ashby-application-form-input-checkbox-group-option">
      <span class="ashby-application-form-input-checkbox-group-option-checkbox"><input type="checkbox" id="${path}-${i}" name="${o}"></span>
      <label for="${path}-${i}" class="ashby-application-form-input-checkbox-group-option-label">${o}</label></div>`).join('')}
  </fieldset></div>`;
const text = (path, label) => `
  <div data-field-path="${path}"><label class="ashby-application-form-question-title" for="${path}-in">${label}</label>
    <input class="ashby-application-form-input-text" id="${path}-in" type="text"></div>`;

const FORM = `<!doctype html><html><body>
  ${text('_systemfield_name', 'Name')}
  ${text('pref', 'What is Your Preferred Name?')}
  ${box('auth', 'Are you legally authorized to work in the United States?', ['Yes', 'No '])}
  ${box('spons', 'Will you now or in the future require sponsorship for employment visa status (e.g. H-1B visa status)?', ['Yes', 'No '])}
  ${text('visa', 'If yes, please note your current visa status')}
  ${box('noncomp', 'Are You Entered in Non-Compete or Solicitations Agreements with a Prior Employer?', ['Yes', 'No'])}
  ${box('arb', 'Do you agree to the arbitration agreement?', ['Yes', 'No'])}
  ${box('cert', 'I certify that the information provided is true', ['I agree'])}
  ${box('dis', 'Do you have a disability?', ['Yes', 'No'], { required: false })}
</body></html>`;

const FILL_SRC = fs.readFileSync(new URL('../lib/fill.browser.js', import.meta.url), 'utf8');
const ME = { name: 'TEST TESTERSON', firstName: 'TEST', needsSponsorship: 'no', authorizedToWork: 'yes', nonCompete: 'no' };

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function formPage() {
  const page = await browser.newPage();
  await page.setContent(FORM);
  await page.evaluate(FILL_SRC);
  await page.evaluate(me => window.__ashby.configure(me, {}), ME);
  return page;
}
const ticked = (page, path) => page.$$eval(`[data-field-path="${path}"] input[type=checkbox]`,
  bs => bs.filter(b => b.checked).map(b => b.name.trim()));

test('a Yes/No checkbox group is a yes/no question', async () => {
  const page = await formPage();
  const kinds = Object.fromEntries((await page.evaluate(() => window.__ashby.dumpLabels())).map(f => [f.path, f.kind]));
  assert.equal(kinds.auth, 'yesno');
  assert.equal(kinds.spons, 'yesno');
  await page.close();
});

test('the rules answer it by ticking exactly one box', async () => {
  const page = await formPage();
  const res = await page.evaluate(() => window.__ashby.fill());
  for (const p of ['auth', 'spons', 'noncomp']) {
    assert.equal(res.find(r => r.path === p)?.ok, true, `${p}: ${JSON.stringify(res.find(r => r.path === p))}`);
  }
  assert.deepEqual(await ticked(page, 'auth'), ['Yes']);
  assert.deepEqual(await ticked(page, 'spons'), ['No']);
  assert.deepEqual(await ticked(page, 'noncomp'), ['No']);
  await page.close();
});

test('a model yes/no step on one ticks one box, and switching unticks the other', async () => {
  const page = await formPage();
  await page.evaluate(() => window.__ashby.applyPlan([{ path: 'auth', action: 'yesno', value: 'no' }]));
  await page.evaluate(() => window.__ashby.applyPlan([{ path: 'auth', action: 'yesno', value: 'yes' }]));
  assert.deepEqual(await ticked(page, 'auth'), ['Yes']);
  await page.close();
});

test('consent worded as Yes/No is still never ticked', async () => {
  const page = await formPage();
  const kinds = Object.fromEntries((await page.evaluate(() => window.__ashby.dumpLabels())).map(f => [f.path, f.kind]));
  assert.equal(kinds.arb, 'checkbox');
  assert.equal(kinds.cert, 'checkbox');
  await page.evaluate(() => window.__ashby.fill());
  const res = await page.evaluate(() => window.__ashby.applyPlan([
    { path: 'arb', action: 'yesno', value: 'yes' },
    { path: 'cert', action: 'pick', value: 'I agree' },
  ]));
  assert.ok(res.every(r => r.skipped), JSON.stringify(res));
  assert.deepEqual(await ticked(page, 'arb'), []);
  assert.deepEqual(await ticked(page, 'cert'), []);
  await page.close();
});

test('self-identification worded as Yes/No is never answered', async () => {
  const page = await formPage();
  await page.evaluate(() => window.__ashby.fill());
  await page.evaluate(() => window.__ashby.applyPlan([{ path: 'dis', action: 'yesno', value: 'no' }]));
  assert.deepEqual(await ticked(page, 'dis'), []);
  await page.close();
});

test('a yes/no rule does not type into its "If yes, ..." follow-up', async () => {
  const page = await formPage();
  await page.evaluate(() => window.__ashby.fill());
  assert.equal(await page.inputValue('#visa-in'), '');
  await page.close();
});

test('"Preferred Name" is the first name, not a referral question', async () => {
  const page = await formPage();
  const res = await page.evaluate(() => window.__ashby.fill());
  assert.ok(!res.some(r => r.name === 'referral' && r.path === 'pref'), 'referral rule claimed it');
  assert.equal(await page.inputValue('#pref-in'), 'TEST');
  await page.close();
});
