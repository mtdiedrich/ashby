// Jev (TypeSafe AI): typed yes/no judgements. Fitness asks one `noul` per posting —
// is the candidate qualified — and gets back P(yes). See lib/jev-fitness.js.
//
// Official API, docs.typesafe.ai/api, confirmed against the live endpoint 2026-10-02:
//   POST https://api.typesafe.ai/v1/systemone   Authorization: Bearer $JEV_API_KEY
//   { model, state, questions: { id: { type: 'noul', instructions, criteria } } }
//   -> { model, answers: { id: { type: 'noul', noul } }, usage: { input_tokens } }
// $0.042 per million input tokens, output free; 64k context (32k for state plus the
// longest question); 429 when rate limited, 529 when overloaded.
//
// Its documented weak spots, which bear on how questions are worded here: it reads
// literally (a list in a requirement is read as needing every item), it does not
// count reliably, and unrelated text in the state is a distractor.

export const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
export const JEV_MODEL = 'jev-latest';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * One Jev request. Retries 429 and 529 with backoff; anything else fails at once,
 * carrying `status`, so a 401 reads as an auth failure to `isAuthError` and stops a
 * run on the first posting instead of the last.
 */
export async function jevAsk({ state, questions, key = process.env.JEV_API_KEY, model = JEV_MODEL,
                               fetchImpl = fetch, retries = 4, backoffMs = 1000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(JEV_URL, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify({ model, state, questions }),
      signal: AbortSignal.timeout(60_000),
    });
    if (res.ok) return res.json();

    const text = await res.text().catch(() => '');
    const retryable = res.status === 429 || res.status === 529;
    if (!retryable || attempt >= retries) {
      throw Object.assign(new Error(`Jev ${res.status}: ${text.slice(0, 300)}`), { status: res.status });
    }
    await sleep(backoffMs * 2 ** attempt);
  }
}
