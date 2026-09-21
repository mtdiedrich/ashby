// The Message Batches API — the same requests, asynchronously, at half price.
//
// 50% off every token including cache reads and writes, which on the measured
// profile takes a 1,000-posting scoring run from $14.64 to $7.32 with no change to
// what the model is asked or what it returns. Nothing waits on a scoring run, which
// is the only thing the batch tier costs you: results arrive within 24 hours rather
// than seconds (most land inside an hour).
//
// The one thing to get right: **results come back in any order**. Keying them by
// position attaches a score to the wrong posting, silently — the same class of bug
// as fitness's echoed index, which cost 16 postings before anyone noticed.

/** custom_id for the item at `index`. The only link between request and result. */
export const idFor = (index) => `r-${index}`;

/** The index an id refers to, or null when it is not one of ours. */
export function indexOf(customId) {
  const m = /^r-(\d+)$/.exec(String(customId ?? ''));
  if (!m) return null;
  return Number(m[1]);
}

const textOf = (message) => (message?.content ?? [])
  .filter(b => b?.type === 'text').map(b => b.text).join('');

/**
 * Batch results, keyed by the index they belong to.
 *
 * Every outcome is recorded — a failure is a row saying why, never an absence, so
 * the caller can tell "this posting failed" from "this posting was never asked
 * about". Usage rides along on each one for the cost log.
 *
 * @param {number} [count] when given, ids outside 0..count-1 are ignored rather
 *        than mis-filed against a posting this batch never contained.
 */
export function collect(results, count) {
  const out = new Map();
  for (const r of results ?? []) {
    const i = indexOf(r?.custom_id);
    if (i === null) continue;
    if (count != null && (i < 0 || i >= count)) continue;

    const res = r.result ?? {};
    if (res.type === 'succeeded') {
      const msg = res.message ?? {};
      // A refusal is an HTTP success carrying a decline — check before the content.
      if (msg.stop_reason === 'refusal') {
        out.set(i, { ok: false, error: `refused: ${msg.stop_details?.category ?? 'unknown'}`, usage: msg.usage ?? {} });
      } else {
        out.set(i, { ok: true, text: textOf(msg), usage: msg.usage ?? {}, model: msg.model });
      }
      continue;
    }
    const why = res.type === 'errored'
      ? `${res.error?.type ?? 'errored'}: ${res.error?.message ?? 'no message'}`
      : res.type === 'expired' ? 'expired before it ran — resubmit'
      : res.type === 'canceled' ? 'canceled'
      : `unknown result type "${res.type}"`;
    out.set(i, { ok: false, error: why, usage: {} });
  }
  return out;
}
