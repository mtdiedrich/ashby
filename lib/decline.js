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
