// Vector storage and similarity.
//
// Vectors live in vectors.jsonl as base64 Float32 rather than JSON number arrays.
// A 1024-dim vector is 4KB of binary and ~13KB as JSON text, and the corpus runs to
// thousands of postings — the difference is a 20MB file versus a 70MB one, and a
// parse that takes a second rather than fifteen.

import fs from 'node:fs';
import { P } from './paths.js';

const STORE = P.vectors;

export const encode = v => Buffer.from(new Float32Array(v).buffer).toString('base64');
export const decode = b64 => {
  const buf = Buffer.from(b64, 'base64');
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
};

/** Unit-length in place, so similarity is a plain dot product. */
export function normalise(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

/** Cosine similarity. Assumes both are already normalised. */
export function dot(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

/**
 * Mean of a set of vectors — the "everything in this corpus" direction.
 *
 * Embeddings drawn from one domain nearly all point the same way: every job
 * posting shares the same register, boilerplate and vocabulary, so raw cosine
 * against a resume lands every single one in a band a few hundredths wide and
 * ranks boilerplate density rather than relevance.
 */
export function mean(vectors) {
  const it = vectors[Symbol.iterator]();
  const first = it.next();
  if (first.done) return null;
  const acc = new Float64Array(first.value.length);
  let n = 0;
  for (const v of vectors) {
    for (let i = 0; i < acc.length; i++) acc[i] += v[i];
    n++;
  }
  const out = new Float32Array(acc.length);
  for (let i = 0; i < acc.length; i++) out[i] = acc[i] / n;
  return out;
}

/**
 * Subtract the corpus mean, then re-normalise. What is left is what makes this
 * posting different from every other posting, which is the part worth comparing.
 */
export function centre(v, mu) {
  if (!mu) return v;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] - mu[i];
  return normalise(out);
}

/**
 * Stored vectors, newest per key.
 * @returns {Map<string, {key, hash, model, dim, v: Float32Array}>}
 */
export function load() {
  if (!fs.existsSync(STORE)) return new Map();
  const out = new Map();
  for (const line of fs.readFileSync(STORE, 'utf8').split('\n')) {
    if (!line) continue;
    try {
      const r = JSON.parse(line);
      out.set(r.key, { ...r, v: decode(r.b64) });
    } catch { /* skip a torn line rather than lose the file */ }
  }
  return out;
}

/** Append vectors. Each row: {key, hash, model, dim, b64, at}. */
export function append(rows) {
  if (!rows.length) return;
  const lines = rows.map(r => JSON.stringify({
    key: r.key,
    hash: r.hash ?? null,
    model: r.model,
    dim: r.v.length,
    b64: encode(r.v),
    at: new Date().toISOString(),
  }));
  fs.appendFileSync(STORE, lines.join('\n') + '\n');
}
