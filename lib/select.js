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
// Scored on every front means fitness AND coverage. A posting one of them has seen is
// not finished, and staying on the worklist is what makes the scorers order-independent:
// each skips what it has already done, so none of them can strand work for another.

import { asPosting } from './corpus.js';
import { wantedTitle, usLocation } from './filters.js';
import { salaryOf, payPasses } from './comp.js';

/**
 * @param {Map<string, object>} corpus       newest record per posting id
 * @param {object} opts
 * @param {Set<string>} [opts.done]          ids scored on every front — fitness AND
 *                                           coverage. Partially scored is not done.
 * @param {Set<string>} [opts.dismissed]     ids you explicitly said no to
 * @param {boolean} [opts.us]                keep US locations only
 * @param {boolean} [opts.all]               skip the title filter
 * @param {number}  [opts.minPay]            USD/year floor; 0 disables
 * @param {number}  [opts.maxAgeDays]        drop older postings; 0 disables
 * @returns {object[]} postings in the shape the scorers read, newest first
 */
export function candidates(corpus, {
  done = new Set(), dismissed = new Set(),
  us = false, all = false, minPay = 0, maxAgeDays = 0,
} = {}) {
  const out = [];

  for (const [id, p] of corpus) {
    if (done.has(id) || dismissed.has(id)) continue;
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

/**
 * The n highest-similarity postings that still need scoring.
 *
 * This was `match --to-fresh`. The board stages one posting at a time, so bulk
 * staging by similarity moved here when that command was cut — it is the one thing
 * the terminal views did that the board could not.
 *
 * @param {object[]} rows  board rows, carrying similarity/fitness/coverage
 * @param {number} n
 */
export function topUnscored(rows, n) {
  return rows
    .filter(r => r.similarity != null && (r.fitness == null || r.coverage == null))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, n);
}

/**
 * Posting ids that have a vector. vectors.jsonl keys postings as `job:<id>` and also
 * holds the resume under a bare `resume` key, which is not a posting.
 */
export function vectorIds(rows) {
  const out = new Set();
  for (const r of rows ?? []) {
    const k = r?.key;
    if (typeof k === 'string' && k.startsWith('job:')) out.add(k.slice(4));
  }
  return out;
}

/**
 * Ids scored on EVERY front — fitness, coverage and similarity.
 *
 * poll.js drops finished postings from fresh.jsonl, and all three scorers read only
 * fresh.jsonl. Counting a posting finished while a score is still missing removes it
 * from the only worklist anything consults, so the gap becomes permanent: it can
 * never get that score, and composite.js never gives it a `score` or a `value`.
 *
 * Similarity was left out of this check originally, which stranded 15 postings with
 * fitness and coverage but no vector — on the board, and unrankable.
 */
export function finished({ fitness, coverage, vectors }) {
  const out = new Set();
  for (const id of fitness ?? []) {
    if (coverage?.has(id) && vectors?.has(id)) out.add(id);
  }
  return out;
}
