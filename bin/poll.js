// Stage 1 — poll every board in slugs.txt, emit postings we have not judged before.
//
//   node poll.js           normal daily run
//   node poll.js --seed    mark everything currently posted as seen, write nothing
//   node poll.js --rejudge ignore seen.json and re-emit every current match
//                          (use after changing the filters below)

import fs from 'node:fs';
import { P } from '../lib/paths.js';
import { payPasses } from '../lib/comp.js';
import { minimumBase, constraintLines } from '../lib/constraints.js';
import { tidy } from '../lib/text.js';
import { wantedTitle, usLocation } from '../lib/filters.js';

// ---- filters -------------------------------------------------------------
const MIN_PAY = minimumBase();                 // USD/year, annualised — read from context.md
// Drop postings older than this many days. 0 disables it.
// Freshness otherwise comes from seen.json (new = not judged before), which is
// enough for a daily run — but every time you add slugs, that company's entire
// back catalogue arrives at once, and a role that has been open 5 months is
// usually evergreen, backfilled, or hard to fill for a reason.
const MAX_AGE_DAYS = 0;
// Named non-US places. A "Remote" posting still has a region in practice, and
// "Remote - European Union" is not a job you can take from Iowa.
const BLOCK_LOC = /\b(tokyo|japan|seoul|korea|singapore|delhi|india|bangalore|abu dhabi|dubai|uae|london|uk\b|united kingdom|dublin|ireland|paris|france|berlin|munich|germany|amsterdam|netherlands|zurich|switzerland|stockholm|sweden|oslo|norway|copenhagen|denmark|madrid|barcelona|spain|milan|rome|italy|warsaw|poland|lisbon|portugal|tel aviv|israel|sydney|melbourne|australia|toronto|vancouver|canada|são paulo|brazil|mexico city|european union|europe|european|emea|apac|latam|remote - eu)\b/i;
// -------------------------------------------------------------------------

const CONCURRENCY = 6;
const SEED    = process.argv.includes('--seed');
const REJUDGE = process.argv.includes('--rejudge');

const slugs = [...new Set(
  fs.readFileSync(P.slugs, 'utf8').split('\n').map(s => s.trim().toLowerCase()).filter(Boolean)
)];

// seen.json: { "<posting id>": "<iso date first observed>" }
const seen = fs.existsSync(P.seen) ? JSON.parse(fs.readFileSync(P.seen, 'utf8')) : {};
const today = new Date().toISOString();

const fresh = [];
let ok = 0, dead = 0, scanned = 0;

if (!SEED) {
  console.log(`pay floor: ${MIN_PAY ? '$' + MIN_PAY.toLocaleString() + '/yr (from context.md)' : 'none'}` +
              (MAX_AGE_DAYS > 0 ? ` · max age: ${MAX_AGE_DAYS}d` : ''));
  for (const l of constraintLines()) console.log(`  ${l}`);
  console.log();
}

async function pollSlug(slug) {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`;
  let jobs;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) { dead++; if (r.status !== 404) console.warn(`  ✗ ${slug} HTTP ${r.status}`); return; }
    ({ jobs = [] } = await r.json());
  } catch (e) { dead++; console.warn(`  ✗ ${slug} ${e.message}`); return; }

  ok++; scanned += jobs.length;

  for (const j of jobs) {
    const known = j.id in seen;
    if (known && !REJUDGE) continue;
    if (!known) seen[j.id] = today;
    if (SEED) continue;

    if (!wantedTitle(j.title)) continue;

    const locs = [j.location, ...(j.secondaryLocations ?? []).map(l => l.location)].filter(Boolean).join(' | ');

    // Coarse net: anywhere in the US, remote or not. Whether an onsite role in
    // San Francisco is actually takeable is a judgement against the candidate's
    // constraints, and score.js makes it with the full posting in hand — this
    // filter only exists to keep Seoul and London out of the scoring bill.
    //
    // Note isRemote is useless for this: it is true on Hybrid postings too (68 of
    // one 92-posting sample were workplaceType "Hybrid" with isRemote true), which
    // is why the abroad check reads the location text rather than trusting a flag.
    // The primary location decides. Testing the combined string lets a London or
    // Toronto role through on the strength of a US city in secondaryLocations —
    // that is where the job is *also* hiring, not where this posting sits.
    if (!usLocation(j.location, locs)) continue;

    if (MAX_AGE_DAYS > 0 && j.publishedAt) {
      const ageDays = (Date.now() - new Date(j.publishedAt)) / 86_400_000;
      if (ageDays > MAX_AGE_DAYS) continue;
    }

    const pay = payPasses(j, MIN_PAY);
    if (!pay.pass) continue;

    fresh.push({
      slug, id: j.id, title: j.title,
      department: j.department, team: j.team,
      location: j.location, secondaryLocations: locs,
      isRemote: j.isRemote, workplaceType: j.workplaceType,
      employmentType: j.employmentType, publishedAt: j.publishedAt,
      jobUrl: j.jobUrl, applyUrl: j.applyUrl,
      salary: pay.salary, payKnown: pay.known,
      descriptionPlain: tidy(j.descriptionPlain),
    });
  }
}

// Simple worker pool — 6 in flight is polite and finishes 2k slugs in ~2 min.
const queue = slugs.slice();
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) await pollSlug(queue.shift());
}));

fs.writeFileSync(P.seen, JSON.stringify(seen, null, 0));

if (SEED) {
  console.log(`seeded: ${Object.keys(seen).length} postings marked seen across ${ok} boards (${dead} dead)`);
} else {
  // fresh.jsonl is a work queue that score.js truncates once consumed. postings.jsonl
  // is the durable copy — full record, description included — so a scored posting can
  // still be read back later without re-fetching the board.
  if (fresh.length) {
    const lines = fresh.map(j => JSON.stringify(j)).join('\n') + '\n';
    fs.appendFileSync(P.fresh, lines);
    fs.appendFileSync(P.postings, lines);
  }
  console.log(`${ok} boards ok, ${dead} dead, ${scanned} postings scanned → ${fresh.length} new matches`);
  for (const j of fresh) {
    console.log(`  ${j.title}  —  ${j.slug}  —  ${j.location}${j.salary ? '  —  ' + j.salary.summary : '  —  (no pay stated)'}`);
  }
}
