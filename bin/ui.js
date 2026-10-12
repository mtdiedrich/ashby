// Local web UI — one board over every posting we know about.
//
//   node ui.js            serve on http://localhost:7777 and open a browser
//   node ui.js --port N   different port
//   node ui.js --no-open  don't launch a browser
//
// Two model scores per posting:
//
//   fitness     score.js     is the candidate qualified for this job (resume → role)
//   alignment   score.js     is this job a close match for the resume (role → resume);
//                            both are Jev's answers, asked in one request,
//                            given the whole posting and the resume
//
// combined with freshness into `value`, the default sort. (Embedding similarity, a
// Sonnet fitness judgement, a combined `score` and requirement coverage were all
// dropped 2026-10-02; see lib/jev-fitness.js for why coverage went.)
//
// A posting shows "-" for anything not computed yet, which is most of them most of
// the time — the corpus is thousands of postings and only the ones you have run
// through a scorer have numbers. Every posting is listed regardless.
//
// Files are re-read per request so the board is always current; leave it running
// while poll / fitness do their thing and refresh.
//
// Queueing writes queue.jsonl, and nothing else ever does. apply.js reads only that.
//
// No dependencies and no CDN — it works with the laptop offline.

import http from 'node:http';
import { P } from '../lib/paths.js';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { tidy } from '../lib/text.js';
import { corpus, asPosting, hash, embedText, linesOf } from '../lib/corpus.js';
import { inUS, worklistRow } from '../lib/select.js';
import { appliedIds, openedIds } from '../lib/applog.js';
import { adapterFor, postingUrl, workplaceOf } from '../lib/ats.js';
import { summaryOf, detailOf, byValue, payForRow } from '../lib/board-row.js';
import { statedPay } from '../lib/pay-text.js';
import { describe, splitRecord } from '../lib/descriptions.js';
import { appendRows } from '../lib/jsonl.js';
import { estimatesById } from '../lib/levels.js';
import { composite } from '../lib/composite.js';
import { salaryOf } from '../lib/comp.js';

const argv = process.argv.slice(2);
const PORT = argv.includes('--port') ? Number(argv[argv.indexOf('--port') + 1]) : 7777;
const OPEN = !argv.includes('--no-open');

// Parsed rows per file, cached on size and mtime. fresh.jsonl is every unscored
// posting — 225,000 rows, 122 MB — and re-parsing it and jev-fitness.jsonl on every
// request was most of a five-second board load. Callers must not mutate the result.
const readCache = new Map();
function read(f) {
  if (!fs.existsSync(f)) return [];
  const st = fs.statSync(f), sig = `${st.size}:${st.mtimeMs}`;
  const hit = readCache.get(f);
  if (hit?.sig === sig) return hit.rows;
  const rows = [];
  for (const l of linesOf(f)) { try { rows.push(JSON.parse(l)); } catch {} }
  readCache.set(f, { sig, rows });
  return rows;
}
const writeJsonl = (f, rows) =>
  fs.writeFileSync(f, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));

/** Newest row per id. Re-runs supersede; they do not accumulate. */
function newestById(rows, stamp) {
  const m = new Map();
  for (const r of rows) {
    const prev = m.get(r.id);
    if (!prev || (r[stamp] ?? '') >= (prev[stamp] ?? '')) m.set(r.id, r);
  }
  return m;
}

// corpus.jsonl is ~190MB and 246,000 postings — a full parse is about 1.5 seconds.
// It was re-read on every request, which put 1.5s on each board load AND on every
// row you expand. It only changes when crawl runs, so cache it on mtime.
let ccache = { mtime: 0, map: null };
function corpusCached() {
  const stat = fs.existsSync(P.corpus) ? fs.statSync(P.corpus) : null;
  if (!stat) return new Map();
  if (ccache.map && ccache.mtime === stat.mtimeMs) return ccache.map;
  ccache = { mtime: stat.mtimeMs, map: corpus() };
  return ccache.map;
}

// Pay stated in a description. Crawl reads it once into the row's `descPay`; a row
// from before that is parsed here, once, keyed on the record object so it lives
// exactly as long as corpusCached() keeps that record.
const textPayCache = new WeakMap();
function textPayOf(c) {
  if (!textPayCache.has(c)) textPayCache.set(c, statedPay(c));
  return textPayCache.get(c);
}

/** Every posting we know about, with whichever of the numbers exist. */
// The default limit covers the whole filtered candidate set (about 2,900) rather
// than truncating it. A lean row is ~340 bytes, so all of them is under a megabyte —
// which is only affordable because descriptions moved to /api/detail.
function board({ remote = false, scoredOnly = false, limit = 5000 } = {}) {
  const corp = corpusCached();

  const queued = new Set(read(P.queue).map(r => r.id));
  // Applied means you told apply.js you submitted it. Opening a tab and closing it
  // without sending anything is its own state — counting that as applied made the
  // board claim applications that were never made.
  const log = read(P.log);
  const applied = appliedIds(log);
  const opened = openedIds(log);
  const staged = new Set(read(P.fresh).map(r => r.id));
  const dismissed = new Set(read(P.dismissed).map(r => r.id));
  // levels.fyi estimates, written by `npm run levels`. Display only.
  const estimates = estimatesById(read(P.payEstimates));
  // Fitness — Jev's "is the candidate qualified" — the one model score.
  const jevFit = newestById(read(P.jevFitness), 'at');

  // corpus.jsonl is the only store of postings now.
  const ids = new Set(corp.keys());

  const rows = [];
  for (const id of ids) {
    const c = corp.get(id);
    if (!c) continue;
    const p = asPosting(c, salaryOf);

    if (remote && workplaceOf(c) !== 'Remote') continue;
    // Non-US roles are not scored and not shown — the same rule as the worklist.
    if (!inUS(c)) continue;

    const f = jevFit.get(id);
    if (scoredOnly && !f) continue;

    rows.push({
      id,
      title: p.title,
      slug: p.slug,
      location: p.location || '',
      workplaceType: workplaceOf(c),
      employmentType: p.employmentType ?? null,
      department: p.department ?? null,
      team: p.team ?? null,
      publishedAt: p.publishedAt ?? null,
      daysLive: p.publishedAt ? Math.round((Date.now() - new Date(p.publishedAt)) / 86400000) : null,
      applyUrl: p.applyUrl ?? null,
      jobUrl: p.jobUrl ?? null,
      ats: c.ats ?? 'ashby',
      // apply.js only knows Ashby's form DOM; anything else you fill yourself.
      fillable: (c.ats ?? 'ashby') === 'ashby',
      // The posting's pay field, else pay its description states, else an estimate.
      ...payForRow(p.salary?.summary ?? null, p.salary ? null : textPayOf(c), estimates.get(id)),

      // null, not 0 — "not computed" and "computed as zero" are different facts.

      fitness: f?.fitness ?? null,
      // Since 2026-10-12; null on an answer to the one-question version, until re-asked.
      alignment: f?.alignment ?? null,

      state: applied.has(id) ? 'applied' : opened.has(id) ? 'opened'
           : queued.has(id) ? 'queued'
           : dismissed.has(id) ? 'dismissed' : staged.has(id) ? 'staged'
           : f ? 'judged' : 'unseen',
    });
  }

  // Normalise across the filtered set, not the whole corpus: the total ranks within
  // what you are actually looking at, and re-scales when you change the filters.
  const scored = composite(rows);

  // Ordered the way the page orders it. Sorting here by a score (fitness, back then)
  // and slicing the top N, while the page sorted what it got by value, meant every
  // posting under two days old fell below the cutoff and was never sent — the board's freshest
  // row read two days old while seven newer ones sat on disk.
  scored.sort(byValue);

  return {
    // Lean rows only. Shipping descriptions and requirement evidence for every row
    // made one response 5.8 MB, and the page rebuilt all of it as HTML on every
    // keystroke. The pane fetches its own detail when a row is opened.
    jobs: scored.slice(0, limit).map(summaryOf),
    total: scored.length,
    counts: {
      fitness: scored.filter(r => r.fitness != null).length,
      alignment: scored.filter(r => r.alignment != null).length,
      value: scored.filter(r => r.value != null).length,
      queued: scored.filter(r => r.state === 'queued').length,
      applied: scored.filter(r => r.state === 'applied').length,
      opened: scored.filter(r => r.state === 'opened').length,
    },
    generatedAt: new Date().toISOString(),
  };
}

/** Stage a posting into fresh.jsonl so score.js picks it up next run. */
async function stage(id) {
  const c = corpusCached().get(id);
  if (!c) return { ok: false, error: 'not in the corpus' };
  if (read(P.fresh).some(r => r.id === id)) return { ok: true, already: true };

  // The crawl stores every description, but one not crawled since the store existed
  // may have none. Fetch it first — scoring an empty description would produce a
  // confident number about nothing, which is worse than refusing.
  let fetched = false;
  if (!describe(c).trim()) {
    const full = await fetchDescription(c);
    if (!full) return { ok: false, error: 'could not fetch the description for that posting' };
    full.hash = hash(embedText(full));
    appendRows(P.descriptions, [splitRecord(full).desc]);
    fetched = true;
  }

  appendRows(P.fresh, [worklistRow(c)]);
  return { ok: true, fetched };
}

/**
 * Re-fetch one posting so it has a description again.
 * Greenhouse serves a single posting; Ashby only serves whole boards, so that call
 * comes back with everything and the one we want is picked out of it.
 */
async function fetchDescription(rec) {
  const ats = adapterFor(rec);
  try {
    const r = await fetch(postingUrl(ats, rec.company, rec.id), { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) return null;
    const body = await r.json();
    const raw = ats.id === 'greenhouse'
      ? body
      : ats.postingsFrom(body).find(j => String(j.id) === String(rec.id));
    if (!raw) return null;
    const fresh = ats.normalize(raw, rec.company, new Date().toISOString());
    return fresh.description ? fresh : null;
  } catch { return null; }
}

/** Say no to a posting so poll stops proposing it. Replaces the old seen.json. */
function setDismissed(id, wanted) {
  const rows = read(P.dismissed).filter(r => r.id !== id);
  if (wanted) rows.push({ id, at: new Date().toISOString() });
  writeJsonl(P.dismissed, rows);
  return { ok: true };
}

/**
 * Add or remove a posting from queue.jsonl — the only thing that ever writes it.
 * Scoring ranks; queueing is a decision, and decisions are made here by a person.
 */
function setQueued(id, wanted) {
  const queue = read(P.queue).filter(r => r.id !== id);
  if (!wanted) { writeJsonl(P.queue, queue); return { ok: true }; }

  // The posting itself, in the shape apply.js reads. This used to prefer the fitness
  // record, which carried the same posting fields plus the judgement.
  const c = corpusCached().get(id);
  const row = c ? asPosting(c, salaryOf) : null;
  if (!row) return { ok: false, error: 'nothing on record for that posting' };

  writeJsonl(P.queue, [...queue, row]);
  return { ok: true };
}

const server = http.createServer((req, res) => {
  const send = (code, type, body) => { res.writeHead(code, { 'content-type': type }); res.end(body); };

  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
    if (!fs.existsSync(P.uiHtml)) return send(500, 'text/plain', 'ui.html is missing');
    return send(200, 'text/html; charset=utf-8', fs.readFileSync(P.uiHtml));
  }

  if (req.method === 'GET' && req.url.startsWith('/api/board')) {
    const q = new URL(req.url, 'http://x').searchParams;
    return send(200, 'application/json', JSON.stringify(board({
      remote: q.get('remote') === '1',
      scoredOnly: q.get('scored') === '1',
      limit: Math.min(Number(q.get('limit')) || 5000, 20000),
    })));
  }

  // The expanded pane's content, for one posting. Fetched on expand rather than
  // shipped with every row — descriptions and requirement evidence were 5.1 MB of a
  // 5.8 MB board response, for panes that are hidden until you open them.
  if (req.method === 'GET' && req.url.startsWith('/api/detail')) {
    const id = new URL(req.url, 'http://x').searchParams.get('id');
    const c = corpusCached().get(id);
    if (!c) return send(404, 'application/json', JSON.stringify({ error: 'not in the corpus' }));

    const p = asPosting(c, salaryOf);
    return send(200, 'application/json', JSON.stringify(detailOf({
      description: tidy(describe(c)),
      // The sentence the pay column's figure came from, when it came from the text.
      payText: p.salary ? null : (textPayOf(c)?.text ?? null),
      applyUrl: p.applyUrl, jobUrl: p.jobUrl,
      department: p.department, team: p.team,
      workplaceType: workplaceOf(c), employmentType: p.employmentType,
    })));
  }

  const readBody = () => new Promise((resolve, reject) => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
  });

  if (req.method === 'POST' && req.url === '/api/queue') {
    readBody().then(({ id, queued }) => send(200, 'application/json', JSON.stringify(setQueued(id, !!queued))))
              .catch(e => send(400, 'application/json', JSON.stringify({ ok: false, error: e.message })));
    return;
  }

  if (req.method === 'POST' && req.url === '/api/dismiss') {
    readBody().then(({ id, dismissed }) => send(200, 'application/json', JSON.stringify(setDismissed(id, !!dismissed))))
              .catch(e => send(400, 'application/json', JSON.stringify({ ok: false, error: e.message })));
    return;
  }

  if (req.method === 'POST' && req.url === '/api/stage') {
    readBody().then(({ id }) => stage(id))
      .then(r => send(200, 'application/json', JSON.stringify(r)))
              .catch(e => send(400, 'application/json', JSON.stringify({ ok: false, error: e.message })));
    return;
  }

  send(404, 'text/plain', 'not found');
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  const b = board({ limit: 1 });
  console.log(`ashby ui on ${url}`);
  console.log(`  ${b.total} postings · ${b.counts.fitness} with fitness`);
  console.log('ctrl-c to stop');
  if (OPEN) spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
});
