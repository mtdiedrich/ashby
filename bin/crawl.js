// Pipeline 2, stage 1 — pull EVERY posting from every board, unfiltered.
//
//   node crawl.js            fetch all boards on every ATS into corpus.jsonl
//   node crawl.js --stats    just report what is already stored
//   node crawl.js --ats X    only that ATS (ashby | greenhouse)
//
// Two ATSes, one corpus. Everything board-specific — endpoint, response shape,
// record conversion — lives in lib/ats.js; this file only does the fetching.
//
// This is deliberately not poll.js. poll.js applies title/location/pay filters and
// only ever emits things it has not judged before, because its output costs a model
// call each. The corpus is the opposite: everything, so the embedding ranker can
// surface a role whose title none of poll.js's regexes would ever match.
//
// corpus.jsonl is keyed by posting id. A posting whose description has changed is
// appended again with a new fetchedAt; readers take the newest. Embedding uses a
// content hash, so a re-listed but unchanged posting is never re-embedded.

import fs from 'node:fs';
import { P } from '../lib/paths.js';
import { corpus, embedText, hash, rawLineCount, compactCorpus } from '../lib/corpus.js';
import { jobsFlag } from '../lib/pool.js';
import { ATS, keepDescription } from '../lib/ats.js';

// Boards are fetched a few at a time. 12 matches what harvest.js already uses
// against the same public API; --jobs raises it if you are impatient, but this is
// someone else's free endpoint and 3,800 boards is already a lot to ask of it.
const CONCURRENCY = jobsFlag(process.argv, 12);
const STATS_ONLY = process.argv.includes('--stats');
// --full stores every description, the way this worked before the corpus reached
// 380 MB. Expect roughly a gigabyte per 170,000 postings.
const FULL = process.argv.includes('--full');
// Rewrite the corpus dropping superseded rows, and stop. Normally automatic, but
// worth having by hand after a change that rewrote a lot of records.
const COMPACT_ONLY = process.argv.includes('--compact');

if (COMPACT_ONLY) {
  const r = compactCorpus();
  console.log(`corpus.jsonl: ${r.before.toLocaleString()} rows → ${r.after.toLocaleString()} postings`);
  console.log(`  ${(r.bytesBefore / 1048576).toFixed(0)} MB → ${(r.bytesAfter / 1048576).toFixed(0)} MB`);
  process.exit(0);
}

if (STATS_ONLY) {
  const c = corpus();
  const bySlug = {}, byAts = {};
  for (const p of c.values()) {
    bySlug[p.company] = (bySlug[p.company] ?? 0) + 1;
    const a = p.ats ?? 'ashby';
    byAts[a] = (byAts[a] ?? 0) + 1;
  }
  console.log(`corpus.jsonl: ${c.size} postings across ${Object.keys(bySlug).length} boards`);
  for (const [a, n] of Object.entries(byAts).sort((x, y) => y[1] - x[1])) {
    console.log(`  ${a.padEnd(12)} ${n}`);
  }
  console.log(`  raw lines (incl. revisions): ${rawLineCount()}`);
  const top = Object.entries(bySlug).sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [s, n] of top) console.log(`  ${String(n).padStart(4)}  ${s}`);
  process.exit(0);
}

const ONLY = process.argv.includes('--ats')
  ? process.argv[process.argv.indexOf('--ats') + 1]
  : null;
if (ONLY && !ATS[ONLY]) {
  console.error(`unknown --ats "${ONLY}" — try: ${Object.keys(ATS).join(', ')}`);
  process.exit(1);
}

const readSlugs = f => fs.existsSync(f)
  ? [...new Set(fs.readFileSync(f, 'utf8').split('\n').map(s => s.trim().toLowerCase()).filter(Boolean))]
  : [];

// [adapter, slug] pairs, so one queue covers every board on every ATS and the
// concurrency limit applies across the whole run rather than per system.
const work = [];
for (const [id, file] of [['ashby', P.slugs], ['greenhouse', P.ghSlugs]]) {
  if (ONLY && ONLY !== id) continue;
  const list = readSlugs(file);
  if (list.length) console.log(`${ATS[id].label}: ${list.length} boards`);
  for (const slug of list) work.push([ATS[id], slug]);
}
if (!work.length) {
  console.error('no board lists found — run: npm run harvest');
  process.exit(1);
}

const known = corpus();
const now = new Date().toISOString();
const added = [];
let ok = 0, dead = 0, seenTotal = 0, unchanged = 0;

async function crawlSlug(ats, slug) {
  let body;
  try {
    const r = await fetch(ats.boardUrl(slug), { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) { dead++; return; }
    body = await r.json();
  } catch { dead++; return; }

  const jobs = ats.postingsFrom(body);
  ok++; seenTotal += jobs.length;

  for (const j of jobs) {
    // Descriptions are 96.5% of the corpus and 3.6% of it is ever scored. Metadata
    // is kept for every posting so the board still lists it; the description is kept
    // only for titles a scorer could see, and fetched on demand for anything else.
    const descriptions = FULL || keepDescription(j.title);
    const rec = ats.normalize(j, slug, now, { descriptions });
    rec.hash = hash(embedText(rec));

    const prev = known.get(rec.id);
    if (prev && prev.hash === rec.hash) { unchanged++; continue; }
    added.push(rec);
  }
}

const queue = work.slice();
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) { const [ats, slug] = queue.shift(); await crawlSlug(ats, slug); }
}));

if (added.length) {
  fs.appendFileSync(P.corpus, added.map(r => JSON.stringify(r)).join('\n') + '\n');
}

// The corpus is append-only, so a re-crawl that changes many postings at once leaves
// every superseded row behind. One storage-policy change rewrote 60,903 of them, the
// file passed Node's 512 MB string limit, and every command that reads it died at
// once. Compact when the dead weight is worth the rewrite, or when the file is
// approaching that limit — whichever comes first.
{
  const bytes = fs.existsSync(P.corpus) ? fs.statSync(P.corpus).size : 0;
  const live = corpus().size;
  const total = rawLineCount();
  if (total > live * 1.25 || bytes > 0x1fffffe8 * 0.75) {
    process.stdout.write(`  compacting ${total.toLocaleString()} rows down to ${live.toLocaleString()} postings...`);
    const r = compactCorpus();
    console.log(` ${(r.bytesBefore / 1048576).toFixed(0)} MB → ${(r.bytesAfter / 1048576).toFixed(0)} MB`);
  }
}

const fresh = added.filter(r => !known.has(r.id)).length;
console.log(`${ok} boards ok, ${dead} dead, ${seenTotal} postings seen`);
console.log(`  ${fresh} new, ${added.length - fresh} changed, ${unchanged} unchanged`);
console.log(`  corpus.jsonl now holds ${corpus().size} postings`);
if (added.length) console.log(`\nNext: npm run fitness`);
