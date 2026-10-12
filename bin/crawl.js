// Pipeline 2, stage 1 — pull EVERY posting from every board, unfiltered.
//
//   node crawl.js            fetch all boards on every ATS into corpus.jsonl
//   node crawl.js --stats    just report what is already stored
//   node crawl.js --ats X    only that ATS (ashby | greenhouse)
//
// Two ATSes, one corpus. Everything board-specific — endpoint, response shape,
// record conversion — lives in lib/ats.js; this file only does the fetching.
//
// poll.js runs this, then stages whatever is not yet scored.
//
// corpus.jsonl is keyed by posting id and holds metadata; every description goes to
// descriptions.jsonl (lib/descriptions.js). A posting whose content has changed is
// appended again with a new fetchedAt; readers take the newest. A posting its board
// no longer lists — a board that answered — is closed and dropped from both
// (closedIds). Fitness answers are keyed by content, so a re-listed but unchanged
// posting is never asked about twice.

import fs from 'node:fs';
import { P } from '../lib/paths.js';
import { corpusAndCount, embedText, hash, compactCorpus, closedIds, boardKey } from '../lib/corpus.js';
import { appendRows, dropRows } from '../lib/jsonl.js';
import { descriptionIndex, descriptionStats, splitRecord, compactDescriptions } from '../lib/descriptions.js';
import { progress } from '../lib/progress.js';
import { jobsFlag } from '../lib/pool.js';
import { ATS } from '../lib/ats.js';
import { fetchPatient } from '../lib/fetch.js';

// Boards are fetched a few at a time. 12 matches what harvest.js already uses
// against the same public API; --jobs raises it if you are impatient, but this is
// someone else's free endpoint and 3,800 boards is already a lot to ask of it.
const CONCURRENCY = jobsFlag(process.argv, 12);
const STATS_ONLY = process.argv.includes('--stats');
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
  const { map: c, lines } = corpusAndCount();
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
  console.log(`  raw lines (incl. revisions): ${lines}`);
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

// One read, not four. corpus() and rawLineCount() each walk the whole file, and this
// used to call them at the top, twice for the compaction check, and once more for the
// closing line — about twelve seconds at 190 MB, in a run that prints nothing while
// it works.
const { map: known, lines: linesBefore } = corpusAndCount();
const now = new Date().toISOString();
let ok = 0, dead = 0, seenTotal = 0, unchanged = 0, changed = 0, described = 0;
const newIds = new Set();
// Every board that answered, and what it listed — what closure is judged against.
const boards = new Map();
// What descriptions.jsonl already holds, by id and content hash.
const stored = descriptionIndex();

async function crawlSlug(ats, slug) {
  let body;
  try {
    // Not a bare fetch: ~6% of Greenhouse requests stall up to 17s before answering,
    // and one of those holds a worker for all of it. See lib/fetch.js.
    const r = await fetchPatient(ats.boardUrl(slug), { timeoutMs: 30_000 });
    if (!r.ok) { dead++; return; }
    body = await r.json();
  } catch { dead++; return; }

  const jobs = ats.postingsFrom(body);
  ok++; seenTotal += jobs.length;
  const seen = new Set(), rows = [], texts = [];

  for (const j of jobs) {
    // Every description is kept — the title filter that decided which was dropped on
    // 2026-10-03. The text goes to descriptions.jsonl and the corpus row is metadata;
    // see lib/descriptions.js for why they are separate.
    const rec = ats.normalize(j, slug, now);
    rec.hash = hash(embedText(rec));
    seen.add(rec.id);
    const { meta, desc } = splitRecord(rec);

    // Checked on its own, not through the corpus row: a posting whose row is
    // unchanged may still have no stored text — every row written before the store.
    if (stored.get(rec.id)?.hash !== rec.hash) texts.push(desc);

    const prev = known.get(rec.id);
    if (prev && prev.hash === rec.hash) { unchanged++; continue; }
    if (prev) changed++; else newIds.add(rec.id);
    rows.push(meta);
  }
  // Written per board, as it lands. Holding every row for one write at the end is
  // what has lost work in this project before, and with every description in it the
  // run would hold ~2.5 GB of them.
  if (texts.length) described += appendRows(P.descriptions, texts);
  if (rows.length) appendRows(P.corpus, rows);
  boards.set(boardKey({ ats: ats.id, company: slug }), seen);
}

// 10,000 boards is four and a half minutes. Saying nothing for four and a half
// minutes is indistinguishable from being hung.
const bar = progress(work.length, 'fetching boards');
const queue = work.slice();
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) {
    const [ats, slug] = queue.shift();
    await crawlSlug(ats, slug);
    bar.tick();
  }
}));
bar.finish();

// Closed: on a board that answered, and not listed by it. These leave the corpus and
// the derived files that would keep them on the board or the worklist. Fitness rows
// stay — they are keyed by content too, and a re-listing reuses them. The log,
// queue and dismissals are history and are never touched.
const closed = closedIds(known, boards);

// Derived from what this run already knows rather than re-read from disk.
const fresh = newIds.size;
const liveNow = known.size + fresh - closed.size;
const linesNow = linesBefore + fresh + changed;

console.log(`${ok} boards ok, ${dead} dead, ${seenTotal} postings seen`);
console.log(`  ${fresh} new, ${changed} changed, ${unchanged} unchanged, ${closed.size} closed`);
console.log(`  ${described.toLocaleString()} descriptions stored`);
console.log(`  corpus.jsonl now holds ${liveNow.toLocaleString()} postings`);
if (closed.size) {
  const f = dropRows(P.fresh, closed), e = dropRows(P.payEstimates, closed);
  if (f || e) console.log(`  closed postings dropped from fresh.jsonl (${f}) and pay-estimates.jsonl (${e})`);
}

// The corpus is append-only, so a re-crawl that changes many postings at once leaves
// every superseded row behind. One storage-policy change rewrote 60,903 of them, the
// file passed Node's 512 MB string limit, and every command that reads it died at
// once. Compact when the dead weight is worth the rewrite, or when the file is
// approaching that limit — whichever comes first.
{
  const bytes = fs.existsSync(P.corpus) ? fs.statSync(P.corpus).size : 0;
  // Closed postings are dropped by the same rewrite, so any closure forces one.
  if (closed.size || linesNow > liveNow * 1.25 || bytes > 0x1fffffe8 * 0.75) {
    process.stderr.write(`  compacting ${linesNow.toLocaleString()} rows down to ${liveNow.toLocaleString()} postings... `);
    const r = compactCorpus({ drop: closed });
    process.stderr.write(`${(r.bytesBefore / 1048576).toFixed(0)} MB → ${(r.bytesAfter / 1048576).toFixed(0)} MB\n`);
  }
}
// The description store is append-only too, and holds closed postings until it is
// rewritten. Same rule as the corpus: any closure, or a quarter of dead rows.
{
  const { rows, ids } = descriptionStats();
  if (closed.size || rows > ids * 1.25) {
    const live = new Set([...known.keys(), ...newIds]);
    for (const id of closed) live.delete(id);
    process.stderr.write(`  compacting descriptions.jsonl, ${rows.toLocaleString()} rows... `);
    const r = compactDescriptions({ keep: live });
    process.stderr.write(`${r.after.toLocaleString()} kept, ${(r.bytesBefore / 1048576).toFixed(0)} MB → ${(r.bytesAfter / 1048576).toFixed(0)} MB\n`);
  }
}
if (fresh + changed) console.log(`\nNext: npm run fitness`);
