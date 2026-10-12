import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jevAsk, JEV_URL } from '../lib/jev.js';
import { isAuthError } from '../lib/keys.js';

// The client for Jev (TypeSafe AI), which scores each extracted requirement against
// the resume as a `noul` — P(yes) — in one request per posting.
// Shapes from docs.typesafe.ai/api, confirmed against the live API 2026-10-02:
//   request  { model, state, questions: { id: { type: 'noul', instructions, criteria? } } }
//   response { model, answers: { id: { type: 'noul', noul: 0..1 } }, usage: { input_tokens } }
// No network here: fetch is injected.

const ok = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const fail = (status, text = 'nope') => ({ ok: false, status, json: async () => ({}), text: async () => text });
const ANSWER = { model: 'jev-1.13.0', answers: { r0: { type: 'noul', noul: 0.9 } }, usage: { input_tokens: 300 } };

test('one POST to the official endpoint, bearer key, the model and questions as given', async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return ok(ANSWER); };
  const res = await jevAsk({ state: { resume: 'R' }, questions: { r0: { type: 'noul', instructions: 'x' } },
    key: 'k'.repeat(40), fetchImpl });
  assert.equal(seen.url, JEV_URL);
  assert.equal(JEV_URL, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers.authorization, 'Bearer ' + 'k'.repeat(40));
  const body = JSON.parse(seen.init.body);
  assert.equal(body.model, 'jev-latest');
  assert.deepEqual(body.state, { resume: 'R' });
  assert.deepEqual(Object.keys(body.questions), ['r0']);
  assert.equal(res.answers.r0.noul, 0.9);
  assert.equal(res.model, 'jev-1.13.0');
});

test('a 401 stops at once and reads as an auth failure', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return fail(401, 'invalid api key'); };
  await assert.rejects(
    jevAsk({ state: 's', questions: {}, key: 'k'.repeat(40), fetchImpl, backoffMs: 1 }),
    e => isAuthError(e));
  assert.equal(calls, 1, 'never retried');
});

test('rate limits and overload are retried', async () => {
  let calls = 0;
  const fetchImpl = async () => (++calls === 1 ? fail(429) : calls === 2 ? fail(529) : ok(ANSWER));
  const res = await jevAsk({ state: 's', questions: {}, key: 'k'.repeat(40), fetchImpl, backoffMs: 1 });
  assert.equal(res.answers.r0.noul, 0.9);
  assert.equal(calls, 3);
});

test('a lasting overload fails after the retries, with the status', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return fail(529); };
  await assert.rejects(
    jevAsk({ state: 's', questions: {}, key: 'k'.repeat(40), fetchImpl, backoffMs: 1, retries: 2 }),
    e => e.status === 529);
  assert.equal(calls, 3);
});

test('a validation error is not retried', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return fail(422, 'bad question'); };
  await assert.rejects(jevAsk({ state: 's', questions: {}, key: 'k'.repeat(40), fetchImpl, backoffMs: 1 }),
    e => e.status === 422 && /bad question/.test(e.message));
  assert.equal(calls, 1);
});
