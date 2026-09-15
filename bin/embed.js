// Embed the staged postings and the resume, so similarity can be scored.
//
//   npm run similarity              embed anything on the worklist without a vector
//   npm run similarity -- --dry     report what would be embedded, call nothing
//   npm run similarity -- --force   re-embed regardless (after changing the model)
//   npm run similarity -- --corpus  embed the whole corpus, not just the worklist
//
// Works off fresh.jsonl, the same worklist fitness and coverage read. The corpus runs
// to tens of thousands of postings and embedding all of them to score a hundred is
// waste — --corpus is there if you want the wider net back.
//
// Nothing is embedded twice. Each vector is stored against the content hash of the
// exact text it was made from, so a posting re-listed unchanged is skipped and one
// whose description was edited re-embeds automatically.

import fs from 'node:fs';
import { P } from '../lib/paths.js';
import { corpus, embedText, hash } from '../lib/corpus.js';
import { embedAll, EMBED_MODEL } from '../lib/embed.js';
import { resumeText } from '../lib/resume-text.js';
import * as vec from '../lib/vec.js';
import { progress } from '../lib/progress.js';

const DRY = process.argv.includes('--dry');
const FORCE = process.argv.includes('--force');
const WHOLE_CORPUS = process.argv.includes('--corpus');

const readJsonl = f => fs.existsSync(f)
  ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
  : [];

// The worklist by default — the same postings fitness and coverage score. embedText
// reads either record shape, so a posting hashes the same whether it came from
// fresh.jsonl or the corpus, and switching between them re-embeds nothing.
const jobs = WHOLE_CORPUS
  ? corpus()
  : new Map(readJsonl(P.fresh).map(j => [j.id, j]));

if (!jobs.size) {
  console.log(WHOLE_CORPUS ? 'corpus is empty — run: npm run poll'
                           : 'fresh.jsonl is empty — run: npm run poll');
  process.exit(0);
}
const stored = vec.load();

// ---- what needs doing --------------------------------------------------
const pending = [];
let upToDate = 0;

for (const [id, p] of jobs) {
  const key = `job:${id}`;
  const text = embedText(p);
  const h = p.hash ?? hash(text);
  const have = stored.get(key);
  if (!FORCE && have && have.hash === h && have.model === EMBED_MODEL) { upToDate++; continue; }
  pending.push({ key, hash: h, text, why: have ? 'changed' : 'new' });
}

console.log(`${jobs.size} postings ${WHOLE_CORPUS ? 'in the corpus' : 'on the worklist'}`);
console.log(`  already embedded: ${upToDate}`);
console.log(`  to embed:         ${pending.length}` +
  (pending.length ? `  (${pending.filter(p => p.why === 'new').length} new, ${pending.filter(p => p.why === 'changed').length} changed)` : ''));

const chars = pending.reduce((a, p) => a + p.text.length, 0);
if (pending.length) {
  console.log(`  ~${Math.round(chars / 4 / 1000)}k tokens, ~$${(chars / 4 / 1e6 * 0.02).toFixed(3)}`);
}

// ---- resume ------------------------------------------------------------
let resumePending = null;
{
  const text = await resumeText();
  const h = hash(text);
  const have = stored.get('resume');
  if (FORCE || !have || have.hash !== h || have.model !== EMBED_MODEL) {
    resumePending = { key: 'resume', hash: h, text };
    console.log(`  resume:           needs embedding (${text.length} chars)`);
  } else {
    console.log(`  resume:           up to date`);
  }
}

if (DRY) { console.log('\n--dry, nothing called'); process.exit(0); }
if (!pending.length && !resumePending) { console.log('\nnothing to do'); process.exit(0); }

// ---- embed -------------------------------------------------------------
if (resumePending) {
  const [v] = await embedAll([resumePending.text]);
  vec.append([{ key: 'resume', hash: resumePending.hash, model: EMBED_MODEL, v: vec.normalise(v) }]);
  console.log('resume embedded');
}

if (pending.length) {
  const bar = progress(pending.length, 'embedding');
  // Persisted as each batch returns, so a failure part-way keeps everything bought
  // up to that point instead of throwing the whole run away.
  await embedAll(
    pending.map(p => p.text),
    done => bar.set(done),
    (start, vectors) => vec.append(vectors.map((v, k) => {
      const p = pending[start + k];
      return { key: p.key, hash: p.hash, model: EMBED_MODEL, v: vec.normalise(v) };
    })),
  );
  bar.finish();
}

console.log(`\nvectors.jsonl now holds ${vec.load().size} vectors\n\nNext: npm run ui`);
