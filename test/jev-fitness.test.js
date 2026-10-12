import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fitnessRequest, fitnessKey, jdTextOf, worklistWork, rescoreWork, fitnessRow, FITNESS_VERSION }
  from '../lib/jev-fitness.js';

// Fitness: Jev is handed the posting — title, company, whole description — and the
// resume, and asked one yes/no question: is this candidate qualified for this job.
// P(yes) is the score, and since 2026-10-02 the only one: it drives value.
//
// It replaced requirement coverage after 100 postings where the two disagreed by
// 0.25+ were judged by hand: fitness was closer in 90 (mean error 0.08 vs 0.35).
// Requirement extraction went with coverage, so the question no longer carries a list.

const posting = { id: 'p1', title: 'Senior ML Engineer', slug: 'acme', location: 'Remote',
                  descriptionPlain: 'We build models.\nYou will ship them.' };

test('one noul question: is the candidate qualified for this job', () => {
  const { questions } = fitnessRequest(posting, 'RESUME TEXT');
  assert.deepEqual(Object.keys(questions), ['qualified']);
  assert.equal(questions.qualified.type, 'noul');
  assert.match(questions.qualified.instructions, /qualified/i);
});

test('the state is the posting and the resume — no extracted requirements', () => {
  const { state } = fitnessRequest(posting, 'RESUME TEXT');
  assert.deepEqual(state, {
    job_title: 'Senior ML Engineer', company: 'acme',
    job_description: 'We build models.\nYou will ship them.', resume: 'RESUME TEXT',
  });
});

test('corpus-shaped records work too', () => {
  const { state } = fitnessRequest({ title: 'T', company: 'co', description: 'D' }, 'R');
  assert.equal(state.company, 'co');
  assert.equal(state.job_description, 'D');
});

test('a very long description is cut to fit Jev\'s 32k-token state budget', () => {
  const { state } = fitnessRequest({ ...posting, descriptionPlain: 'x'.repeat(200_000) }, 'R');
  assert.ok(state.job_description.length <= 60_000);
});

test('the posting text that is hashed reads either record shape the same way', () => {
  assert.equal(jdTextOf(posting), jdTextOf({ title: 'Senior ML Engineer', company: 'acme', location: 'Remote',
    description: 'We build models.\nYou will ship them.' }));
});

test('the cache key names the version of the question', () => {
  // Answers given with the extracted requirements in the state are a different
  // question; versioning the key makes them due for asking again.
  assert.equal(fitnessKey('jd', 'rh'), `jd:rh:${FITNESS_VERSION}`);
  assert.notEqual(fitnessKey('jd', 'rh'), 'jd:rh');
});

test('worklist: every staged posting with a description and no answer for this version', () => {
  const fresh = [
    { ...posting, id: 'a' }, { ...posting, id: 'b', descriptionPlain: 'other' }, { ...posting, id: 'c', descriptionPlain: '' },
  ];
  const keyOf = p => fitnessKey('H(' + jdTextOf(p) + ')', 'rh');
  const hash = s => 'H(' + s + ')';
  const done = [{ id: 'b', key: keyOf(fresh[1]) }];
  const { work, blank } = worklistWork(fresh, done, 'rh', { hash });
  assert.deepEqual(work.map(w => w.id), ['a']);
  assert.deepEqual(blank.map(w => w.id), ['c'], 'no description: counted, not judged on a title');
});

test('rescore: every posting already scored, once, if its answer is an older version', () => {
  const fit = [
    { id: 'a', key: 'ja:rh', at: '2026-10-01' },                 // old version
    { id: 'a', key: 'ja:rh', at: '2026-10-02' },                 // twice
    { id: 'b', key: `jb:rh:${FITNESS_VERSION}` },                // already current
  ];
  const corpus = new Map([['a', { id: 'a', title: 'A', company: 'co', description: 'desc a' }],
                          ['b', { id: 'b', title: 'B', company: 'co', description: 'desc b' }]]);
  const hash = s => s === jdTextOf(corpus.get('b')) ? 'jb' : 'ja';
  const { work } = rescoreWork(fit, corpus, 'rh', { hash });
  assert.deepEqual(work.map(w => w.id), ['a']);
});

test('a row records the probability and the versioned key', () => {
  const r = fitnessRow({ id: 'p1', jdHash: 'jd' }, 'rh', { model: 'jev-1.13.0', answers: { qualified: { noul: 0.42 } } });
  assert.deepEqual([r.id, r.key, r.fitness, r.model], ['p1', fitnessKey('jd', 'rh'), 0.42, 'jev-1.13.0']);
  assert.throws(() => fitnessRow({ id: 'p1', jdHash: 'jd' }, 'rh', { answers: {} }), /no answer/);
});

test('nothing reads requirement coverage any more', () => {
  for (const f of ['lib/composite.js', 'lib/select.js', 'bin/poll.js', 'bin/ui.js', 'bin/levels.js', 'bin/fitness.js', 'lib/jev-fitness.js']) {
    const src = fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /P\.coverage|P\.requirements|coverage-score|coverage-plan/, f);
  }
});

// ---- re-listed postings -------------------------------------------------------------
//
// A company deletes a job and posts it again: new id, byte-identical description. The
// cache is keyed by description, so the answer exists; finished() looks postings up by
// ID, so without a copy under the new id the posting is never finished and poll
// re-stages it on every run. Coverage solved this; dropping coverage must not undo it.

test('a re-listed posting reuses the answer under its new id, free', () => {
  const hash = s => 'H(' + s + ')';
  const old = { ...posting, id: 'old' }, relisted = { ...posting, id: 'new' };
  const answered = { id: 'old', key: fitnessKey(hash(jdTextOf(old)), 'rh'), fitness: 0.61, model: 'jev-1.13.0' };
  const { work, reuse } = worklistWork([relisted], [answered], 'rh', { hash });
  assert.equal(work.length, 0, 'nothing to pay for');
  assert.equal(reuse.length, 1);
  assert.equal(reuse[0].id, 'new');
  assert.equal(reuse[0].fitness, 0.61);
  assert.equal(reuse[0].reusedFrom, 'old');
});

test('a posting already answered under its own id is neither work nor reuse', () => {
  const hash = s => 'H(' + s + ')';
  const answered = { id: 'p1', key: fitnessKey(hash(jdTextOf(posting)), 'rh'), fitness: 0.5 };
  const { work, reuse } = worklistWork([posting], [answered], 'rh', { hash });
  assert.deepEqual([work.length, reuse.length], [0, 0]);
});

test('the fitness command writes re-listing copies, before its "nothing to do" exit', () => {
  const src = fs.readFileSync(new URL('../bin/fitness.js', import.meta.url), 'utf8');
  const write = src.indexOf('appendRows(P.jevFitness, reuse)');
  assert.ok(write > 0, 'reuse rows are appended');
  const exit = src.indexOf('nothing to do');
  assert.ok(exit > 0 && write < exit, 'a run whose only work is re-listings still has work');
});
