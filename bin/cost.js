// What the model calls have actually cost.
//
//   npm run cost              the whole log, by what spends it
//   npm run cost -- --last    just the most recent run
//   npm run cost -- --runs    one line per run, so concurrent ones stay apart
//   npm run cost -- --batch   the same totals repriced at the Batch API's 50%
//
// Reads data/usage.jsonl, which lib/ai.js appends to per call. Before that existed
// the bill could only be estimated by reading the code, and the biggest line item was
// invisible that way: Sonnet 5 runs adaptive thinking, thinking bills as output, and
// thinking tokens never appear in the scores we store.

import fs from 'node:fs';
import { P } from '../lib/paths.js';
import { summarise, PRICES } from '../lib/cost.js';

const argv = process.argv.slice(2);
const LAST = argv.includes('--last');
const RUNS = argv.includes('--runs');
const BATCH = argv.includes('--batch');

const rows = fs.existsSync(P.usage)
  ? fs.readFileSync(P.usage, 'utf8').split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
  : [];

if (!rows.length) {
  console.log('no usage recorded yet — data/usage.jsonl is written as scoring runs happen');
  process.exit(0);
}

if (RUNS) {
  // Grouped by the id lib/ai.js stamps per process — two runs at once do not blend.
  const by = new Map();
  for (const r of rows) {
    const k = r.run ?? '(before run ids)';
    const acc = by.get(k) ?? { run: k, from: r.at, to: r.at, rows: [] };
    acc.to = r.at; acc.rows.push(r);
    by.set(k, acc);
  }
  console.log('  ' + 'run'.padEnd(18) + 'calls'.padStart(7) + 'cost'.padStart(11) + '   window');
  for (const a of by.values()) {
    const { total: t } = summarise(a.rows);
    console.log('  ' + a.run.padEnd(18) + String(a.rows.length).padStart(7) +
      ('$' + t.toFixed(2)).padStart(11) +
      `   ${a.from.slice(11, 16)} → ${a.to.slice(11, 16)}`);
  }
  process.exit(0);
}

// A "run" is a cluster of calls with no gap longer than five minutes. Good enough to
// answer "what did the thing I just ran cost", without tracking run ids.
let use = rows;
if (LAST) {
  const GAP = 5 * 60_000;
  let start = rows.length - 1;
  for (let i = rows.length - 1; i > 0; i--) {
    if (new Date(rows[i].at) - new Date(rows[i - 1].at) > GAP) { start = i; break; }
    start = 0;
  }
  use = rows.slice(start);
}

const priced = BATCH ? use.map(r => ({ ...r, batch: true })) : use;
const { total, byLabel } = summarise(priced);

const money = n => '$' + (n < 0.01 ? n.toFixed(5) : n.toFixed(2));
const from = use[0]?.at?.slice(0, 16).replace('T', ' ');
const to = use[use.length - 1]?.at?.slice(0, 16).replace('T', ' ');

console.log(`${use.length} calls · ${from} → ${to}${BATCH ? '  (repriced at the batch rate)' : ''}\n`);
console.log('  ' + 'what'.padEnd(18) + 'calls'.padStart(7) + 'items'.padStart(8) +
            'cost'.padStart(11) + 'per item'.padStart(11) + 'share'.padStart(7) + '   cache hit');
for (const r of byLabel) {
  console.log('  ' + r.label.padEnd(18) +
    String(r.calls).padStart(7) + String(r.items).padStart(8) +
    money(r.cost).padStart(11) + money(r.perItem).padStart(11) +
    (Math.round(r.share * 100) + '%').padStart(7) +
    '   ' + (r.cacheRead ? Math.round(r.cacheHitRate * 100) + '%' : '—'));
}
console.log('  ' + '-'.repeat(62));
console.log('  ' + 'total'.padEnd(18) + ''.padStart(15) + money(total).padStart(11));

// Output includes thinking, which is why it is worth showing separately: it is the
// part of the bill that no stored result can account for.
console.log('\n  tokens');
for (const r of byLabel) {
  console.log(`    ${r.label.padEnd(18)} in ${r.input.toLocaleString().padStart(10)} · ` +
    `cached ${r.cacheRead.toLocaleString().padStart(10)} · out ${r.output.toLocaleString().padStart(9)}`);
}

if (!BATCH) {
  const { total: batched } = summarise(use.map(r => ({ ...r, batch: true })));
  console.log(`\n  at the Batch API's 50%: ${money(batched)}  (saves ${money(total - batched)})`);
}
console.log(`\n  rates checked ${PRICES.checkedOn} — see platform.claude.com/docs/en/about-claude/pricing`);
