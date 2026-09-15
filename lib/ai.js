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
export async function ask(system, user, { schema, maxTokens = 16000, effort = 'high', documents = [], model = MODEL } = {}) {
  preflight();
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

  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      if (schema) {
        const res = await client.messages.parse(req);
        if (res.stop_reason === 'refusal') throw new Error(`refused: ${res.stop_details?.category}`);
        if (res.parsed_output == null) throw new Error('structured output failed to parse');
        return res.parsed_output;
      }
      const res = await client.messages.create(req);
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
