// Local web UI — one board over every posting we know about.
//
//   node ui.js            serve on http://localhost:7777 and open a browser
//   node ui.js --port N   different port
//   node ui.js --no-open  don't launch a browser
//
// Three numbers, three different questions, side by side:
//
//   fitness     fitness.js   should I apply — a judgement weighing role shape,
//                            seniority, pay and your stated constraints
//   coverage    coverage.js  what fraction of the requirements this posting states
//                            can you actually demonstrate
//   similarity  embed.js     how close does this posting read to your resume
//
// A posting shows "-" for anything not computed yet, which is most of them most of
// the time — the corpus is thousands of postings and only the ones you have run
// through a scorer have numbers. Every posting is listed regardless.
//
// Files are re-read per request so the board is always current; leave it running
// while poll / fitness / coverage / embed do their thing and refresh.
//
// Queueing writes queue.jsonl, and nothing else ever does. apply.js reads only that.
//
// No dependencies and no CDN — it works with the laptop offline.

import http from 'node:http';
import { P } from '../lib/paths.js';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { tidy } from '../lib/text.js';
import { corpus, asPosting } from '../lib/corpus.js';
import { wantedTitle, usLocation } from '../lib/filters.js';
import { topUnscored } from '../lib/select.js';
import { appliedIds, openedIds } from '../lib/applog.js';
import { adapterFor, postingUrl } from '../lib/ats.js';
import { composite } from '../lib/composite.js';
import { salaryOf } from '../lib/comp.js';
import * as vec from '../lib/vec.js';

const argv = process.argv.slice(2);
const PORT = argv.includes('--port') ? Number(argv[argv.indexOf('--port') + 1]) : 7777;
const OPEN = !argv.includes('--no-open');

const read = f => fs.existsSync(f)
  ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
  : [];
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

// vectors.jsonl is ~35MB and the corpus mean is a full pass over it. Both are stable
// between embed.js runs, so cache on mtime rather than paying that on every request.
let vcache = { mtime: 0, stored: null, mu: null };
function vectors() {
  const stat = fs.existsSync(P.vectors) ? fs.statSync(P.vectors) : null;
  if (!stat) return null;
  if (vcache.stored && vcache.mtime === stat.mtimeMs) return vcache;
  const stored = vec.load();
  const mu = vec.mean([...stored].filter(([k]) => k.startsWith('job:')).map(([, r]) => r.v));
  vcache = { mtime: stat.mtimeMs, stored, mu };
  return vcache;
}

/** Every posting we know about, with whichever of the three numbers exist. */
function board({ all = false, us = false, remote = false, scoredOnly = false, limit = 600 } = {}) {
  const corp = corpus();

  const fit = newestById(read(P.fitness), 'scoredAt');
  const cov = newestById(read(P.coverage), 'at');
  const queued = new Set(read(P.queue).map(r => r.id));
  // Applied means you told apply.js you submitted it. Opening a tab and closing it
  // without sending anything is its own state — counting that as applied made the
  // board claim applications that were never made.
  const log = read(P.log);
  const applied = appliedIds(log);
  const opened = openedIds(log);
  const staged = new Set(read(P.fresh).map(r => r.id));
  const dismissed = new Set(read(P.dismissed).map(r => r.id));

  const v = vectors();
  const resumeV = v?.stored?.has('resume') ? vec.centre(v.stored.get('resume').v, v.mu) : null;

  // corpus.jsonl is the only store of postings now.
  const ids = new Set(corp.keys());

  const rows = [];
  for (const id of ids) {
    const c = corp.get(id);
    if (!c) continue;
    const p = asPosting(c, null, salaryOf);

    if (!all && !wantedTitle(p.title)) continue;
    if (remote && p.workplaceType !== 'Remote') continue;
    if (us && !usLocation(p.location, [p.location, p.secondaryLocations].filter(Boolean).join(' | '))) continue;

    const f = fit.get(id);
    const k = cov.get(id);
    if (scoredOnly && !f && !k) continue;
    const sv = resumeV ? v.stored.get(`job:${id}`) : null;

    rows.push({
      id,
      title: p.title,
      slug: p.slug,
      location: p.location || '',
      workplaceType: p.workplaceType ?? null,
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
      pay: p.salary?.summary ?? f?.salary?.summary ?? null,
      description: tidy(c.description ?? ''),

      // null, not 0 — "not computed" and "computed as zero" are different facts.
      fitness: f ? (f.fitness ?? f.score ?? null) : null,
      why: f?.why ?? null,
      concerns: f?.concerns ?? [],
      judgedAt: f?.scoredAt ?? null,
      fitnessModel: f?.model ?? null,

      coverage: k ? (k.coverage ?? k.fitness ?? null) : null,
      met: k?.met ?? null,
      reqTotal: k?.total ?? null,
      gaps: k?.gaps ?? [],
      constraints: k?.constraints ?? [],
      requirements: k?.requirements ?? [],

      similarity: sv ? vec.dot(resumeV, vec.centre(sv.v, v.mu)) : null,

      state: applied.has(id) ? 'applied' : opened.has(id) ? 'opened'
           : queued.has(id) ? 'queued'
           : dismissed.has(id) ? 'dismissed' : staged.has(id) ? 'staged'
           : (f || k) ? 'judged' : 'unseen',
    });
  }

  // Normalise across the filtered set, not the whole corpus: the total ranks within
  // what you are actually looking at, and re-scales when you change the filters.
  const scored = composite(rows);

  // Default order: judged postings first by fitness, then by similarity, then the rest.
  scored.sort((a, b) =>
    (b.fitness ?? -1) - (a.fitness ?? -1) ||
    (b.similarity ?? -9) - (a.similarity ?? -9));

  return {
    jobs: scored.slice(0, limit),
    total: scored.length,
    counts: {
      fitness: scored.filter(r => r.fitness != null).length,
      coverage: scored.filter(r => r.coverage != null).length,
      similarity: scored.filter(r => r.similarity != null).length,
      value: scored.filter(r => r.value != null).length,
      queued: scored.filter(r => r.state === 'queued').length,
      applied: scored.filter(r => r.state === 'applied').length,
      opened: scored.filter(r => r.state === 'opened').length,
    },
    generatedAt: new Date().toISOString(),
  };
}

/** Stage a posting into fresh.jsonl so fitness.js / coverage.js pick it up next run. */
async function stage(id) {
  const c = corpus().get(id);
  if (!c) return { ok: false, error: 'not in the corpus' };
  if (read(P.fresh).some(r => r.id === id)) return { ok: true, already: true };

  // The crawl keeps descriptions only for titles a scorer could see. Staging anything
  // else has to fetch one first — scoring an empty description would produce a
  // confident number about nothing, which is worse than refusing.
  let full = c;
  if (c.descriptionStored === false) {
    const fetched = await fetchDescription(c);
    if (!fetched) return { ok: false, error: 'could not fetch the description for that posting' };
    full = fetched;
  }

  const line = JSON.stringify(asPosting(full, null, salaryOf)) + '\n';
  fs.appendFileSync(P.fresh, line);
  return { ok: true, fetched: full !== c };
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
 * Stage the n highest-similarity postings that still need scoring. This is what
 * `match --to-fresh` used to do; the board could only ever stage one at a time.
 */
async function stageTop(n, opts) {
  const picked = topUnscored(board({ ...opts, limit: 6000 }).jobs, n);
  let staged = 0;
  // Sequential on purpose: each miss is a network fetch, and this is a button a
  // person pressed, not a batch job.
  for (const j of picked) { const r = await stage(j.id); if (r.ok && !r.already) staged++; }
  return { ok: true, staged, requested: n };
}

/**
 * Add or remove a posting from queue.jsonl — the only thing that ever writes it.
 * Scoring ranks; queueing is a decision, and decisions are made here by a person.
 */
function setQueued(id, wanted) {
  const queue = read(P.queue).filter(r => r.id !== id);
  if (!wanted) { writeJsonl(P.queue, queue); return { ok: true }; }

  // Prefer the judged record; fall back to the raw posting so you can queue something
  // on similarity alone, before fitness.js has ever looked at it.
  const judged = read(P.fitness).filter(r => r.id === id)
    .sort((a, b) => (a.scoredAt ?? '').localeCompare(b.scoredAt ?? '')).pop();
  const c = corpus().get(id);
  const row = judged ?? (c ? asPosting(c, null, salaryOf) : null);
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
      all: q.get('all') === '1',
      us: q.get('us') === '1',
      remote: q.get('remote') === '1',
      scoredOnly: q.get('scored') === '1',
      limit: Math.min(Number(q.get('limit')) || 600, 6000),
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

  if (req.method === 'POST' && req.url === '/api/stage-top') {
    readBody().then(({ n, us, remote, all }) => stageTop(Math.min(Number(n) || 25, 500), { us, remote, all }))
      .then(r => send(200, 'application/json', JSON.stringify(r)))
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
  console.log(`  ${b.total} postings · ${b.counts.fitness} with fitness · ` +
              `${b.counts.coverage} with coverage · ${b.counts.similarity} with similarity`);
  console.log('ctrl-c to stop');
  if (OPEN) spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
});
