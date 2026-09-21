// Thin wrapper around the Anthropic API.
//
// Two differences from a naive wrapper:
//   * Structured outputs (output_config.format) instead of parsing a fenced
//     ```json block out of prose. The model cannot return malformed JSON, so
//     there is no regex to get wrong and no retry loop for bad parses.
//   * Retry with backoff on 429 / 5xx, because score.js makes dozens of calls
//     in a row and one blip should not lose the batch.

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import fs from 'node:fs';
import { P } from './paths.js';
import dotenv from 'dotenv';
import { looksLikePlaceholder, badKeyError } from './keys.js';
import { appendRows } from './jsonl.js';
import { idFor, collect } from './batch-api.js';
// override: a stale OPENAI_API_KEY/ANTHROPIC_API_KEY in the machine's
// environment otherwise wins over .env and is silently used instead —
// dotenv does not replace existing vars by default, so a revoked key set
// months ago shadows the one you just pasted into .env and every call 401s.
dotenv.config({ override: true, quiet: true });

export const MODEL = process.env.ASHBY_MODEL || 'claude-opus-5';

const client = new Anthropic();  // reads ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or an `ant auth login` profile

// Checked before a run rather than 1,396 times during one. A placeholder key gets
// the same 401 on every call, and the run has no way to succeed.
let keyChecked = false;
export function preflight() {
  if (keyChecked) return;
  // An `ant auth login` profile authenticates with no key set, so this only objects
  // when a key IS present and obviously wrong. A missing one is left to the API.
  const key = process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN;
  if (key && looksLikePlaceholder(key)) throw badKeyError('ANTHROPIC_API_KEY', key);
  keyChecked = true;
}

let _context = null;
let _contextFrom = null;
/** context.md — constraints, preferences, project write-ups, voice samples. */
export function context() {
  const file = P.context;
  // Re-read when the path changes; a cached value from a different ASHBY_HOME
  // would be silently wrong.
  if (_context === null || _contextFrom !== file) {
    if (!fs.existsSync(file)) {
      throw new Error(`${file} not found. Copy config/context.template.md to config/context.md — ` +
                      'it is the input that decides output quality.');
    }
    _context = fs.readFileSync(file, 'utf8');
    _contextFrom = file;
    if (_context.includes('TODO: replace this')) {
      console.warn(`⚠  ${file} still contains template text. Output will be generic.`);
    }
  }
  return _context;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * The effort ladder, lowest first. Verified against the live API on Sonnet 5, which
 * accepts all five; output tokens climb with the level (119 / 144 / 184 / 190 / 1740
 * on one fixed prompt), because effort is what drives adaptive thinking.
 */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * `--effort LEVEL`. The caller picks the fallback, because the right default is a
 * measured property of the job rather than a general one — fitness asks for 'low'.
 *
 * Parsed here rather than in the script because a parser inside bin/ cannot be
 * tested: importing a script in this project runs it and spends money. An unknown
 * level throws instead of being forwarded, since the API would reject it identically
 * on every request in the run.
 */
export function effortFlag(argv = [], fallback = 'high') {
  const i = argv.indexOf('--effort');
  if (i === -1) return fallback;
  const level = argv[i + 1];
  if (!EFFORTS.includes(level)) {
    throw new Error(`"${level ?? ''}" is not an effort level — one of: ${EFFORTS.join(', ')}`);
  }
  return level;
}

/** `--think N`, a thinking budget in tokens for models that must be asked. */
export function thinkFlag(argv = []) {
  const i = argv.indexOf('--think');
  if (i === -1) return null;
  const n = Number(argv[i + 1]);
  if (!Number.isFinite(n)) {
    throw new Error(`--think needs a token budget, e.g. --think 4000`);
  }
  return n;
}

/**
 * One model call.
 * @param {string} system      system prompt (put the stable context here — it caches)
 * @param {string} user        the request
 * @param {object} opts
 * @param {import('zod').ZodType} [opts.schema]  when set, the reply is parsed and validated against it
 * @param {number} [opts.maxTokens]
 * @param {'low'|'medium'|'high'|'xhigh'|'max'} [opts.effort]
 * @param {string} [opts.model]  override the default model for this call
 * @param {object[]} [opts.documents]  document blocks (e.g. the resume PDF) to prepend
 */
/**
 * The request body, built once so the sync and batch paths cannot drift apart.
 * A batch request that differed by a byte would also miss the cache the sync path
 * warms, which is most of what makes either of them affordable.
 */
export function buildRequest(system, user, { schema, maxTokens = 16000, effort = 'high', documents = [], model = MODEL, thinkBudget = null } = {}) {
  // Documents go before the text block, and the stable ones carry their own
  // cache_control so a resume is billed once rather than on every posting.
  const content = [...documents.filter(Boolean), { type: 'text', text: user }];

  // Haiku 4.5 rejects output_config.effort outright ("This model does not support
  // the effort parameter"), so only send it to models that have it.
  const supportsEffort = !/haiku/i.test(model);

  const req = {
    model,
    max_tokens: maxTokens,
    output_config: supportsEffort ? { effort } : {},
    // The system prompt carries all of context.md and is identical across calls,
    // so caching it turns a large repeated prefix into a ~0.1x read.
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content }],
  };
  if (schema) req.output_config.format = zodOutputFormat(schema);

  // Extended thinking, for the models that need asking. Verified against the live
  // API: Haiku 4.5 returns 400 "adaptive thinking is not supported on this model"
  // and takes {type:'enabled', budget_tokens:N}; Sonnet 5, Opus 5 and Fable 5.1 are
  // the reverse — they think adaptively on their own and 400 on budget_tokens.
  // Both mistakes are the same answer for every request in a run, so they are
  // caught here rather than once per posting.
  if (thinkBudget != null) {
    if (supportsEffort) {
      throw new Error(
        `${model} does not take an explicit thinking budget — it thinks adaptively, ` +
        `controlled by effort. Drop the budget, or use a model that needs one.`);
    }
    if (thinkBudget >= maxTokens) {
      throw new Error(
        `thinking budget ${thinkBudget} must be below max_tokens ${maxTokens}`);
    }
    req.thinking = { type: 'enabled', budget_tokens: thinkBudget };
  }
  return req;
}

export async function ask(system, user, { schema, maxTokens = 16000, effort = 'high', documents = [], model = MODEL, thinkBudget = null, label, items = 1 } = {}) {
  preflight();
  const req = buildRequest(system, user, { schema, maxTokens, effort, documents, model, thinkBudget });

  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      if (schema) {
        const res = await client.messages.parse(req);
        record(res, model, label, items, effort);
        if (res.stop_reason === 'refusal') throw new Error(`refused: ${res.stop_details?.category}`);
        if (res.parsed_output == null) throw new Error('structured output failed to parse');
        return res.parsed_output;
      }
      const res = await client.messages.create(req);
      record(res, model, label, items, effort);
      if (res.stop_reason === 'refusal') throw new Error(`refused: ${res.stop_details?.category}`);
      return res.content.filter(b => b.type === 'text').map(b => b.text).join('');
    } catch (e) {
      lastErr = e;
      const retryable = e instanceof Anthropic.RateLimitError ||
                        e instanceof Anthropic.APIConnectionError ||
                        (e instanceof Anthropic.APIError && e.status >= 500);
      if (!retryable || attempt === 4) throw e;
      const wait = 2000 * 2 ** attempt;
      console.warn(`  retry ${attempt + 1}/4 in ${wait / 1000}s — ${e.message}`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

/**
 * Record what a call cost, before anything else can throw.
 *
 * Written per call rather than banked, for the reason everything else here is:
 * a run that stops early should keep the record of what it already spent. It is
 * also the only way to see thinking tokens — Sonnet 5 runs adaptive thinking, that
 * is billed as output, and it never appears in the scores we store.
 */
// One id per process, so two scoring runs at once stay separable in the log. They
// do overlap: the first use of this log blended a background run with one already
// going in another terminal, and nothing in the rows could tell them apart.
const RUN = `${Date.now().toString(36)}-${process.pid}`;

function record(res, model, label, items, effort) {
  try {
    appendRows(P.usage, [{
      at: new Date().toISOString(),
      run: RUN,
      label: label ?? 'unlabelled',
      model: res?.model ?? model,
      effort: /haiku/i.test(String(model)) ? null : effort,
      items,
      usage: res?.usage ?? {},
    }]);
  } catch { /* accounting must never break a scoring run */ }
}

/**
 * Run many requests through the Batch API — half price, asynchronous.
 *
 * Submit, poll, collect. The batch id is written to disk the moment it exists, so a
 * run you interrupt can be picked up rather than paid for twice: the work is already
 * submitted and billed whether or not this process is still watching.
 *
 * @param {Array<{system: string, user: string}>} items  one per request, in order
 * @param {object} opts  the same shape ask() takes, plus onProgress(done, total)
 * @returns {Promise<Map<number, {ok, text?, error?, usage}>>} keyed by item index
 */
export async function askBatch(items, {
  schema, maxTokens = 16000, effort = 'high', documents = [], model = MODEL,
  thinkBudget = null, label, itemsPer = 1, onProgress, pollMs = 15_000, resumeId = null,
} = {}) {
  preflight();
  if (!items.length) return new Map();

  let batchId = resumeId;
  if (!batchId) {
    const requests = items.map((it, i) => ({
      custom_id: idFor(i),
      params: buildRequest(it.system, it.user, { schema, maxTokens, effort, documents, model, thinkBudget }),
    }));
    const created = await client.messages.batches.create({ requests });
    batchId = created.id;
    // Before the first poll: the batch is billing from here whether we watch or not.
    try {
      appendRows(P.batches, [{
        at: new Date().toISOString(), run: RUN, id: batchId,
        label: label ?? 'unlabelled', model, count: items.length,
      }]);
    } catch { /* accounting must never break a run */ }
    console.error(`  batch ${batchId} submitted — ${items.length} requests at half price`);
  }

  for (;;) {
    const b = await client.messages.batches.retrieve(batchId);
    const c = b.request_counts ?? {};
    onProgress?.((c.succeeded ?? 0) + (c.errored ?? 0) + (c.canceled ?? 0) + (c.expired ?? 0), items.length);
    if (b.processing_status === 'ended') break;
    await sleep(pollMs);
  }

  const raw = [];
  for await (const r of await client.messages.batches.results(batchId)) raw.push(r);
  const out = collect(raw, items.length);

  // Usage rides on each result. Recorded with batch: true so cost.js halves it.
  try {
    appendRows(P.usage, [...out.entries()].map(([i, r]) => ({
      at: new Date().toISOString(), run: RUN, batch: true, batchId,
      label: label ?? 'unlabelled', model,
      effort: /haiku/i.test(String(model)) ? null : effort,
      items: itemsPer, usage: r.usage ?? {},
    })));
  } catch { /* as above */ }

  return out;
}

/**
 * Parse one batch result against the schema the request asked for.
 *
 * messages.parse() does this for the sync path; batch results come back as raw
 * messages, so structured output is validated here instead. A reply that does not
 * fit the schema is a failure, not a silently half-filled object.
 */
export function parseBatchResult(result, schema) {
  if (!result?.ok) return { ok: false, error: result?.error ?? 'no result' };
  try {
    return { ok: true, value: schema.parse(JSON.parse(result.text)) };
  } catch (e) {
    return { ok: false, error: `structured output did not parse: ${e.message.slice(0, 120)}` };
  }
}
