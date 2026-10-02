// The self-identification matchers, usable from Node as well as from the page.
//
// fill.browser.js is written to run inside the browser, but two of its functions
// have to be callable from apply.js too: Greenhouse renders the demographic fields
// as react-select comboboxes that ignore synthesized pointer events, so the menu can
// only be opened by Playwright, from outside the page. That would ordinarily mean a
// second copy of the decline wording — and a second copy is how the safety property
// quietly stops being one property.
//
// So the real artifact is evaluated here with a stub window, exactly as
// test/eeo.test.js does it: its top level touches no DOM, so this works, and there
// is one DECLINE list with one set of tests behind it.
import fs from 'node:fs';

const src = fs.readFileSync(new URL('./fill.browser.js', import.meta.url), 'utf8');
const stub = {};
new Function('window', src)(stub);

/** Index of the option that explicitly declines, or -1 when none is offered. */
export const declineIndex = stub.__ashby._.declineIndex;

/** Is this label a gender / ethnicity / veteran / disability question? */
export const isDemographic = stub.__ashby._.isDemographic;

/**
 * Decline Greenhouse's self-identification fields, from outside the page.
 *
 * These are react-select comboboxes, and react-select does not respond to the
 * synthesized pointer events fill.browser.js dispatches in-page — verified against a
 * live form, where the menu stayed shut, every field reported "no decline option
 * offered", and the four questions were left blank. Only a trusted click opens them,
 * and only Playwright can produce one.
 *
 * The matcher is the shared one, so there is exactly one definition of what counts
 * as declining. It requires an explicit verb of declining, which is what stops it
 * selecting "I am not a protected veteran" or "No, I do not have a disability" —
 * both of which would be this tool asserting something about the candidate.
 *
 * A field offering no way to decline is closed again and left EMPTY. A gap is the
 * correct outcome there; it is never filled with the nearest thing.
 *
 * Fields are addressed by id, captured once, never by position. intl-tel-input
 * inserts its own <input role=combobox> ahead of them after the form is ready, and
 * a live `nth(i)` shifted by one mid-run: one question was visited twice and the
 * last never at all (Gametime United, 2026-09-25). Ids are attribute-selected
 * because Greenhouse's custom questions have numeric ones ("4009862008"), which are
 * not valid as `#id`.
 */
export async function declineDemographics(page) {
  const out = [];
  const ids = await page.locator('#application-form input.select__input[role=combobox]')
    .evaluateAll(els => els.map(e => e.id).filter(Boolean));

  for (const id of ids) {
    const combo = page.locator(`[id="${id}"]`);
    const label = (await page.locator(`label[for="${id}"]`).first().textContent()
      .catch(() => null))?.replace(/\s*\*\s*$/, '').trim() ?? '';
    if (!isDemographic(label)) continue;
    if ((await combo.inputValue().catch(() => '')).trim()) continue;
    // react-select shows a choice in .select__single-value (.select__multi-value on a
    // multi-select) and leaves the input empty.
    const chosen = await combo.evaluate(el => !!el.closest('.select__container')
      ?.querySelector('.select__single-value, .select__multi-value')).catch(() => false);
    if (chosen) continue;

    try {
      await combo.scrollIntoViewIfNeeded();
      const options = page.locator(`[id="react-select-${id}-listbox"] [role="option"]`);
      // The form is server-rendered, so it is on the page before React hydrates it,
      // and a click in that window does nothing — the first field on Gametime
      // United's form timed out this way every run. One retry covers it.
      let opened = false;
      for (let attempt = 0; attempt < 2 && !opened; attempt++) {
        await combo.click({ timeout: 5000 });
        opened = await options.first().waitFor({ state: 'visible', timeout: 2500 })
          .then(() => true, () => false);
        if (!opened) await page.keyboard.press('Escape');
      }
      if (!opened) throw new Error('menu did not open');
      const texts = await options.allTextContents();
      const k = declineIndex(texts.map(t => t.trim()));
      if (k < 0) {
        await page.keyboard.press('Escape');
        out.push({ label, ok: false, err: 'no decline option offered — left empty' });
        continue;
      }
      await options.nth(k).click({ timeout: 5000 });
      out.push({ label, ok: true, value: texts[k].trim() });
    } catch (e) {
      await page.keyboard.press('Escape').catch(() => {});
      out.push({ label, ok: false, err: String(e.message).split(String.fromCharCode(10))[0] });
    }
  }
  return out;
}
