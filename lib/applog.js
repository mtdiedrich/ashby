// Reading data/log.jsonl — what apply.js actually did with each posting.
//
// One line is written per posting the moment it is dealt with, not at the end of the
// run. `submitted` records whether you actually sent the application; apply.js never
// submits anything itself, so this is your answer to its prompt, not an observation.

/** A record explicitly says the application was sent. */
const saysSubmitted = r => r?.submitted === true;

/**
 * Records written before `submitted` existed. Opening a posting was the only thing
 * logged then, and the board treated that as applied — so old records keep their old
 * meaning. The information to do better is not recoverable, and silently un-applying
 * real applications is worse than carrying the old ambiguity forward on 13 rows.
 */
const isLegacy = r => r && !('submitted' in r) && r.outcome !== 'error';

/** Posting ids you sent an application for. */
export function appliedIds(rows) {
  const out = new Set();
  for (const r of rows ?? []) {
    if (saysSubmitted(r) || isLegacy(r)) out.add(r.job);
  }
  return out;
}

/** Posting ids apply.js opened and filled, but which were not submitted. */
export function openedIds(rows) {
  const applied = appliedIds(rows);
  const out = new Set();
  for (const r of rows ?? []) {
    if (r?.job && !applied.has(r.job)) out.add(r.job);
  }
  return out;
}

/**
 * The queue without one posting.
 *
 * The queue used to be rewritten once, after the whole run, from the list of ids
 * opened. Interrupting a run — Ctrl-C, a crash, closing the terminal — threw away
 * every removal, so the next run reopened everything already dealt with.
 */
export function dropFromQueue(queue, id) {
  return (queue ?? []).filter(r => r?.id !== id);
}

/** What apply.js asks after each posting. One answer per line. */
export const SUBMITTED_PROMPT = [
  '',
  '  Submitted?',
  '    [y] yes, submitted',
  '    [n] no, drop from queue',
  '    [k] not yet, keep in queue',
  '    [s] stop here, keep in queue',
  '  > ',
].join('\n');

/**
 * What an answer to that prompt does.
 *
 * [s] keeps the posting queued. It used to drop it like [n], and hit in place of [k]
 * it threw away postings that had never been applied to — with nothing in the log to
 * say which, since [n] and [s] wrote identical records. Stopping is not a decision
 * about the posting, so it leaves the posting where it was.
 *
 * Anything unrecognised behaves as [n], as it always has.
 */
export function answerEffect(answer) {
  const a = String(answer ?? '').trim().toLowerCase();
  return {
    submitted: a === 'y',
    keep: a === 'k' || a === 's',
    stop: a === 's',
  };
}
