// Stage 4 — open each queued posting, upload the resume, fill what can be filled,
// and stop. This script NEVER submits. You review the page and click submit.
//
//   node apply.js                 fill every posting in queue.jsonl
//   node apply.js --no-model      deterministic rules only, no API call (cheap testing)
//   node apply.js --limit 3       only the first 3
//   node apply.js --url <url>     one specific apply URL, ignoring the queue
//
// Chrome runs with --remote-debugging-port=9222, so while the script is paused at
// the Enter prompt you can attach Claude Code (or any CDP client) to the live tab
// to deal with fields outlined red. See README §red fields.

import fs from 'node:fs';
import { P } from '../lib/paths.js';
import readline from 'node:readline';
import { chromium } from 'playwright';
import { z } from 'zod';
import { ask, context, MODEL } from '../lib/ai.js';
import { resumeBlock, RESUME_PATH } from '../lib/resume.js';

const argv     = process.argv.slice(2);
const NO_MODEL = argv.includes('--no-model');
const LIMIT    = argv.includes('--limit') ? Number(argv[argv.indexOf('--limit') + 1]) : Infinity;
const ONE_URL  = argv.includes('--url') ? argv[argv.indexOf('--url') + 1] : null;

const FILL_SRC = fs.readFileSync(new URL('../lib/fill.browser.js', import.meta.url), 'utf8');

if (!fs.existsSync(P.me)) { console.error('me.json not found — copy me.example.json and fill it in.'); process.exit(1); }
const ME = JSON.parse(fs.readFileSync(P.me, 'utf8'));

if (!fs.existsSync(RESUME_PATH)) { console.error(`${RESUME_PATH} not found.`); process.exit(1); }

let queue;
if (ONE_URL) {
  queue = [{ id: 'adhoc', title: '(ad hoc)', slug: new URL(ONE_URL).pathname.split('/')[1], applyUrl: ONE_URL }];
} else {
  if (!fs.existsSync(P.queue)) { console.error('queue.jsonl not found — run score.js first.'); process.exit(1); }
  queue = fs.readFileSync(P.queue, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).slice(0, LIMIT);
}
if (!queue.length) { console.log('queue is empty'); process.exit(0); }

// `action` is a plain string rather than z.enum: the zod->JSON-schema helper
// renders an enum as a description rather than a real schema enum, so an
// off-list value would fail client-side validation and throw away the whole
// response. Accept anything and normalise below — an unrecognised action
// becomes a skip, which is the safe direction.
const ACTIONS = ['text', 'yesno', 'pick', 'combo', 'skip'];
const Plan = z.object({
  steps: z.array(z.object({
    path:   z.string().describe('the field path, copied verbatim from the fields list'),
    action: z.string().describe('one of: ' + ACTIONS.join(', ')),
    value:  z.string().describe('for yesno: "yes" or "no". for pick/combo: one option verbatim. for skip: the reason.'),
  })),
});

const normalise = steps => steps.map(s => ACTIONS.includes(s.action)
  ? s
  : { ...s, action: 'skip', value: `model returned unknown action "${s.action}"` });

const RESUME_DOC = NO_MODEL ? null : resumeBlock();

const PLAN_SYSTEM = `You fill job-application fields for one candidate. Their resume is
attached as a document, and additional context follows below.

Return one step per field you were given. Rules:
- action "yesno": value is exactly "yes" or "no".
- action "pick": the field has an options list; value must be one of those options, verbatim.
- action "combo": a free-text autocomplete; value should be a plain place/school name that a
  location or school autocomplete would suggest.
- action "text": short answers and long answers alike. For a long answer, write in the
  candidate's own voice using the specifics in their context — a real project, a real number,
  a real decision. Never generic enthusiasm. Respect maxLength when given. Never invent an
  employer, a degree, a date, or a metric that is not in the context.
- action "skip": use it whenever you cannot answer from the context — file uploads, signatures,
  demographic/EEOC questions, salary expectations not stated in the context, anything about the
  candidate's private information that was not provided. value is a short reason.
  Skipping is correct and expected. A plausible-sounding guess is worse than a red outline.

<candidate_context>
${NO_MODEL ? '' : context()}
</candidate_context>`;

const ctx = await chromium.launchPersistentContext(P.profile, {
  headless: false,
  channel: 'chrome',
  args: ['--remote-debugging-port=9222'],
  viewport: { width: 1400, height: 1000 },
  acceptDownloads: false,
}).catch(() => chromium.launchPersistentContext(P.profile, {
  headless: false,
  args: ['--remote-debugging-port=9222'],
  viewport: { width: 1400, height: 1000 },
}));

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const prompt = q => new Promise(r => rl.question(q, r));

const done = [];

for (const [i, job] of queue.entries()) {
  const url = job.applyUrl ?? (job.jobUrl ? job.jobUrl.replace(/\/?$/, '/application') : null);
  if (!url) { console.warn(`skipping ${job.title}: no apply URL`); continue; }

  console.log(`\n${'─'.repeat(70)}\n[${i + 1}/${queue.length}] ${job.title} — ${job.slug}\n${url}`);
  const page = await ctx.newPage();
  const record = { job: job.id, title: job.title, slug: job.slug, url, at: new Date().toISOString(), model: NO_MODEL ? null : MODEL };

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    // networkidle never fires on some Ashby pages (analytics beacons keep the
    // connection warm), so wait for the form itself.
    await page.waitForSelector('[data-field-path]', { timeout: 30_000 });

    // Resume upload. Target the resume entry specifically — pages can have a
    // second file input for a cover letter, and the bare selector picks the wrong one.
    const resumeInput = page.locator('[data-field-path="_systemfield_resume"] input[type=file]').first();
    if (await resumeInput.count()) {
      await resumeInput.setInputFiles(RESUME_PATH);
      // Ashby parses the resume server-side and backfills name/email; give it a
      // moment, then wait for the name field to actually populate.
      await page.waitForFunction(
        () => document.querySelector('[data-field-path="_systemfield_name"] input')?.value?.trim(),
        null, { timeout: 15_000 },
      ).catch(() => console.log('  (resume autofill did not populate name — filling it from me.json)'));
      record.resumeUploaded = true;
    } else {
      console.log('  (no resume field on this form)');
    }

    await page.evaluate(FILL_SRC);
    await page.evaluate(me => window.__ashby.configure(me), ME);

    record.ruleResults = await page.evaluate(() => window.__ashby.fill());
    const ruleOk = record.ruleResults.filter(r => r.ok).length;
    console.log(`  rules: ${ruleOk} filled` +
      (record.ruleResults.length - ruleOk ? `, ${record.ruleResults.length - ruleOk} not applied` : ''));

    const fields = await page.evaluate(() => window.__ashby.pending());
    record.pending = fields.length;
    record.planResults = [];

    if (fields.length && !NO_MODEL) {
      const posting = await page.evaluate(() => document.body.innerText.slice(0, 6000));
      console.log(`  asking the model about ${fields.length} remaining field(s)...`);
      const { steps } = await ask(
        PLAN_SYSTEM,
        `<job>${job.title} at ${job.slug}\n\n${posting}</job>\n\n<fields>\n${JSON.stringify(fields, null, 1)}\n</fields>`,
        { schema: Plan, maxTokens: 12_000, documents: [RESUME_DOC] },
      );
      record.planResults = await page.evaluate(p => window.__ashby.applyPlan(p), normalise(steps));
    } else if (fields.length) {
      console.log(`  ${fields.length} field(s) left unfilled (--no-model):`);
      for (const f of fields) console.log(`    ${f.required ? '*' : ' '} [${f.kind}] ${f.label}`);
    }

    const filled  = record.planResults.filter(r => r.ok && !r.skipped);
    const red     = record.planResults.filter(r => !r.ok || r.skipped);
    const redReq  = red.filter(r => fields.find(f => f.path === r.path)?.required);
    console.log(`  model: ${filled.length} filled (gold), ${red.length} left for you (red)` +
      (redReq.length ? `  ← ${redReq.length} of those are REQUIRED` : ''));
    for (const r of red) console.log(`    red: ${r.label ?? r.path} — ${r.err ?? r.value}`);

    console.log(`\n  Nothing has been submitted. Review the page, fix the red fields, submit yourself.`);
    record.outcome = 'filled';
  } catch (e) {
    console.error(`  error: ${e.message}`);
    record.outcome = 'error';
    record.error = e.message;
  }

  fs.appendFileSync(P.log, JSON.stringify(record) + '\n');
  done.push(job.id);

  const a = (await prompt('  [Enter] next · [s]kip rest · [k]eep tab open: ')).trim().toLowerCase();
  if (a !== 'k') await page.close().catch(() => {});
  if (a === 's') break;
}

// Drop everything we opened from the queue so a re-run does not reopen it.
if (!ONE_URL && done.length) {
  const rest = fs.readFileSync(P.queue, 'utf8').split('\n').filter(Boolean)
    .map(l => JSON.parse(l)).filter(j => !done.includes(j.id));
  fs.writeFileSync(P.queue, rest.map(j => JSON.stringify(j)).join('\n') + (rest.length ? '\n' : ''));
  console.log(`\n${done.length} processed, ${rest.length} left in queue.jsonl`);
}

rl.close();
await ctx.close();
