// What coverage.js has to do for a staged worklist, decided before anything is
// called or paid for.
//
// It lives here rather than in the script because a decision made inline in bin/
// cannot be tested — importing a script in this project runs it and spends money —
// and two bugs hid in this decision for as long as it was untestable. Both let a
// posting be counted as done while carrying no coverage row, which strands it: it
// can never satisfy `finished()` in select.js, so poll re-stages it on every run.
//
// The root cause of both is one mismatch. coverage caches by CONTENT — jdHash over
// title, slug, location and description, paired with the resume hash — while every
// reader downstream (finished(), the board, poll's worklist) looks a row up by
// posting ID. The two agree until a posting's id changes and its text does not.

/**
 * How many times an empty extraction is retried before it is taken at its word.
 *
 * Two, because the two cases look identical from here. An extraction can come back
 * empty because the call failed, which a retry fixes; or because the posting really
 * has no checkable requirements, which no retry will ever fix — Twilio published a
 * "Machine Learning Engineer L2" that was an unfilled template, responsibilities and
 * all ("Begin each bullet with an action-oriented verb"). Retrying that forever
 * spends money every run on a posting that can never finish.
 */
export const MAX_EXTRACT_ATTEMPTS = 2;

/**
 * Split a worklist into what each pass must do.
 *
 * @param {object}  args
 * @param {Array<{j: object, jdHash: string, key: string}>} args.work
 * @param {Map<string, object>} args.reqCache  requirements rows, keyed by jdHash
 * @param {Map<string, object>} args.covCache  coverage rows, keyed by `${jdHash}:${resumeHash}`
 * @param {Map<string, number>} [args.attempts]  extraction rows written per jdHash
 * @param {boolean} [args.force]  redo everything
 * @returns {{
 *   needExtract:   object[],  postings pass 1 must extract requirements for
 *   needScore:     object[],  postings pass 2 must score — these cost money
 *   scorable:      object[],  of needScore, the ones that HAVE requirements to score
 *   unscorable:    object[],  of needScore, the ones with none, so the run can say so
 *   unextractable: object[],  empty after MAX_EXTRACT_ATTEMPTS — the posting, not us
 *   reuse:         object[],  finished coverage rows to re-stamp under a new id, free
 * }}
 */
export function planCoverage({
  work = [], reqCache = new Map(), covCache = new Map(),
  attempts = new Map(), force = false,
} = {}) {
  // A requirements row that came back empty is a FAILED extraction, not a cached
  // one. Treating it as cached put the posting in neither pass — pass 1 skipped it
  // because the jdHash was present, pass 2 filtered it out because there was
  // nothing to score — so it could never finish and never retried, silently.
  const extracted = w => (reqCache.get(w.jdHash)?.requirements?.length ?? 0) > 0;
  const spent = w => (attempts.get(w.jdHash) ?? 0) >= MAX_EXTRACT_ATTEMPTS;

  // Empty and out of retries: stop paying for it, and name it so the run can say
  // why that posting will never appear on the board.
  const unextractable = force ? [] : work.filter(w => !extracted(w) && spent(w));

  const needExtract = work.filter(w => force || (!extracted(w) && !spent(w)));
  const needScore = work.filter(w => force || !covCache.has(w.key));

  // A cache hit whose row carries a different id is a re-listed posting: same text,
  // new id. The assessment is still valid — identical description, identical resume
  // — so it is copied to the new id rather than paid for again. Without this the
  // posting is invisible to everything that reads by id, forever.
  const reuse = [];
  if (!force) {
    for (const w of work) {
      const hit = covCache.get(w.key);
      if (!hit || hit.id === w.j.id) continue;
      reuse.push({ ...hit, id: w.j.id, title: w.j.title, slug: w.j.slug,
                   applyUrl: w.j.applyUrl, jobUrl: w.j.jobUrl,
                   reusedFrom: hit.id, at: new Date().toISOString() });
    }
  }

  // Pass 2 can only score what pass 1 produced requirements for. Reported rather
  // than silently dropped, which is how the empty-requirements case stayed hidden.
  const scorable = needScore.filter(extracted);
  const unscorable = needScore.filter(w => !extracted(w));

  return { needExtract, needScore, scorable, unscorable, unextractable, reuse };
}
