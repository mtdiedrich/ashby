import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usLocation } from '../lib/filters.js';

test('usLocation accepts US cities, states and bare remote', () => {
  for (const l of [
    'San Francisco', 'Palo Alto, CA', 'New York, NY', 'Remote',
    'USA | Remote', 'United States', 'Cedar Rapids, Iowa', 'Austin', 'Seattle',
  ]) assert.ok(usLocation(l, l), `should accept: ${l}`);
});

test('usLocation rejects locations abroad', () => {
  for (const l of [
    'Tokyo, Japan', 'London, UK', 'Seoul, South Korea', 'Paris',
    'Toronto', 'Remote - European Union', 'Singapore', 'Bangalore, India',
  ]) assert.equal(usLocation(l, l), false, `should reject: ${l}`);
});

test('a US city in secondaryLocations does not drag in a London posting', () => {
  // This was a real bug: testing the combined string let abroad roles through.
  assert.equal(usLocation('London', 'London | San Francisco'), false);
  assert.equal(usLocation('Toronto', 'Toronto | New York'), false);
});

test('a US primary with foreign secondaries is still US', () => {
  assert.ok(usLocation('San Francisco', 'San Francisco | London'));
});

test('usLocation does not match the "us" inside other words', () => {
  // \b boundaries: "Museum" and "Customer Site" contain "us" but are not the US.
  assert.equal(usLocation('Museum District, Berlin', 'Museum District, Berlin'), false);
});

// "Research Scientist" is no longer a reason on its own to include a posting — that
// term is what dragged in wet-lab, pharma and philosophy roles. A research scientist
// role that names ML or AI still qualifies; the title was never the problem, the
// absence of any ML signal was.
// usLocation decides what is scored at all since 2026-10-03, so its misses cost
// postings rather than a toggle. Checked against the live corpus: 26 of the 50 state
// codes were listed, and ~4,500 US postings ("St. Louis, MO") read as abroad.
test('every state code after a comma is US', () => {
  for (const l of ['St. Louis, MO', 'Hartford, CT', 'Indianapolis, IN', 'Greenfield, IN', 'Boise, ID',
                   'Wilmington, DE', 'Portland, ME', 'Weirton, WV', 'Little Rock, AR', 'Omaha, NE',
                   'Anchorage, AK', 'Honolulu, HI', 'San Juan, PR', 'Lincoln, NE; Omaha, NE'])
    assert.ok(usLocation(l, l), `should accept: ${l}`);
});

test('a state code that is also a country code does not drag in that country', () => {
  for (const l of ['Pune, IN', 'Hyderabad, IN', 'Darmstadt, DE', 'Stuttgart, DE', 'Berlin, DE', 'Curitiba, PR'])
    assert.equal(usLocation(l, l), false, `should reject: ${l}`);
});

test('state codes count only as uppercase codes, not as words', () => {
  for (const l of ['Hybrid in office', 'Office me', 'Statistician Network'])
    assert.equal(usLocation(l, l), false, `should reject: ${l}`);
});

test('a role open anywhere, including the US, is kept', () => {
  for (const l of ['Anywhere', 'Worldwide', 'Global', 'North America'])
    assert.ok(usLocation(l, l), `should accept: ${l}`);
  for (const l of ['Hybrid', 'HQ', ''])
    assert.equal(usLocation(l, l), false, `no country named: ${l}`);
});

// The board's top rows still carried "Remote – Ukraine", "Colombia - Fully Remote" and
// "Remote, Ontario": BLOCK_LOC named ~50 places, so any other country passed beside
// "remote" or a US secondary. A primary location abroad rules a posting out.
test('a primary location in any country abroad is not US, remote or not', () => {
  for (const l of ['Remote – Ukraine', 'Remote - Colombia', 'Colombia - Fully Remote', 'Remote Philippines',
                   'Mexico, Remote', 'Remote, Ontario', 'Argentina (Remote)', 'Bogota, Colombia', 'Greece',
                   'Deutschland, remote', 'Türkiye, Remote', 'Remote - Czech Republic', 'Latin America | Remote',
                   'Kazakhstan', 'Remote, Serbia', 'South Africa', 'China (Remote)', 'Pakistan - Remote', 'Kyiv'])
    assert.equal(usLocation(l, l + ' | San Francisco, CA'), false, `should reject even with a US secondary: ${l}`);
});

test('US places that share a name with somewhere abroad stay US', () => {
  for (const l of ['Albuquerque, New Mexico', 'Mexico, MO', 'Jersey City, NJ', 'Panama City, FL', 'Atlanta, Georgia',
                   'Lebanon, NH', 'Remote (US/Canada)', 'United States & Canada', 'LATAM (Remote), US (Remote)'])
    assert.ok(usLocation(l, l), `should accept: ${l}`);
});

// From the corpus's ~800 locations that name a place abroad AND carry a state code.
test('a state code written without a comma is US', () => {
  for (const l of ['Hayward CA', 'Charlotte NC', 'TX - Carrollton', 'CA - Vernon', 'NY', 'OR - Weston',
                   'District of Columbia (DC)', 'Baldwin NY'])
    assert.ok(usLocation(l, l), `should accept: ${l}`);
});

test('a code in front of a place abroad is that country, and "or" is a word', () => {
  for (const l of ['CA - Toronto', 'CA-Ontario-Toronto', 'IN - Bangalore, India', 'DE - Berlin', 'IL - Tel Aviv',
                   'Toronto, ON, CA', 'Hanoi OR Ho Chi Minh City', 'Hamburg or Berlin', 'Cracow or Warsaw',
                   'Remote - Ontario OR British Columbia', 'Bogota D.C. / DC / Colombia'])
    assert.equal(usLocation(l, l), false, `should reject: ${l}`);
});

test('US towns named after places abroad stay US', () => {
  for (const l of ['Vancouver, WA', 'Ontario, CA', 'Brisbane, CA', 'Melbourne, FL', 'Manchester, NH', 'Vienna, VA',
                   'Dublin, OH', 'South Jordan, UT', 'Rome, NY', 'Amsterdam, NH', 'New Brunswick, NJ'])
    assert.ok(usLocation(l, l), `should accept: ${l}`);
});

// Second pass over the corpus diff.
test('title-case state codes after a comma are US', () => {
  for (const l of ['Playa Vista, Ca', 'Killeen, Tx', 'Fort Lauderdale, Fl', 'Vancouver, Wa', 'Monroeville, Pa'])
    assert.ok(usLocation(l, l), `should accept: ${l}`);
});

test('a list naming the US and Canada is US', () => {
  for (const l of ['Boston, MA; Mountain View, CA; Toronto, ON', 'San Francisco, CA or Waterloo, ON',
                   'Dallas, TX, Denver, CO, Edmonton, AB', 'Vancouver, BC or New York City'])
    assert.ok(usLocation(l, l), `should accept: ${l}`);
  assert.equal(usLocation('Blainville, QC, CA', 'Blainville, QC, CA'), false);
});

test('country-code prefixes and postcodes are not states', () => {
  for (const l of ['IN - Jaipur', 'München DE', 'Covering: CT4 and CT18 Postcodes', 'XUS-IN'])
    assert.equal(usLocation(l, l), false, `should reject: ${l}`);
});
