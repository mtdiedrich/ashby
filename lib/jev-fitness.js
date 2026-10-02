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
 * Which question the cached answer is to. Answers given while the extracted
 * requirements were part of the state are a different question; the version in the
 * key makes them due for asking again rather than counted as done.
 */
export const FITNESS_VERSION = 'posting-only';

const descriptionOf = p => String(p?.descriptionPlain ?? p?.description ?? '');

/** The text a posting's cache key is hashed over. Either record shape reads the same. */
export const jdTextOf = p =>
  [p.title, p.slug ?? p.company, p.location, descriptionOf(p)].filter(Boolean).join('\n\n');

export const fitnessKey = (jdHash, resumeHash) => `${jdHash}:${resumeHash}:${FITNESS_VERSION}`;

/** The Jev request for one posting. */
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
function split(candidates, byKey, resumeHash, hash, force) {
  const work = [], blank = [], reuse = [];
  for (const p of candidates) {
    if (!descriptionOf(p).trim()) { blank.push({ id: p.id, title: p.title }); continue; }
    const jdHash = hash(jdTextOf(p));
    const hit = byKey.get(fitnessKey(jdHash, resumeHash));
    if (!force && hit) {
      if (!hit.ids.has(p.id)) {
        reuse.push({ ...hit.row, id: p.id, reusedFrom: hit.row.id, at: new Date().toISOString() });
      }
      continue;
    }
    work.push({ id: p.id, jdHash, title: p.title, posting: p });
  }
  return { work, blank, reuse };
}

/** The normal run: every staged posting (fresh.jsonl) not yet answered. */
export function worklistWork(fresh, fitnessRows, resumeHash, { hash, force = false }) {
  return split(fresh ?? [], index(fitnessRows), resumeHash, hash, force);
}

/**
 * --rescore: every posting that has ever been scored, once, from its corpus record,
 * where the newest answer is not to the current version of the question.
 */
export function rescoreWork(fitnessRows, corpusMap, resumeHash, { hash, force = false }) {
  const ids = [...new Set((fitnessRows ?? []).map(r => r.id))];
  const postings = ids.map(id => corpusMap.get(id)).filter(Boolean);
  return split(postings, index(fitnessRows), resumeHash, hash, force);
}

/** The jev-fitness.jsonl row for one answer. A missing answer is not a zero. */
export function fitnessRow(w, resumeHash, res) {
  const p = res?.answers?.qualified?.noul;
  if (typeof p !== 'number') throw new Error(`Jev returned no answer for ${w.id}`);
  return { id: w.id, key: fitnessKey(w.jdHash, resumeHash), jdHash: w.jdHash, resumeHash,
           fitness: p, model: res.model ?? null, version: FITNESS_VERSION, at: new Date().toISOString() };
}
