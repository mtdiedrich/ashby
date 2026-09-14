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
// a separate ledger that can drift: a posting is a candidate when nothing has judged
// it, nothing has staged it, and you have not dismissed it — all facts already
// recorded elsewhere, derived rather than tracked.

import { asPosting } from './corpus.js';
import { wantedTitle, usLocation } from './filters.js';
import { salaryOf, payPasses } from './comp.js';

/**
 * @param {Map<string, object>} corpus       newest record per posting id
 * @param {object} opts
 * @param {Set<string>} [opts.judged]        ids fitness.js or coverage.js has scored
 * @param {Set<string>} [opts.staged]        ids already waiting in fresh.jsonl
 * @param {Set<string>} [opts.dismissed]     ids you explicitly said no to
 * @param {boolean} [opts.us]                keep US locations only
 * @param {boolean} [opts.all]               skip the title filter
 * @param {number}  [opts.minPay]            USD/year floor; 0 disables
 * @param {number}  [opts.maxAgeDays]        drop older postings; 0 disables
 * @returns {object[]} postings in the shape the scorers read, newest first
 */
export function candidates(corpus, {
  judged = new Set(), staged = new Set(), dismissed = new Set(),
  us = false, all = false, minPay = 0, maxAgeDays = 0,
} = {}) {
  const out = [];

  for (const [id, p] of corpus) {
    if (judged.has(id) || staged.has(id) || dismissed.has(id)) continue;
    if (!all && !wantedTitle(p.title)) continue;
    if (us && !usLocation(p.location, [p.location, p.secondaryLocations].filter(Boolean).join(' | '))) continue;

    if (maxAgeDays > 0 && p.publishedAt) {
      if ((Date.now() - new Date(p.publishedAt)) / 86_400_000 > maxAgeDays) continue;
    }

    // Unstated pay passes deliberately: most boards publish nothing, and the model
    // reads the description. Only a stated range topping out below the floor fails.
    if (minPay > 0 && !payPasses(p, minPay).pass) continue;

    out.push(asPosting(p, null, salaryOf));
  }

  out.sort((a, b) => String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? '')));
  return out;
}
