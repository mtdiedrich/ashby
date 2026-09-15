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
import { resumeBlock, resumeFile } from '../lib/resume.js';
import { appliedIds, dropFromQueue } from '../lib/applog.js';

const readJsonl = f => fs.existsSync(f)
  ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
  : [];

const argv     = process.argv.slice(2);
const NO_MODEL = argv.includes('--no-model');
const LIMIT    = argv.includes('--limit') ? Number(argv[argv.indexOf('--limit') + 1]) : Infinity;
const ONE_URL  = argv.includes('--url') ? argv[argv.indexOf('--url') + 1] : null;

// How long to wait for Ashby's own resume parser before giving up and using me.json.
// Boards that backfill do it in about a second; boards that never will used to cost
// 15 seconds each. --wait-parse raises it if you hit a slow one.
const RESUME_PARSE_MS = argv.includes('--wait-parse')
  ? Number(argv[argv.indexOf('--wait-parse') + 1]) * 1000
  : 3000;

const FILL_SRC = fs.readFileSync(new URL('../lib/fill.browser.js', import.meta.url), 'utf8');

if (!fs.existsSync(P.me)) { console.error('me.json not found — copy me.example.json and fill it in.'); process.exit(1); }
const ME = JSON.parse(fs.readFileSync(P.me, 'utf8'));

if (!fs.existsSync(resumeFile())) { console.error(`${resumeFile()} not found.`); process.exit(1); }

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
  salary expectations not stated in the context, anything about the candidate's private
  information that was not provided. value is a short reason.
  Skipping is correct and expected. A plausible-sounding guess is worse than a red outline.
- ALWAYS skip voluntary self-identification questions (gender, ethnicity or race, veteran
  status, disability). A deterministic pass has already selected the "decline to answer"
  option on every one of those that offered it, so any that reach you offered no such
  option. Never state one of these on the candidate's behalf.

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
      await resumeInput.setInputFiles(resumeFile());
      // Ashby parses the resume server-side and backfills name/email on SOME boards.
      // Waiting for that is an optimisation, not a requirement — the rules fill both
      // from me.json regardless. The only reason to wait at all is that a late
      // backfill would overwrite what we typed.
      //
      // This was a 15s timeout, and on a board that never backfills it burned all 15
      // every time: measured at 15,002ms of a 20,337ms startup, 74% of the wait
      // before the model was even called. Boards that do backfill do it in ~1s.
      const waited = Date.now();
      const backfilled = await page.waitForFunction(
        () => document.querySelector('[data-field-path="_systemfield_name"] input')?.value?.trim(),
        null, { timeout: RESUME_PARSE_MS },
      ).then(() => true).catch(() => false);
      console.log(backfilled
        ? `  resume parsed by Ashby in ${Date.now() - waited}ms`
        : `  (Ashby did not autofill from the resume — using me.json)`);
      record.resumeUploaded = true;
      record.resumeBackfill = backfilled;
    } else {
      console.log('  (no resume field on this form)');
    }

    await page.evaluate(FILL_SRC);
    // The posting goes in too: the pay rule needs the published range to decide
    // whether the stated ask would land below what the employer already budgeted.
    await page.evaluate(([me, posting]) => window.__ashby.configure(me, posting),
      [ME, { employmentType: job.employmentType, salary: job.salary ?? null }]);

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

  // Ask before writing anything, so the record says what actually happened rather
  // than "this tab was opened". apply.js never submits, so this is your answer, not
  // an observation — there is nothing else it could be.
  // If the prompt cannot be answered — stdin closed, input piped, terminal gone —
  // fall through to "not submitted" and still write the record. Asking first means a
  // failure here would otherwise lose the whole record, which is what the old
  // write-then-ask order protected against.
  const a = await prompt(
    '\n  Submitted?  [y] yes · [n] no, move on · [k] not yet, keep it queued · [s] stop here: '
  ).then(x => String(x).trim().toLowerCase())
   .catch(() => { console.log('\n  (no answer possible — recording as not submitted)'); return 'n'; });

  record.submitted = a === 'y';
  if (record.submitted) record.submittedAt = new Date().toISOString();

  // Written per posting, not at the end of the run. Interrupting a run used to throw
  // away every queue removal, so the next run reopened everything already dealt with.
  fs.appendFileSync(P.log, JSON.stringify(record) + '\n');

  // 'k' leaves it queued for next time; everything else is finished with.
  if (!ONE_URL && a !== 'k') {
    const rest = dropFromQueue(readJsonl(P.queue), job.id);
    fs.writeFileSync(P.queue, rest.map(j => JSON.stringify(j)).join('\n') + (rest.length ? '\n' : ''));
    console.log(`  recorded${record.submitted ? ' as submitted' : ''} · ${rest.length} left in the queue`);
  } else if (a === 'k') {
    console.log('  left in the queue for next time');
  }
  done.push(job.id);

  if (a !== 'k') await page.close().catch(() => {});
  if (a === 's') break;
}

const sent = done.length && fs.existsSync(P.log)
  ? appliedIds(readJsonl(P.log).filter(r => done.includes(r.job))).size : 0;
console.log(`\n${done.length} opened, ${sent} submitted`);

rl.close();
await ctx.close();
