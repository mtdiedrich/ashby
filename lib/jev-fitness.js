// Fitness: Jev's one-question read of a posting against the resume.
//
// Jev is handed the posting — title, company, whole description — and the resume, and
// asked a single `noul`: is this candidate qualified for this job. P(yes) is the score.
//
// Since 2026-10-02 it is the only model score, and it drives value (lib/composite.js)
// and the worklist (finished() in lib/select.js). It replaced requirement coverage
// after 100 postings where the two disagreed by 0.25 or more were judged by hand:
// fitness was closer in 90, with mean error 0.08 against coverage's 0.35. Coverage
// averaged decisive requirements (a PhD, ten years, Staff level) in with generic ones
// anyone meets, and ran a third of a point optimistic.
//
// Not the older Sonnet fitness scorer, also dropped that day; its records are in
// data/fitness.jsonl, and these go to data/jev-fitness.jsonl.

// Jev allows 32k tokens for the state plus the longest question. Descriptions are a
// few thousand characters; a pathological one must not fail the request.
const MAX_DESCRIPTION_CHARS = 60_000;

/**
 * Which questions the cached answer is to. 'posting-only' asked one; 'two-way' (since
 * 2026-10-12) asks both directions. The version in the key makes older answers due
 * for asking again rather than counted as done.
 */
export const FITNESS_VERSION = 'two-way';

const descriptionOf = p => String(p?.descriptionPlain ?? p?.description ?? '');

/** The text a posting's cache key is hashed over. Either record shape reads the same. */
export const jdTextOf = p =>
  [p.title, p.slug ?? p.company, p.location, descriptionOf(p)].filter(Boolean).join('\n\n');

export const fitnessKey = (jdHash, resumeHash) => `${jdHash}:${resumeHash}:${FITNESS_VERSION}`;

/**
 * The Jev request for one posting: two questions, one in each direction.
 *
 *   qualified  does the resume meet the role — the original question, unchanged
 *   aligned    does the role meet the resume — is this the kind of work, domain and
 *              level the resume shows. A role far below the candidate's level is
 *              qualified and not aligned; that gap is why it is asked.
 *
 * One request, not two: the posting and resume are billed once per request, and the
 * second question measured at ~2% more input tokens (989 → 1,008).
 */
export function fitnessRequest(posting, resume) {
  return {
    state: {
      job_title: posting.title,
      company: posting.slug ?? posting.company ?? null,
      job_description: descriptionOf(posting).slice(0, MAX_DESCRIPTION_CHARS),
      resume,
    },
    questions: {
      qualified: {
        type: 'noul',
        instructions: 'Based on their resume, the candidate is qualified for this job.',
        criteria: {
          true: 'The resume shows the experience, skills and level this job asks for, so the candidate is a credible applicant.',
          false: 'The resume falls clearly short of what this job asks for, in experience, skills or level.',
        },
      },
      aligned: {
        type: 'noul',
        instructions: 'This job is a close match for the work the candidate\'s resume shows they do.',
        criteria: {
          true: 'The job\'s day-to-day work, domain and level are the kind the resume shows, so most of the candidate\'s experience would carry over to it.',
          false: 'The job is mostly unrelated to the experience on the resume, or sits far above or far below its level, so little of that experience would carry over.',
        },
      },
    },
  };
}

// Answered keys, and which ids each answer is recorded under.
function index(fitnessRows) {
  const byKey = new Map();
  for (const r of fitnessRows ?? []) {
    if (!r?.key) continue;
    if (!byKey.has(r.key)) byKey.set(r.key, { row: r, ids: new Set() });
    const e = byKey.get(r.key);
    e.ids.add(r.id);
    if (String(r.at ?? '') >= String(e.row.at ?? '')) e.row = r;
  }
  return byKey;
}

// A posting with no description would be judged on its title — a confident number
// about nothing. Those are set aside and counted.
//
// A posting whose description is already answered under ANOTHER id is a re-listing:
// the company deleted the job and posted it again, byte for byte. The answer is copied
// to the new id rather than paid for, and must be: finished() looks postings up by id,
// so without the copy the re-listing never finishes and poll re-stages it every run.
//
// The text comes from `describe`, which in the real run reads descriptions.jsonl: the
// worklist carries none. It is used here and dropped — a work item keeps its length,
// not the text, because 225,000 descriptions held for a whole run is ~2.5 GB.
function split(candidates, byKey, resumeHash, hash, force, describe = descriptionOf) {
  const work = [], blank = [], reuse = [];
  for (const p of candidates) {
    const text = String(describe(p) ?? '');
    if (!text.trim()) { blank.push({ id: p.id, title: p.title }); continue; }
    const jdHash = hash(jdTextOf({ ...p, descriptionPlain: text }));
    const hit = byKey.get(fitnessKey(jdHash, resumeHash));
    if (!force && hit) {
      if (!hit.ids.has(p.id)) {
        reuse.push({ ...hit.row, id: p.id, reusedFrom: hit.row.id, at: new Date().toISOString() });
      }
      continue;
    }
    work.push({ id: p.id, jdHash, title: p.title, posting: p, chars: text.length });
  }
  return { work, blank, reuse };
}

/** The normal run: every staged posting (fresh.jsonl) not yet answered. */
export function worklistWork(fresh, fitnessRows, resumeHash, { hash, force = false, describe }) {
  return split(fresh ?? [], index(fitnessRows), resumeHash, hash, force, describe);
}

/**
 * --rescore: every posting that has ever been scored, once, from its corpus record,
 * where the newest answer is not to the current version of the question.
 */
export function rescoreWork(fitnessRows, corpusMap, resumeHash, { hash, force = false, describe }) {
  const ids = [...new Set((fitnessRows ?? []).map(r => r.id))];
  const postings = ids.map(id => corpusMap.get(id)).filter(Boolean);
  return split(postings, index(fitnessRows), resumeHash, hash, force, describe);
}

/** The jev-fitness.jsonl row for one answer. A missing answer is not a zero. */
export function fitnessRow(w, resumeHash, res) {
  const q = res?.answers?.qualified?.noul, a = res?.answers?.aligned?.noul;
  // Both or neither: a row with one answer would count as scored and never be asked again.
  if (typeof q !== 'number' || typeof a !== 'number') throw new Error(`Jev returned no answer for ${w.id}`);
  return { id: w.id, key: fitnessKey(w.jdHash, resumeHash), jdHash: w.jdHash, resumeHash,
           fitness: q, alignment: a, model: res.model ?? null, version: FITNESS_VERSION,
           at: new Date().toISOString() };
}

/**
 * Ids answered on both questions of the current version — what finished() is given.
 * A one-question answer from before 2026-10-12 does not count: counting it would keep
 * those postings off the worklist, and they would never get the second answer or a value.
 */
export function answeredIds(fitnessRows) {
  const out = new Set();
  for (const r of fitnessRows ?? []) {
    if (r?.version === FITNESS_VERSION && typeof r.fitness === 'number' && typeof r.alignment === 'number') out.add(r.id);
  }
  return out;
}
