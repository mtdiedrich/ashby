// Pipeline 2, stage 3 — rank every posting by cosine similarity to the resume.
//
//   node match.js                  top 40
//   node match.js --top 100        more of them
//   node match.js --us             US locations only
//   node match.js --remote         workplaceType Remote only
//   node match.js --company deep   filter by company slug
//   node match.js --min 0.4        similarity floor
//   node match.js --json           emit JSONL, e.g. to feed score.js
//   node match.js --all            skip the title filter (interns, managers, firmware)
//   node match.js --raw            uncentred cosine, for comparison
//   node match.js --to-fresh       hand the results to score.js (writes fresh.jsonl)
//
// Cosine similarity measures topical overlap between your resume and a posting. It
// is good at "this is the same kind of work" and blind to everything score.js is
// for: seniority, pay, your hard constraints, whether the posting wants five years
// of something you did once. Treat it as a recall net that surfaces candidates the
// title regexes in poll.js would never match, not as a ranking you act on directly.

import fs from 'node:fs';
import { P } from '../lib/paths.js';
import { corpus, asPosting } from '../lib/corpus.js';
import { wantedTitle, usLocation } from '../lib/filters.js';
import { salaryOf } from '../lib/comp.js';
import * as vec from '../lib/vec.js';

const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i === -1 ? def : (argv[i + 1]?.startsWith('--') ? true : argv[i + 1] ?? true);
};

const TOP     = Number(flag('top', 40));
const MIN     = Number(flag('min', 0));
const COMPANY = typeof flag('company') === 'string' ? String(flag('company')).toLowerCase() : null;
const US_ONLY = argv.includes('--us');
const REMOTE  = argv.includes('--remote');
const JSON_OUT = argv.includes('--json');
const ALL      = argv.includes('--all');
const RAW      = argv.includes('--raw');
const TO_FRESH = argv.includes('--to-fresh');

const stored = vec.load();
const resume = stored.get('resume');
if (!resume) { console.error('no resume vector — run: npm run similarity'); process.exit(1); }

const jobs = corpus();
const applied = new Set(
  fs.existsSync(P.log)
    ? fs.readFileSync(P.log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).job)
    : []);

// Centre against the whole corpus, not the filtered subset: the direction being
// removed is "what a job posting sounds like", and that is defined by all of them.
const mu = RAW ? null : vec.mean(
  [...stored].filter(([k]) => k.startsWith('job:')).map(([, r]) => r.v));
const resumeV = vec.centre(resume.v, mu);

let missing = 0, filtered = 0;
const rows = [];
for (const [id, p] of jobs) {
  const v = stored.get(`job:${id}`);
  if (!v) { missing++; continue; }

  if (!ALL && !wantedTitle(p.title)) { filtered++; continue; }
  if (COMPANY && !p.company.includes(COMPANY)) continue;
  if (REMOTE && p.workplaceType !== 'Remote') continue;
  if (US_ONLY && !usLocation(p.location, [p.location, p.secondaryLocations].filter(Boolean).join(' | '))) continue;

  const score = vec.dot(resumeV, vec.centre(v.v, mu));
  if (score < MIN) continue;
  rows.push({ score, p });
}

rows.sort((a, b) => b.score - a.score);
const shown = rows.slice(0, TOP);

if (TO_FRESH) {
  const lines = shown.map(({ score, p }) => JSON.stringify(asPosting(p, score, salaryOf))).join('\n') + '\n';
  // Only fresh.jsonl. These postings came out of the corpus, so they are already
  // in it — and appending poll-shaped rows back would corrupt the store the
  // scorers read from.
  fs.appendFileSync(P.fresh, lines);
  console.log(`${shown.length} postings staged in fresh.jsonl\n\nNext: npm run fitness`);
  process.exit(0);
}

if (JSON_OUT) {
  for (const { score, p } of shown) console.log(JSON.stringify(asPosting(p, score, salaryOf)));
  process.exit(0);
}

if (missing) console.log(`(${missing} postings have no vector yet — run: npm run similarity)\n`);

const pay = p => {
  const c = (p.compensation?.summaryComponents ?? []).find(x => x.compensationType === 'Salary' && (x.minValue || x.maxValue));
  return p.compensation?.scrapeableCompensationSalarySummary ?? (c ? `${c.minValue}-${c.maxValue} ${c.currencyCode}` : '—');
};

for (const { score, p } of shown) {
  const mark = applied.has(p.id) ? '*' : ' ';
  console.log(
    `${score.toFixed(3)} ${mark} ${p.title.slice(0, 52).padEnd(53)}` +
    `${p.company.padEnd(14)}${(p.location || '?').slice(0, 24).padEnd(25)}${pay(p)}`);
}

console.log(`\n${shown.length} of ${rows.length} matching · ${jobs.size} in corpus` +
  (filtered ? ` · ${filtered} dropped by title filter (--all to include)` : '') +
  `\n${RAW ? 'raw' : 'centred'} cosine to resume · topical overlap only, not fit — run npm run fitness on anything promising`);
