// What do I keep missing?
//
//   node gaps.js                aggregate every requirement ever scored
//   node gaps.js --required     only must-haves
//   node gaps.js --slug abridge only one company
//   node gaps.js --since 2026-09-01
//   node gaps.js --cluster      group near-duplicate requirements with Haiku first
//   node gaps.js --csv out.csv  dump one row per requirement for your own analysis
//
// coverage.jsonl already records every requirement, its score, the evidence, whether it
// was a must-have, and the hash of the resume it was judged against. This reads that
// back and asks the question the per-posting view cannot: across everything, what do
// you actually fail, how often is it asked for, and is it getting better.
//
// Requirement text is free-form — "Kubernetes administration including CRDs" and
// "Experience with Kubernetes in production" are the same gap written twice. Without
// --cluster they are counted separately; with it, Haiku groups them once and the
// grouping is cached.

import fs from 'node:fs';
import { P } from '../lib/paths.js';
import { z } from 'zod';
import { ask } from '../lib/ai.js';
import { hash } from '../lib/corpus.js';

const argv  = process.argv.slice(2);
const arg = n => { const i = argv.indexOf('--' + n); return i === -1 ? null : argv[i + 1]; };
const REQUIRED_ONLY = argv.includes('--required');
const CLUSTER = argv.includes('--cluster');
const SLUG  = arg('slug');
const SINCE = arg('since');
const CSV   = arg('csv');

const read = f => fs.existsSync(f)
  ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
  : [];

// Newest assessment per posting+resume pair — a re-score supersedes, it does not add.
const rows = (() => {
  const m = new Map();
  for (const r of read(P.coverage)) {
    const prev = m.get(r.key);
    if (!prev || (r.at ?? '') >= (prev.at ?? '')) m.set(r.key, r);
  }
  return [...m.values()];
})();

if (!rows.length) { console.log('coverage.jsonl is empty — run: npm run coverage'); process.exit(0); }

const kept = rows.filter(r =>
  (!SLUG || r.slug.includes(SLUG)) &&
  (!SINCE || (r.at ?? '') >= SINCE));

if (!kept.length) { console.log('nothing matches those filters'); process.exit(0); }

// ---- flatten to one row per requirement --------------------------------

const items = [];
for (const r of kept) {
  for (const q of r.requirements ?? []) {
    if (q.kind === 'logistics') continue;          // not a capability, never scored fairly
    if (REQUIRED_ONLY && !q.required) continue;
    items.push({
      slug: r.slug, title: r.title, at: r.at, resumeHash: r.resumeHash,
      text: q.text, kind: q.kind, required: q.required, score: q.score, evidence: q.evidence,
    });
  }
}

if (CSV) {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = ['slug,title,scored_at,resume_hash,requirement,kind,required,score,evidence'];
  for (const i of items) {
    lines.push([i.slug, i.title, i.at, i.resumeHash, i.text, i.kind, i.required, i.score, i.evidence].map(esc).join(','));
  }
  fs.writeFileSync(CSV, lines.join('\n') + '\n');
  console.log(`${items.length} requirement rows → ${CSV}`);
  process.exit(0);
}

// ---- optional clustering ------------------------------------------------

const Themes = z.object({
  themes: z.array(z.object({
    theme: z.string().describe('a short canonical name, e.g. "Kubernetes / container orchestration"'),
    members: z.array(z.number().int()).describe('indexes of the requirement texts in this theme'),
  })),
});

let themeOf = null;
if (CLUSTER) {
  const distinct = [...new Set(items.map(i => i.text))];
  const cacheKey = hash(distinct.join('\n'));
  const cached = read(P.themes)[0];

  if (cached?.key === cacheKey) {
    themeOf = new Map(cached.pairs);
    console.log(`(clustering cached: ${new Set(themeOf.values()).size} themes)\n`);
  } else {
    console.log(`clustering ${distinct.length} distinct requirements with Haiku...`);
    const { themes } = await ask(
      `Group job requirements that mean the same thing. "Kubernetes administration including CRDs"
and "Experience running Kubernetes in production" are one theme. Keep themes specific —
"PyTorch" and "distributed training" are different. Every index appears exactly once.
Name each theme in a handful of words.`,
      distinct.map((t, k) => `${k}. ${t}`).join('\n'),
      { schema: Themes, maxTokens: 8000, model: 'claude-haiku-4-5' },
    );
    themeOf = new Map();
    for (const t of themes) for (const m of t.members) if (distinct[m]) themeOf.set(distinct[m], t.theme);
    for (const t of distinct) if (!themeOf.has(t)) themeOf.set(t, t);   // anything it dropped
    fs.writeFileSync(P.themes, JSON.stringify({ key: cacheKey, pairs: [...themeOf] }) + '\n');
    console.log(`  ${new Set(themeOf.values()).size} themes\n`);
  }
}

const label = i => (themeOf?.get(i.text)) ?? i.text;

// ---- aggregate ----------------------------------------------------------

const groups = new Map();
for (const i of items) {
  const k = label(i);
  if (!groups.has(k)) groups.set(k, { label: k, n: 0, sum: 0, req: 0, zero: 0, kinds: new Set(), slugs: new Set() });
  const g = groups.get(k);
  g.n++; g.sum += i.score; g.kinds.add(i.kind); g.slugs.add(i.slug);
  if (i.required) g.req++;
  if (i.score <= 1) g.zero++;
}

const all = [...groups.values()].map(g => ({ ...g, mean: g.sum / g.n }));

const dist = [0, 0, 0, 0];
for (const i of items) dist[i.score]++;
const pct = n => `${(n / items.length * 100).toFixed(0)}%`;

console.log(`${kept.length} postings · ${items.length} requirements scored` +
  (REQUIRED_ONLY ? ' (must-haves only)' : '') + (SLUG ? ` · ${SLUG}` : ''));
console.log(`mean score ${(items.reduce((a, i) => a + i.score, 0) / items.length).toFixed(2)} / 3\n`);

console.log('score distribution');
const bar = n => '█'.repeat(Math.round(n / items.length * 40));
for (const s of [3, 2, 1, 0]) {
  const lbl = ['no evidence', 'adjacent', 'partial', 'direct'][s];
  console.log(`  ${s}  ${lbl.padEnd(12)} ${String(dist[s]).padStart(4)}  ${pct(dist[s]).padStart(4)}  ${bar(dist[s])}`);
}

// What you fail, ordered by how often it is asked for.
const missed = all.filter(g => g.mean < 1.5).sort((a, b) => b.n - a.n || a.mean - b.mean);
console.log(`\nasked for, and you do not have it  (mean < 1.5 of 3)`);
for (const g of missed.slice(0, 20)) {
  console.log(`  ${String(g.n).padStart(3)}×  ${g.mean.toFixed(2)}  ${g.req ? '[req]' : '     '} ${g.label.slice(0, 70)}`);
}
if (!missed.length) console.log('  (nothing)');

// What you have. Useful for knowing what to lead with.
const strong = all.filter(g => g.mean >= 2).sort((a, b) => b.n - a.n);
console.log(`\nasked for, and you have it  (mean >= 2 of 3)`);
for (const g of strong.slice(0, 12)) {
  console.log(`  ${String(g.n).padStart(3)}×  ${g.mean.toFixed(2)}  ${g.label.slice(0, 70)}`);
}
if (!strong.length) console.log('  (nothing)');

// By kind — is the gap skills, experience depth, domain, or credentials?
console.log('\nby kind');
const byKind = new Map();
for (const i of items) {
  if (!byKind.has(i.kind)) byKind.set(i.kind, { n: 0, sum: 0 });
  const k = byKind.get(i.kind); k.n++; k.sum += i.score;
}
for (const [k, v] of [...byKind].sort((a, b) => a[1].sum / a[1].n - b[1].sum / b[1].n)) {
  console.log(`  ${(v.sum / v.n).toFixed(2)}  ${k.padEnd(12)} ${v.n} requirements`);
}

// Did anything change when the resume changed?
const byResume = new Map();
for (const i of items) {
  if (!byResume.has(i.resumeHash)) byResume.set(i.resumeHash, { n: 0, sum: 0, first: i.at });
  const r = byResume.get(i.resumeHash); r.n++; r.sum += i.score;
  if (i.at < r.first) r.first = i.at;
}
if (byResume.size > 1) {
  console.log('\nby resume version');
  for (const [h, v] of [...byResume].sort((a, b) => a[1].first.localeCompare(b[1].first))) {
    console.log(`  ${(v.sum / v.n).toFixed(2)}  ${h}  ${v.first.slice(0, 10)}  ${v.n} requirements`);
  }
}

console.log(`\n${CLUSTER ? '' : 'Near-duplicates counted separately — npm run gaps -- --cluster to group them.\n'}` +
  `npm run gaps -- --csv gaps.csv for one row per requirement.`);
