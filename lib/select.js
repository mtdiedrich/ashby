// Choosing what to score next, out of everything crawl.js has stored.
//
// There used to be two fetchers. poll.js pulled every board, applied filters, and
// wrote the survivors to postings.jsonl while tracking seen.json; crawl.js pulled the
// same boards and kept everything in corpus.jsonl. The filters never saved a single
// request — poll fetched the whole board and discarded in memory — so the only
// product of that duplication was two stores of the same postings under different
// field names, which is exactly the mismatch that let match.js hand the scorers
// postings with empty descriptions.
//
// Now the corpus is the one store and this is the selection step. "New" is no longer
// a separate ledger that can drift: a posting is a candidate until it has been scored
// on every front and you have not dismissed it — facts already recorded elsewhere,
// derived rather than tracked.
//
// The one filter is location: a posting is scored only if it is in the US or open
// to it (usLocation). Title, pay and age filters were dropped on 2026-10-03 — every
// US posting is scored, and the board ranks rather than hides. The crawl still stores
// everything, so this can be widened without fetching anything again.

import { asPosting } from './corpus.js';
import { salaryOf } from './comp.js';
import { usLocation } from './filters.js';

/** In the US, or open to it. The only thing that keeps a posting off the worklist. */
export const inUS = p =>
  usLocation(p.location, [p.location, p.secondaryLocations].filter(Boolean).join(' | '));

/**
 * A worklist row: the posting in the shape the scorers read, without its description.
 * The worklist is every unscored posting — ~225,000 — and with descriptions it was
 * 1.3 GB. The scorer reads each one from descriptions.jsonl when it asks.
 */
export function worklistRow(p) {
  const { descriptionPlain, ...row } = asPosting(p, salaryOf);
  return row;
}

/**
 * @param {Map<string, object>} corpus       newest record per posting id
 * @param {object} opts
 * @param {Set<string>} [opts.done]          ids scored on every front (finished())
 * @param {Set<string>} [opts.dismissed]     ids you explicitly said no to
 * @returns {object[]} worklist rows, newest first
 */
export function candidates(corpus, { done = new Set(), dismissed = new Set() } = {}) {
  const out = [];
  for (const [id, p] of corpus) {
    if (done.has(id) || dismissed.has(id)) continue;
    if (!inUS(p)) continue;
    out.push(worklistRow(p));
  }
  out.sort((a, b) => String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? '')));
  return out;
}

/**
 * Ids scored on every front — which is now Jev's fitness alone.
 *
 * poll.js drops finished postings from fresh.jsonl, and the scorer reads only
 * fresh.jsonl. Counting a posting finished while its score is still missing removes it
 * from the only worklist anything consults, so the gap becomes permanent: it can
 * never get that score, and composite.js never gives it a `value`.
 *
 * This once checked two of three fronts and stranded 15 postings. Similarity, the
 * Sonnet fitness judgement and requirement coverage were all dropped on 2026-10-02;
 * Jev's fitness is the one left. A new scorer goes in here, in the same commit.
 */
export function finished({ fitness }) {
  return new Set(fitness ?? []);
}
