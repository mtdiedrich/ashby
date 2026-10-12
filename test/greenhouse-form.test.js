import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { declineDemographics } from '../lib/decline.js';

// A Greenhouse form reduced to the shapes that broke apply.js on Gametime United's
// board, 2026-09-25, run in a real browser against the real injected artifact.
//
// Two things on that page are not on the forms fill.browser.js was written against:
//
//   intl-tel-input   wraps #phone, and puts its own country-search <input
//                    role=combobox> in the same entry, BEFORE #phone. It also keeps
//                    ~244 [role=option] countries in the DOM permanently, hidden.
//   yes/no questions are react-select comboboxes, not text or radios.
//
// The react-select here is a stand-in, not the library, but it behaves as the live
// one was measured to:
//   - it opens on a mousedown on the control or a click on its toggle button, and
//     NOT on typing — a synthesized input event sets the value and nothing opens;
//   - it portals a #react-select-<id>-listbox and names it in aria-controls;
//   - a choice shows as .select__single-value, or on a multi-select as
//     .select__multi-value carrying a "Remove selection" <button>, and the input is
//     left empty either way;
//   - the form is server-rendered, so the first click arrives before hydration and
//     is swallowed.
const FORM = `<!doctype html><html><body>
<form id="application-form">
  <div class="field-wrapper"><div class="text-input-wrapper"><div class="input-wrapper">
    <label for="first_name">First Name<span aria-hidden="true">*</span></label>
    <input id="first_name" type="text" aria-required="true"></div></div></div>

  <fieldset class="phone-input">
    <div class="phone-input__country"><div class="select"><div class="select__container">
      <label for="country">Country<span aria-hidden="true">*</span></label>
      <div class="select__control"><input id="country" class="select__input" role="combobox" type="text" aria-required="true"></div>
    </div></div></div>
    <div class="phone-input__phone"><div class="text-input-wrapper"><div class="input-wrapper">
      <label for="phone">Phone<span aria-hidden="true">*</span></label>
      <div class="iti">
        <div class="iti__country-container">
          <button type="button" class="iti__selected-country"></button>
          <div class="iti__dropdown-content iti__hide" style="display:none">
            <input id="iti-0__search-input" type="search" class="iti__search-input" role="combobox">
            <ul class="iti__country-list" role="listbox">
              <li role="option">Afghanistan+93</li><li role="option">Yemen+967</li>
              <li role="option">Norway+47</li><li role="option">United States+1</li>
            </ul>
          </div>
        </div>
        <input id="phone" type="tel" aria-required="true">
      </div>
    </div></div></div>
  </fieldset>

  <div class="select__container">
    <label for="q_states">Do you currently reside in any of the following states?</label>
    <div class="select__control"><input id="q_states" class="select__input" role="combobox"></div></div>
  <div class="select__container">
    <label for="q_auth">Are you legally authorized to work in United States?</label>
    <div class="select__control"><input id="q_auth" class="select__input" role="combobox">
      <div class="select__indicators"><button type="button" aria-label="Toggle flyout">v</button></div></div></div>
  <div class="select__container" data-multi="1">
    <label for="4009864008">How would you describe your sexual orientation?</label>
    <div class="select__control"><input id="4009864008" class="select__input" role="combobox">
      <div class="select__indicators"><button type="button" aria-label="Toggle flyout">v</button></div></div></div>
  <div class="select__container">
    <label for="gender">Gender</label>
    <div class="select__control"><input id="gender" class="select__input" role="combobox"></div></div>
  <div class="select__container">
    <label for="veteran_status">Veteran Status</label>
    <div class="select__control"><input id="veteran_status" class="select__input" role="combobox"></div></div>
</form>
<script>
  const OPTS = {
    country: ['Canada +1', 'United States +1'],
    q_states: ['California', 'New York', 'None of the above'],
    q_auth: ['Yes', 'No'],
    '4009864008': ['Heterosexual', 'Gay', "I don't wish to answer"],
    gender: ['Male', 'Female', 'Decline To Self Identify'],
    veteran_status: ['I am not a protected veteran', "I don't wish to answer"],
  };
  const lbId = i => 'react-select-' + i.id + '-listbox';
  function close(i) { document.getElementById(lbId(i))?.remove(); i.removeAttribute('aria-controls'); }
  function open(i, q = '') {
    close(i);
    const lb = document.createElement('div');
    lb.id = lbId(i); lb.setAttribute('role', 'listbox');
    for (const t of OPTS[i.id].filter(t => t.toLowerCase().includes(q.toLowerCase()))) {
      const o = document.createElement('div');
      o.setAttribute('role', 'option'); o.textContent = t;
      o.addEventListener('click', () => choose(i, t));
      lb.append(o);
    }
    i.closest('.select__container').append(lb);
    i.setAttribute('aria-controls', lb.id);
  }
  function choose(i, t) {
    close(i);
    const c = i.closest('.select__container');
    if (c.dataset.multi) {
      const mv = document.createElement('div');
      mv.className = 'select__multi-value';
      mv.innerHTML = '<div class="select__multi-value__label"></div>' +
        '<div role="button" class="select__multi-value__remove"><button type="button" aria-label="Remove selection">x</button></div>';
      mv.firstChild.textContent = t;
      mv.querySelector('button').addEventListener('click', () => mv.remove());
      i.before(mv);
    } else {
      let sv = c.querySelector('.select__single-value');
      if (!sv) { sv = document.createElement('div'); sv.className = 'select__single-value'; i.parentElement.before(sv); }
      sv.textContent = t;
    }
    i.value = '';
    window.__chosen = (window.__chosen || []).concat(i.id);
    // intl-tel-input initialises late and inserts its search box ahead of everything
    // else. Simulated at the first choice, i.e. mid-way through a pass.
    if (window.__lateWidget && !document.getElementById('late-combo')) {
      const x = document.createElement('input');
      x.id = 'late-combo'; x.setAttribute('role', 'combobox'); x.className = 'iti__search-input';
      document.getElementById('application-form').prepend(x);
    }
  }
  document.addEventListener('mousedown', e => {
    if (window.__hydrating) { window.__hydrating = false; return; }
    const c = e.target.closest && e.target.closest('.select__control');
    if (c && !e.target.closest('button, [role=option]')) open(c.querySelector('input.select__input'));
  });
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('.select__indicators button');
    if (b) open(b.closest('.select__container').querySelector('input.select__input'));
  });
  // Typing filters a menu that is already open; it never opens one.
  document.addEventListener('input', e => {
    if (e.target.matches('input.select__input') && e.target.getAttribute('aria-controls')) open(e.target, e.target.value);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && e.target.matches && e.target.matches('input.select__input')) close(e.target);
  });
</script></body></html>`;

const FILL_SRC = fs.readFileSync(new URL('../lib/fill.browser.js', import.meta.url), 'utf8');
const ME = { firstName: 'TEST', phone: '+1 555 0100', authorizedToWork: 'yes' };

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

test('the phone entry is #phone, not intl-tel-input\'s country search', async () => {
  const page = await formPage();
  const fields = await page.evaluate(() => window.__ashby.dumpLabels());
  const phone = fields.find(f => f.label === 'Phone');
  assert.equal(phone.path, 'phone');
  assert.equal(phone.kind, 'text');
  assert.ok(!fields.some(f => /^iti-/.test(f.path)), 'the widget\'s own search box is not a field');
  await page.close();
});

test('the phone number is typed into #phone', async () => {
  const page = await formPage();
  const res = await page.evaluate(() => window.__ashby.fill());
  assert.equal(res.find(r => r.name === 'phone')?.ok, true);
  assert.equal(await page.inputValue('#phone'), '+1 555 0100');
  assert.equal(await page.inputValue('#iti-0__search-input'), '', 'nothing typed into the country search');
  await page.close();
});

test('a combobox offers its own options, not the hidden country list', async () => {
  const page = await formPage();
  const pending = await page.evaluate(() => window.__ashby.pending());
  const states = pending.find(f => f.path === 'q_states');
  assert.deepEqual(states.options, ['California', 'New York', 'None of the above']);
  for (const f of pending) {
    assert.ok(!(f.options ?? []).some(o => /Afghanistan/.test(o)), `${f.path} was offered the phone's country list`);
  }
  await page.close();
});

test('a yes/no react-select is answered by selecting the option', async () => {
  const page = await formPage();
  const res = await page.evaluate(() => window.__ashby.fill());
  const r = res.find(x => x.name === 'legally authorized');
  assert.equal(r?.ok, true, r?.err);
  assert.equal(await page.textContent('#q_auth >> xpath=ancestor::div[contains(@class,"select__container")]//div[contains(@class,"select__single-value")]'), 'Yes');
  await page.close();
});

test('the decline pass reaches every field when a combobox appears mid-run', async () => {
  const page = await formPage();
  await page.evaluate(() => { window.__lateWidget = true; });
  const out = await declineDemographics(page);
  assert.deepEqual(out.map(d => d.label).sort(),
    ['Gender', 'How would you describe your sexual orientation?', 'Veteran Status']);
  assert.ok(out.every(d => d.ok), JSON.stringify(out));
  const chosen = await page.evaluate(() => window.__chosen);
  assert.deepEqual(chosen.sort(), ['4009864008', 'gender', 'veteran_status'], 'each declined exactly once');
  assert.deepEqual(out.map(d => d.value).sort(),
    ['Decline To Self Identify', "I don't wish to answer", "I don't wish to answer"]);
  await page.close();
});

test('the first click, swallowed before hydration, is retried', async () => {
  const page = await formPage();
  await page.evaluate(() => { window.__hydrating = true; });
  const out = await declineDemographics(page);
  assert.ok(out.length === 3 && out.every(d => d.ok), JSON.stringify(out));
  await page.close();
});

// A multi-select holding a choice has a "Remove selection" <button> inside it. The
// rule pass read it as empty, "probed" it by clicking the first <button> it found,
// and deleted the decline the Playwright pass had just made.
test('a declined multi-select is left alone by the rule pass', async () => {
  const page = await formPage();
  await declineDemographics(page);
  const res = await page.evaluate(() => window.__ashby.fill());
  assert.ok(!res.some(r => r.path === '4009864008'), 'rule pass touched it: ' + JSON.stringify(res));
  assert.equal(await page.textContent('.select__multi-value__label'), "I don't wish to answer");
  const pending = await page.evaluate(() => window.__ashby.pending());
  assert.ok(!pending.some(f => f.path === '4009864008'));
  await page.close();
});
