// Pipeline 2, stage 2 — embed anything in the corpus that is not already embedded.
//
//   node embed.js           embed new/changed postings and the resume
//   node embed.js --dry     report what would be embedded, call nothing
//   node embed.js --force   re-embed everything (after changing the model or embedText)
//
// Nothing is embedded twice. Each vector is stored against the content hash of the
// exact text it was made from, so a posting that gets re-listed unchanged is skipped,
// and one whose description was edited is re-embedded automatically.

import { corpus, embedText, hash } from '../lib/corpus.js';
import { embedAll, EMBED_MODEL } from '../lib/embed.js';
import { resumeText } from '../lib/resume-text.js';
import * as vec from '../lib/vec.js';

const DRY = process.argv.includes('--dry');
const FORCE = process.argv.includes('--force');

const jobs = corpus();
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

console.log(`corpus: ${jobs.size} postings`);
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
  const t0 = Date.now();
  const CHUNK = 480;   // append every ~5 batches so a crash does not lose the run
  for (let i = 0; i < pending.length; i += CHUNK) {
    const slice = pending.slice(i, i + CHUNK);
    const vecs = await embedAll(slice.map(p => p.text), (done) => {
      const n = i + done;
      const rate = n / ((Date.now() - t0) / 1000);
      process.stderr.write(`  ${n}/${pending.length}  ${rate.toFixed(0)}/s   \r`);
    });
    vec.append(slice.map((p, k) => ({ key: p.key, hash: p.hash, model: EMBED_MODEL, v: vec.normalise(vecs[k]) })));
  }
  process.stderr.write('\n');
  console.log(`${pending.length} postings embedded in ${Math.round((Date.now() - t0) / 1000)}s`);
}

console.log(`\nvectors.jsonl now holds ${vec.load().size} vectors\n\nNext: npm run ui`);
