import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../lib/fill.browser.js', import.meta.url), 'utf8');
const window = {};
new Function('window', src)(window);
const { mailingAddress, isAddressField, isPostalField } = window.__ashby._;

const ME = { street: '212 W Jayne St', postalCode: '52755', location: 'Lone Tree, Iowa' };

// Scanned 178 live application forms: address fields appear on about 1% of them, both
// real ones were TEXTAREAS asking for a whole mailing address, and not one form had a
// separate zip field. So the stored street and postcode have to compose.

test('composes the whole mailing address from the parts', () => {
  const a = mailingAddress(ME, { multiline: false });
  assert.match(a, /212 W Jayne St/);
  assert.match(a, /Lone Tree, Iowa/);
  assert.match(a, /52755/);
});

test('a textarea gets it over lines, a text input on one line', () => {
  assert.equal(mailingAddress(ME, { multiline: true }), '212 W Jayne St\nLone Tree, Iowa 52755');
  assert.equal(mailingAddress(ME, { multiline: false }), '212 W Jayne St, Lone Tree, Iowa 52755');
});

test('the postcode sits with the city, not on its own line', () => {
  assert.match(mailingAddress(ME, { multiline: true }), /Lone Tree, Iowa 52755$/);
});

test('missing parts are left out rather than leaving a gap or a stray comma', () => {
  assert.equal(mailingAddress({ street: '212 W Jayne St' }, {}), '212 W Jayne St');
  assert.equal(mailingAddress({ location: 'Lone Tree, Iowa' }, {}), 'Lone Tree, Iowa');
  assert.equal(mailingAddress({ location: 'Lone Tree, Iowa', postalCode: '52755' }, {}), 'Lone Tree, Iowa 52755');
});

test('nothing configured composes to nothing, so the field is left alone', () => {
  assert.equal(mailingAddress({}, {}), '');
  assert.equal(mailingAddress(null, {}), '');
});

// ---- which fields, and the one that must never match ---------------------

test('matches how real boards label it', () => {
  for (const label of ['Address', 'Physical Mailing Address', 'Mailing Address',
    'Street Address', 'Home Address', 'Address Line 1', 'Current Address']) {
    assert.equal(isAddressField(label), true, `"${label}" should be an address field`);
  }
});

// cantina labels its email field "Email Address", and it turned up more often in the
// scan than real address fields did. The email rule normally claims it first — but
// only when an email is configured; an unset one leaves the field free, and a bare
// /address/ would then type a street address into it.
test('never matches an email field, whatever the rule order', () => {
  for (const label of ['Email Address', 'Email address', 'Work Email Address',
    'E-mail Address', 'Please confirm your email address']) {
    assert.equal(isAddressField(label), false, `"${label}" must never be an address field`);
  }
});

test('does not match other things called an address', () => {
  for (const label of ['Website address', 'URL address', 'IP address',
    'LinkedIn address', 'What is your GitHub address?']) {
    assert.equal(isAddressField(label), false, `"${label}" must not be an address field`);
  }
});

test('Address Line 2 is an apartment or suite and stays empty', () => {
  assert.equal(isAddressField('Address Line 2'), false);
  assert.equal(isAddressField('Address 2'), false);
});

test('a standalone postcode field is recognised', () => {
  for (const label of ['Zip', 'ZIP Code', 'Zip/Postal Code', 'Postal Code', 'Post Code', 'Postcode']) {
    assert.equal(isPostalField(label), true, `"${label}" should be a postcode field`);
  }
  assert.equal(isPostalField('Address'), false);
  assert.equal(isPostalField('Zipline experience'), false);
});
