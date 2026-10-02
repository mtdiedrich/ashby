// Pay estimates from levels.fyi for scored postings that publish no pay.
//
//   npm run levels                 look up everything due
//   npm run levels -- --dry        say what would be looked up, fetch nothing
//   npm run levels -- --refresh    look up again even if looked up in the last 30 days
//   npm run levels -- --limit 20   at most N company pages
//   npm run levels -- --jobs 2     pages fetched at once (default 1)
//   npm run levels -- --delay 3000 ms each worker waits between pages (default 1500)
//
// DISPLAY ONLY. The board shows an estimate in the pay column, marked "est.", with
// the level it came from and how many submissions it rests on. Nothing that selects,
// filters or scores postings reads pay-estimates.jsonl; see lib/levels.js.
//
// One page per company and job family, US only. A company with no levels.fyi page,
// or no US data for the level, gets no estimate — never another company's numbers.
// Misses are recorded like hits, so a re-run within 30 days does not ask again.
//
// Board slugs are usually levels.fyi's company slugs. Where they are not
// ("andurilindustries" is "anduril" there), map them in config/levels-companies.json:
//   { "andurilindustries": "anduril", "somecompany": null }
// null means never look that company up.

import fs from 'node:fs';
import { P } from '../lib/paths.js';
import { corpus, linesOf } from '../lib/corpus.js';
import { appendRows } from '../lib/jsonl.js';
import { pool, jobsFlag } from '../lib/pool.js';
import { progress } from '../lib/progress.js';
import { fetchPatient } from '../lib/fetch.js';
import { familyFor, estimateFrom, parseNextData, levelsSlug, needsEstimate, estimatesById, due, pageUrl, isBlocked, nameMatches }
  from '../lib/levels.js';

const argv    = process.argv.slice(2);
const DRY     = argv.includes('--dry');
const REFRESH = argv.includes('--refresh');
const LIMIT   = argv.includes('--limit') ? Number(argv[argv.indexOf('--limit') + 1]) : Infinity;
// One at a time, and unhurried: levels.fyi is behind a bot check, and a first run at
// ~12 pages a second was challenged after about 380. A challenge stops the run.
const JOBS    = jobsFlag(process.argv, 1);
const DELAY   = argv.includes('--delay') ? Number(argv[argv.indexOf('--delay') + 1]) : 1500;

const rowsOf = f => {
  if (!fs.existsSync(f)) return [];
  const out = [];
  for (const l of linesOf(f)) { try { out.push(JSON.parse(l)); } catch {} }
  return out;
};

const overrides = fs.existsSync(P.levelsCompanies)
  ? JSON.parse(fs.readFileSync(P.levelsCompanies, 'utf8')) : {};
// Scored means has a fitness score — the only score since 2026-10-02.
const scored = new Set(rowsOf(P.jevFitness).map(r => r.id));
const known = estimatesById(rowsOf(P.payEstimates));
const now = new Date();

// Group by company page, so each page is fetched once for every posting on it.
const groups = new Map();
const skipped = [];
for (const p of corpus().values()) {
  if (!needsEstimate(p, scored) || !due(known.get(p.id), now, { refresh: REFRESH })) continue;
  const slug = levelsSlug(p.company, overrides);
  if (!slug) { skipped.push(p); continue; }
  const key = slug + '|' + familyFor(p.title);
  if (!groups.has(key)) groups.set(key, { slug, board: p.company, mapped: slug !== p.company, family: familyFor(p.title), postings: [] });
  groups.get(key).postings.push(p);
}
const work = [...groups.values()].slice(0, LIMIT);
const postingsDue = work.reduce((n, g) => n + g.postings.length, 0);

console.log(`${postingsDue} posting${postingsDue === 1 ? '' : 's'} with no published pay, ` +
  `${work.length} levels.fyi page${work.length === 1 ? '' : 's'} to read` +
  (groups.size > work.length ? ` (of ${groups.size}; --limit)` : '') +
  (skipped.length ? ` · ${skipped.length} skipped by levels-companies.json` : ''));

if (DRY) {
  for (const g of work.slice(0, 30)) console.log(`  ${pageUrl(g.slug, g.family)}  ·  ${g.postings.length}`);
  if (work.length > 30) console.log(`  … and ${work.length - 30} more`);
  console.log('\n--dry, nothing fetched');
  process.exit(0);
}

const at = now.toISOString();
if (skipped.length) {
  appendRows(P.payEstimates, skipped.map(p => ({ id: p.id, at, none: 'skipped by levels-companies.json' })));
}

// A block is the same answer for every page that follows. Stop on the first one
// rather than ask a site that has said no a thousand more times.
const blocked = e => e?.blocked === true;

const tally = { exact: 0, 'same level': 0, 'all levels': 0, none: 0, pages: 0, missing: 0 };
const bar = progress(work.length, 'reading levels.fyi');
const results = await pool(work, async (g) => {
  const url = pageUrl(g.slug, g.family);
  const r = await fetchPatient(url, {
    timeoutMs: 30_000,
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; ashby job-search tool, personal use)' },
  });
  // Before anything is recorded: a challenge is not an answer about the company.
  if (isBlocked(r)) {
    throw Object.assign(new Error(`levels.fyi's bot check answered (${r.status}) — stopping. ` +
      'Wait a while and run again; it resumes where it left off.'), { blocked: true });
  }
  let pp = r.ok ? parseNextData(await r.text()) : null;
  // A slug mapped by hand must land on the right company: a wrong one that happens to
  // exist would attach someone else's pay.
  let wrongCompany = false;
  if (pp && g.mapped && !nameMatches(g.board, pp.company?.name)) {
    console.error(`\n  ${g.board} -> ${g.slug} is "${pp.company?.name}", not a match — ignored`);
    pp = null; wrongCompany = true;
  }
  if (pp) tally.pages++; else tally.missing++;

  // Written per page, as it lands: an interrupted run keeps every page it read.
  appendRows(P.payEstimates, g.postings.map(p => {
    const e = pp ? estimateFrom(pp, p.title) : null;
    if (!e) {
      tally.none++;
      return { id: p.id, at, slug: g.slug, family: g.family,
        none: pp ? 'no US data for this level'
          : wrongCompany ? 'mapped slug is a different company' : `no levels.fyi page (${r.status})` };
    }
    tally[e.kind]++;
    return { id: p.id, at, slug: g.slug, url, ...e };
  }));
  await new Promise(r => setTimeout(r, DELAY));
}, { limit: JOBS, onDone: () => bar.tick(), stopOn: blocked });
// finish() forces the bar to 100% and prints "N in Xs". After a block that would claim
// work that never happened, so a stopped run leaves the bar where it really stopped.
results.stopped ? process.stderr.write('\n') : bar.finish();
const attempted = results.filter(Boolean).length;

const failed = results.filter(x => x && !x.ok);
console.log(`${tally.pages} pages found, ${tally.missing} companies not on levels.fyi`);
console.log(`  estimated: ${tally.exact} exact title · ${tally['same level']} same level · ` +
  `${tally['all levels']} company-wide · ${tally.none} with no usable US data`);
if (results.stopped) console.error(`Stopped after ${attempted} of ${work.length} pages: ${results.stopped.message}`);
else if (failed.length) console.error(`  ${failed.length} page${failed.length === 1 ? '' : 's'} failed: ${failed[0].error.message}`);
