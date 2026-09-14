// Embeddings via OpenAI text-embedding-3-small (1536 dims).
//
// Anthropic has no embeddings endpoint — Claude models do not emit vectors — so the
// vector half of this pipeline goes elsewhere. Haiku still does the text prep in
// lib/resume-text.js, which is the part it is actually good at.
//
// Raw fetch rather than the openai package: this is one POST to one endpoint, and
// the dependency would earn nothing.

import dotenv from 'dotenv';
// override: a stale OPENAI_API_KEY/ANTHROPIC_API_KEY in the machine's
// environment otherwise wins over .env and is silently used instead —
// dotenv does not replace existing vars by default, so a revoked key set
// months ago shadows the one you just pasted into .env and every call 401s.
dotenv.config({ override: true, quiet: true });

export const EMBED_MODEL = 'text-embedding-3-small';
export const EMBED_DIM = 1536;

const ENDPOINT = 'https://api.openai.com/v1/embeddings';
const MAX_BATCH = 64;              // inputs per request
const MAX_REQ_CHARS = 240_000;     // ~60k tokens, so one request cannot eat the window
const MAX_CHARS = 28_000;          // ~7k tokens, under the model's 8191 limit

const sleep = ms => new Promise(r => setTimeout(r, ms));

function key() {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new Error('OPENAI_API_KEY is not set — put it in .env');
  return k;
}

/** Long descriptions get the head and the tail: requirements live at the bottom. */
export function clip(text) {
  const t = String(text ?? '');
  if (t.length <= MAX_CHARS) return t;
  const head = Math.floor(MAX_CHARS * 0.7);
  const tail = MAX_CHARS - head - 20;
  return t.slice(0, head) + '\n...\n' + t.slice(-tail);
}

// The token-per-minute limit is the binding one, not requests per minute: a full
// 96-input batch of job descriptions is ~140k tokens, so eight back-to-back requests
// exhaust a 1M TPM allowance in seconds. The API reports what is left on every
// response — pace against that rather than firing blind and retrying into a wall.
let budget = { tokens: Infinity, resetMs: 0 };

function readLimits(res) {
  const rem = Number(res.headers.get('x-ratelimit-remaining-tokens'));
  const reset = res.headers.get('x-ratelimit-reset-tokens');
  if (Number.isFinite(rem)) budget.tokens = rem;
  if (reset) {
    const m = /^([\d.]+)(ms|s|m)$/.exec(reset.trim());
    const n = m ? Number(m[1]) : 0;
    budget.resetMs = m ? (m[2] === 'ms' ? n : m[2] === 's' ? n * 1000 : n * 60_000) : 0;
  }
}

async function post(inputs) {
  const estimate = inputs.reduce((a, t) => a + t.length, 0) / 4;

  // Wait out the window rather than spend the retry budget discovering it is full.
  if (budget.tokens < estimate) {
    const wait = Math.min(budget.resetMs + 500, 65_000);
    if (wait > 0) {
      process.stderr.write(`  rate limit: ${Math.round(budget.tokens / 1000)}k left, waiting ${Math.ceil(wait / 1000)}s\n`);
      await sleep(wait);
      budget.tokens = Infinity;
    }
  }

  let lastErr = '';
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key()}` },
      body: JSON.stringify({ model: EMBED_MODEL, input: inputs }),
    });
    readLimits(res);

    if (res.ok) {
      const { data } = await res.json();
      // The API may return out of order; index says where each belongs.
      const out = new Array(inputs.length);
      for (const d of data) out[d.index] = new Float32Array(d.embedding);
      return out;
    }

    lastErr = `${res.status} ${(await res.text()).replace(/\s+/g, ' ').slice(0, 200)}`;
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get('retry-after')) * 1000;
      const wait = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter
        : Math.min(3000 * 2 ** attempt, 60_000);   // up to 60s, not 30s total
      process.stderr.write(`  ${res.status}, retry ${attempt + 1}/8 in ${Math.ceil(wait / 1000)}s\n`);
      await sleep(wait);
      continue;
    }
    throw new Error(`embeddings ${lastErr}`);
  }
  throw new Error(`embeddings: giving up after 8 attempts — last error: ${lastErr}`);
}

/**
 * Embed many texts, batched.
 * @param {string[]} texts
 * @param {(done:number, total:number) => void} [onProgress]
 * @returns {Promise<Float32Array[]>}
 */
export async function embedAll(texts, onProgress) {
  const out = [];
  let i = 0;
  while (i < texts.length) {
    // Grow a batch until it hits either limit, so one long posting cannot make a
    // request that blows the whole per-minute token budget on its own.
    const batch = [];
    let chars = 0;
    while (i < texts.length && batch.length < MAX_BATCH) {
      const t = clip(texts[i]);
      if (batch.length && chars + t.length > MAX_REQ_CHARS) break;
      batch.push(t); chars += t.length; i++;
    }
    out.push(...await post(batch));
    onProgress?.(i, texts.length);
  }
  return out;
}

export const embedOne = async (text) => (await embedAll([text]))[0];
