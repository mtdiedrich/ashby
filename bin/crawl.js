// Pipeline 2, stage 1 — pull EVERY posting from every board, unfiltered.
//
//   node crawl.js            fetch all boards, add new/changed postings to corpus.jsonl
//   node crawl.js --stats    just report what is already stored
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
import { tidy } from '../lib/text.js';
import { corpus, embedText, hash, rawLineCount } from '../lib/corpus.js';

const CONCURRENCY = 8;
const STATS_ONLY = process.argv.includes('--stats');

if (STATS_ONLY) {
  const c = corpus();
  const bySlug = {};
  for (const p of c.values()) bySlug[p.company] = (bySlug[p.company] ?? 0) + 1;
  console.log(`corpus.jsonl: ${c.size} postings across ${Object.keys(bySlug).length} boards`);
  console.log(`  raw lines (incl. revisions): ${rawLineCount()}`);
  const top = Object.entries(bySlug).sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [s, n] of top) console.log(`  ${String(n).padStart(4)}  ${s}`);
  process.exit(0);
}

const slugs = [...new Set(
  fs.readFileSync(P.slugs, 'utf8').split('\n').map(s => s.trim().toLowerCase()).filter(Boolean)
)];

const known = corpus();
const now = new Date().toISOString();
const added = [];
let ok = 0, dead = 0, seenTotal = 0, unchanged = 0;

async function crawlSlug(slug) {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`;
  let jobs;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) { dead++; return; }
    ({ jobs = [] } = await r.json());
  } catch { dead++; return; }

  ok++; seenTotal += jobs.length;

  for (const j of jobs) {
    const rec = {
      id: j.id,
      company: slug,
      title: j.title,
      department: j.department ?? null,
      team: j.team ?? null,
      location: j.location ?? '',
      secondaryLocations: (j.secondaryLocations ?? []).map(l => l.location).filter(Boolean).join(' | '),
      isRemote: j.isRemote ?? null,
      workplaceType: j.workplaceType ?? null,
      employmentType: j.employmentType ?? null,
      publishedAt: j.publishedAt ?? null,
      jobUrl: j.jobUrl,
      applyUrl: j.applyUrl,
      compensation: j.compensation ?? null,
      description: tidy(j.descriptionPlain),
      fetchedAt: now,
    };
    rec.hash = hash(embedText(rec));

    const prev = known.get(j.id);
    if (prev && prev.hash === rec.hash) { unchanged++; continue; }
    added.push(rec);
  }
}

const queue = slugs.slice();
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) await crawlSlug(queue.shift());
}));

if (added.length) {
  fs.appendFileSync(P.corpus, added.map(r => JSON.stringify(r)).join('\n') + '\n');
}

const fresh = added.filter(r => !known.has(r.id)).length;
console.log(`${ok} boards ok, ${dead} dead, ${seenTotal} postings seen`);
console.log(`  ${fresh} new, ${added.length - fresh} changed, ${unchanged} unchanged`);
console.log(`  corpus.jsonl now holds ${corpus().size} postings`);
if (added.length) console.log(`\nNext: npm run fitness`);
