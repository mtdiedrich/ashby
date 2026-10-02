import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { fetchPatient } from '../lib/fetch.js';

// Greenhouse's board API stalls at random: measured 2026-09-28, about 6% of requests
// sat 5-17s before sending a single header, and those few were ~80% of the crawl's
// Greenhouse time. The same boards fetched again answered in under 300ms. So a
// request with no response headers after a few seconds is abandoned and sent again.
//
// Only the wait for HEADERS is cut short. A board whose headers arrive promptly gets
// all the time it needs for its body — the largest are several megabytes.
//
// A local server stands in for the API, stalling on command. No network.

let server, base, hits;
// path -> how to answer the Nth request to it (0-based)
const SCRIPT = {
  '/stall-once':   n => (n === 0 ? 'stall' : 'ok'),
  '/stall-always': () => 'stall',
  '/slow-body':    () => 'slow-body',
  '/missing':      () => '404',
  '/fine':         () => 'ok',
};

before(async () => {
  server = http.createServer((req, res) => {
    const n = hits[req.url] = (hits[req.url] ?? -1) + 1;
    const how = SCRIPT[req.url]?.(n) ?? '404';
    if (how === 'stall') return;                          // never answer; the client gives up
    if (how === '404') { res.writeHead(404); return res.end('{}'); }
    res.writeHead(200, { 'content-type': 'application/json' });
    if (how === 'ok') return res.end(JSON.stringify({ jobs: [n] }));
    // Headers now, body in pieces over 600ms — well past the stall allowance.
    res.write('{"jobs":[');
    setTimeout(() => res.write('1,2,'), 300);
    setTimeout(() => res.end('3]}'), 600);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.closeAllConnections(); server.close(); });

const fresh = () => { hits = {}; };
const opts = { stallMs: 150, tries: 3, timeoutMs: 1000 };

test('a stalled request is abandoned and sent again', async () => {
  fresh();
  const t = Date.now();
  const r = await fetchPatient(base + '/stall-once', opts);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { jobs: [1] }, 'the answer came from the second attempt');
  assert.equal(hits['/stall-once'], 1, 'two requests were made');
  assert.ok(Date.now() - t < 800, 'it did not wait out the full timeout');
});

test('a slow body after prompt headers is waited for, not retried', async () => {
  fresh();
  const r = await fetchPatient(base + '/slow-body', opts);
  assert.deepEqual(await r.json(), { jobs: [1, 2, 3] });
  assert.equal(hits['/slow-body'], 0, 'one request only');
});

test('an HTTP error is an answer, not a stall — never retried', async () => {
  fresh();
  const r = await fetchPatient(base + '/missing', opts);
  assert.equal(r.status, 404);
  assert.equal(hits['/missing'], 0, 'one request only');
});

test('a request that stalls every time fails after the last attempt', async () => {
  fresh();
  const t = Date.now();
  await assert.rejects(fetchPatient(base + '/stall-always', opts));
  assert.equal(hits['/stall-always'], 2, 'three requests were made');
  const took = Date.now() - t;
  // two short waits, then the last attempt gets the whole timeout
  assert.ok(took >= 1000 && took < 2500, `took ${took}ms`);
});

test('an answer on the first try is one request', async () => {
  fresh();
  const r = await fetchPatient(base + '/fine', opts);
  assert.deepEqual(await r.json(), { jobs: [0] });
  assert.equal(hits['/fine'], 0);
});

test('crawl fetches boards through fetchPatient', () => {
  const src = fs.readFileSync(new URL('../bin/crawl.js', import.meta.url), 'utf8');
  assert.match(src, /import \{[^}]*fetchPatient[^}]*\} from '\.\.\/lib\/fetch\.js'/);
  assert.match(src, /fetchPatient\(ats\.boardUrl\(slug\)/);
  assert.doesNotMatch(src, /await fetch\(ats\.boardUrl/, 'a bare fetch would stall a worker for 17s');
});
