// Exercises lib/fill.browser.js against real Ashby forms. Fills with obvious
// placeholder data and never submits.
import fs from 'node:fs';
import { chromium } from 'playwright';

const FILL_SRC = fs.readFileSync(new URL('../lib/fill.browser.js', import.meta.url), 'utf8');
const FAKE = {
  name: 'TEST TESTERSON', firstName: 'TEST', lastName: 'TESTERSON',
  email: 'test@example.invalid', phone: '+1 555 0100',
  linkedin: 'https://linkedin.com/in/example', github: 'https://github.com/example',
  location: 'Cedar Rapids, Iowa', locationFallbacks: ['Iowa','United States'], school: 'University of Iowa', degree: "Bachelor's Degree",
  discipline: 'Computer Science', gradYear: '2019',
  needsSponsorship: 'no', authorizedToWork: 'yes', workedHere: 'no',
};

const urls = process.argv.slice(2);
const browser = await chromium.launch({ headless: true });

for (const url of urls) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
  console.log('\n=== ' + url);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('[data-field-path]', { timeout: 30000 });
    await page.evaluate(FILL_SRC);
    await page.evaluate(me => window.__ashby.configure(me), FAKE);

    const before = await page.evaluate(() => window.__ashby.dumpLabels());
    console.log('fields:', before.map(f => `${f.kind}${f.required ? '*' : ''}:${f.label.slice(0, 42)}`).join('\n        '));

    const res = await page.evaluate(() => window.__ashby.fill());
    for (const r of res) console.log(`  ${r.ok ? 'OK  ' : 'MISS'} ${r.name.padEnd(14)} ${(r.value ?? r.err ?? '').slice(0, 50)}  «${r.label.slice(0, 38)}»`);

    const pending = await page.evaluate(() => window.__ashby.pending());
    console.log('  pending after rules:', pending.map(p => `[${p.kind}${p.required ? '*' : ''}] ${p.label.slice(0, 45)}`).join(' | ') || '(none)');

    // Exercise applyPlan on whatever is left, with harmless placeholder values.
    const plan = pending.map(p => {
      if (p.kind === 'yesno') return { path: p.path, action: 'yesno', value: 'yes' };
      if (p.kind === 'radio' && p.options?.length) return { path: p.path, action: 'pick', value: p.options[0] };
      if (p.kind === 'select' && p.options?.length) return { path: p.path, action: 'pick', value: p.options[1] ?? p.options[0] };
      if (p.kind === 'longtext' || p.kind === 'text') return { path: p.path, action: 'text', value: 'PLACEHOLDER ANSWER' };
      if (p.kind === 'combobox') return { path: p.path, action: 'combo', value: 'Cedar Rapids' };
      return { path: p.path, action: 'skip', value: 'unhandled kind ' + p.kind };
    });
    const pr = await page.evaluate(p => window.__ashby.applyPlan(p), plan);
    for (const r of pr) console.log(`  plan ${r.ok ? (r.skipped ? 'SKIP' : 'OK  ') : 'FAIL'} ${r.action.padEnd(6)} ${(r.err ?? '').slice(0, 45)}  «${(r.label ?? '').slice(0, 38)}»`);

    const left = await page.evaluate(() => window.__ashby.pending());
    console.log('  still empty:', left.map(p => p.label.slice(0, 40)).join(' | ') || '(none)');
  } catch (e) {
    console.error('  ERROR', e.message);
  }
  await page.close();
}
await browser.close();
