// Join the scores back onto the postings they were scored from.
//
//   node show.js                 every scored posting, best first
//   node show.js docker          filter by company slug or title, with full detail
//   node show.js --queued        only what is in queue.jsonl
//   node show.js --unqueued      only what you have not queued
//   node show.js --full          include the whole job description
//   node show.js --history       every score a posting has received, not just the latest
//
// fitness.jsonl holds the judgements, postings.jsonl holds the postings. They join on
// posting id. Anything polled before postings.jsonl existed will show as "(posting
// detail not stored)" — the score is still there, only the description is missing.

import fs from 'node:fs';
import { P } from '../lib/paths.js';
import { tidy } from '../lib/text.js';

const fit = r => r.fitness ?? r.score;

const read = f => fs.existsSync(f)
  ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  : [];

const args    = process.argv.slice(2);
const flags   = new Set(args.filter(a => a.startsWith('--')));
const term    = args.filter(a => !a.startsWith('--')).join(' ').toLowerCase();
const FULL    = flags.has('--full');
const WHY     = flags.has('--why');
const HISTORY = flags.has('--history');

const postings = new Map(read(P.corpus).map(p => [p.id, p]));
const queued   = new Set(read(P.queue).map(r => r.id));
const applied  = new Set(read(P.log).map(r => r.job));

let scores = read(P.fitness);
if (!scores.length) { console.log('fitness.jsonl is empty — run fitness.js first.'); process.exit(0); }

// Newest score per posting, unless --history asks for all of them.
if (!HISTORY) {
  const latest = new Map();
  for (const s of scores) {
    const prev = latest.get(s.id);
    if (!prev || (s.scoredAt ?? '') >= (prev.scoredAt ?? '')) latest.set(s.id, s);
  }
  scores = [...latest.values()];
}

let rows = scores.map(s => ({ s, p: postings.get(s.id) }));

if (flags.has('--queued'))   rows = rows.filter(r => queued.has(r.s.id));
if (flags.has('--unqueued')) rows = rows.filter(r => !queued.has(r.s.id) && !applied.has(r.s.id));
if (term) {
  rows = rows.filter(({ s, p }) =>
    [s.title, s.slug, p?.department, p?.team].filter(Boolean).join(' ').toLowerCase().includes(term));
}

rows.sort((a, b) => (fit(b.s) - fit(a.s)) || (b.s.scoredAt ?? '').localeCompare(a.s.scoredAt ?? ''));

if (!rows.length) { console.log(term ? `nothing matching "${term}"` : 'nothing to show'); process.exit(0); }

const state = id => applied.has(id) ? 'APPLIED' : queued.has(id) ? 'QUEUED' : '-';
const pay = ({ s, p }) => s.salary?.summary ?? p?.salary?.summary ?? (s.pay_ok === 'not_stated' ? 'not stated' : 'not stated');

// --why is the middle setting: reasoning for everything, without the descriptions.
if (WHY) {
  console.log();
  for (const r of rows) {
    const { s } = r;
    console.log(`  ${fit(s).toFixed(2)}  ${state(s.id).padEnd(8)} ${s.title} — ${s.slug}  (${pay(r)})`);
    console.log(`        ${s.why}`);
    for (const c of s.concerns ?? []) console.log(`        · ${c}`);
    console.log();
  }
  console.log(`  ${rows.length} postings
`);
  process.exit(0);
}

// A term or --full means you want to read one; otherwise a scannable list.
const detail = term || FULL;

if (!detail) {
  console.log();
  for (const r of rows) {
    console.log(
      `  ${fit(r.s).toFixed(2)}  ${state(r.s.id).padEnd(8)} ${r.s.title.slice(0, 46).padEnd(47)}` +
      `${r.s.slug.padEnd(14)}${pay(r)}`);
  }
  console.log(`\n  ${rows.length} postings · ${[...queued].length} queued · ${applied.size} applied` +
              `\n  node show.js <company> for detail\n`);
} else {
  for (const r of rows) {
    const { s, p } = r;
    console.log('\n' + '─'.repeat(78));
    console.log(`${s.title}  —  ${s.slug}`);
    console.log(`${state(s.id)} · fitness ${fit(s).toFixed(2)} · judged ${s.scoredAt?.slice(0, 16)} by ${s.model ?? '?'}`);
    console.log();
    console.log(`  location   ${s.location ?? p?.location ?? '?'}` +
      (p?.secondaryLocations && p.secondaryLocations !== p.location ? `  (also: ${p.secondaryLocations})` : ''));
    console.log(`  pay        ${pay(r)}${s.pay_ok ? `  [model: ${s.pay_ok}]` : ''}`);
    if (p) {
      console.log(`  team       ${p.department ?? '?'} / ${p.team ?? '?'}`);
      console.log(`  type       ${p.employmentType ?? '?'} · ${p.workplaceType ?? '?'}`);
      console.log(`  posted     ${p.publishedAt?.slice(0, 10) ?? '?'}`);
    }
    console.log(`  apply      ${s.applyUrl ?? p?.applyUrl ?? '?'}`);
    console.log();
    console.log(`  why        ${s.why}`);
    if (s.concerns?.length) {
      console.log(`  concerns   ${s.concerns[0]}`);
      for (const c of s.concerns.slice(1)) console.log(`             ${c}`);
    }

    if (!p) {
      console.log('\n  (posting detail not stored — polled before postings.jsonl existed)');
      continue;
    }
    if (FULL) {
      console.log('\n' + '─'.repeat(78));
      console.log(tidy(p.descriptionPlain) || '(no description)');
    } else {
      const d = (p.descriptionPlain || '').replace(/\n{2,}/g, '\n').trim();
      console.log('\n  ' + (d ? d.slice(0, 600).split('\n').join('\n  ') + (d.length > 600 ? '\n\n  … node show.js ' + s.slug + ' --full' : '') : '(no description)'));
    }
  }
  console.log();
}
