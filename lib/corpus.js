// Reading the corpus. Kept separate from crawl.js so importing these does not
// kick off a crawl of 87 boards as a side effect.

import fs from 'node:fs';
import { P } from './paths.js';
import crypto from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';

const FILE = () => P.corpus;

/**
 * Every non-empty line of a file, without ever holding the whole thing as a string.
 *
 * corpus.jsonl passed Node's maximum string length (0x1fffffe8, about 512 MB) and
 * `readFileSync(f, 'utf8')` threw ERR_STRING_TOO_LONG, taking down poll, crawl and
 * the board at once. Synchronous on purpose: corpus() is called from a dozen places
 * that are not async, and making it async would ripple through all of them.
 *
 * StringDecoder rather than buf.toString() per chunk, because a multi-byte character
 * landing across a chunk boundary would otherwise be cut in half and come back as
 * replacement characters — corrupting descriptions silently rather than failing.
 */
export function* linesOf(file) {
  if (!fs.existsSync(file)) return;
  const CHUNK = 1 << 20;
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.allocUnsafe(CHUNK);
  const decoder = new StringDecoder('utf8');
  let carry = '';
  try {
    for (;;) {
      const n = fs.readSync(fd, buf, 0, CHUNK, null);
      if (n <= 0) break;
      const parts = (carry + decoder.write(buf.subarray(0, n))).split('\n');
      carry = parts.pop();
      for (const line of parts) if (line) yield line;
    }
    carry += decoder.end();
    if (carry) yield carry;
  } finally { fs.closeSync(fd); }
}

const read = (f) => {
  const out = [];
  for (const line of linesOf(f)) {
    try { out.push(JSON.parse(line)); } catch { /* a torn line is skipped, as before */ }
  }
  return out;
};

/** A corpus row, as crawl.js writes it — not a poll-shaped one. */
const isCorpusShaped = r => r && typeof r.id === 'string' && 'company' in r && !('descriptionPlain' in r);

/** Newest record per posting id. Rows of the wrong shape are ignored. */
export function corpus() {
  const latest = new Map();
  for (const r of read(FILE())) {
    if (!isCorpusShaped(r)) continue;
    const prev = latest.get(r.id);
    if (!prev || (r.fetchedAt ?? '') >= (prev.fetchedAt ?? '')) latest.set(r.id, r);
  }
  return latest;
}

export const rawLineCount = () => read(FILE()).length;

/**
 * What gets embedded, and what the content hash is taken over.
 *
 * Reads either record shape. embed.js works off fresh.jsonl, which holds poll-shaped
 * records (slug, descriptionPlain), while the corpus holds company/description — if
 * the two produced different text, the content hash would differ for the same posting
 * and every one of them would re-embed on the next run.
 */
export const embedText = p => [
  p.title,
  p.company ?? p.slug,
  [p.department, p.team].filter(Boolean).join(' / '),
  `${p.location ?? ''}${p.workplaceType ? ' (' + p.workplaceType + ')' : ''}`.trim(),
  p.description ?? p.descriptionPlain,
].filter(Boolean).join('\n\n');

export const hash = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

/**
 * A corpus record in the shape score.js and the UI read.
 *
 * The two stores disagree on names: corpus has `company`, `description` and
 * `compensation` where the poll pipeline has `slug`, `descriptionPlain` and
 * `salary`. Handing a raw corpus record to score.js scores it against an
 * undefined company and an empty description, and nothing complains — so the
 * conversion lives here, used wherever a corpus record reaches the scorers.
 */
export function asPosting(p, similarity, salaryOf) {
  const salary = salaryOf ? salaryOf(p) : null;
  return {
    slug: p.company,
    id: p.id,
    // Carried through so queue.jsonl knows which ATS a posting came from; apply.js
    // only fills Ashby forms and must not open one it cannot read.
    ats: p.ats ?? 'ashby',
    title: p.title,
    department: p.department,
    team: p.team,
    location: p.location,
    secondaryLocations: p.secondaryLocations,
    isRemote: p.isRemote,
    workplaceType: p.workplaceType,
    employmentType: p.employmentType,
    publishedAt: p.publishedAt,
    jobUrl: p.jobUrl,
    applyUrl: p.applyUrl,
    salary,
    payKnown: !!salary,
    descriptionPlain: p.description,
    ...(similarity == null ? {} : { similarity: Number(similarity.toFixed(4)) }),
  };
}

/**
 * Rewrite corpus.jsonl keeping only the newest row per posting.
 *
 * The corpus is append-only: a posting re-crawled with different content is written
 * again rather than replaced, and readers take the newest. That is fine until a
 * change touches most of the file at once — a storage-policy change rewrote 60,903
 * Ashby rows, the file passed Node's 512 MB string limit, and every command that
 * reads it died at once.
 *
 * Two passes, so the whole corpus is never held in memory: the first records which
 * line number wins for each id, the second copies those lines out. Written to a temp
 * file and renamed, so a failure leaves the original intact rather than a half file.
 */
export function compactCorpus() {
  const file = FILE();
  if (!fs.existsSync(file)) return { before: 0, after: 0, bytesBefore: 0, bytesAfter: 0 };
  const bytesBefore = fs.statSync(file).size;

  // Pass 1 — the winning line for each id. Only ids and line numbers are kept here,
  // never the records themselves.
  const winner = new Map();
  let n = 0, before = 0;
  for (const line of linesOf(file)) {
    const i = n++;
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (!isCorpusShaped(r)) continue;
    before++;
    const prev = winner.get(r.id);
    // >= so a tie resolves to the later line, matching corpus().
    if (!prev || (r.fetchedAt ?? '') >= prev.at) winner.set(r.id, { at: r.fetchedAt ?? '', i });
  }
  const keep = new Set([...winner.values()].map(w => w.i));
  if (before === keep.size && before === n) {
    return { before: n, after: n, bytesBefore, bytesAfter: bytesBefore };
  }

  // Pass 2 — copy the winners out, then swap.
  const tmp = file + '.compacting';
  const out = fs.openSync(tmp, 'w');
  try {
    let i = 0, buf = [];
    for (const line of linesOf(file)) {
      if (keep.has(i++)) buf.push(line);
      if (buf.length >= 2000) { fs.writeSync(out, buf.join('\n') + '\n'); buf = []; }
    }
    if (buf.length) fs.writeSync(out, buf.join('\n') + '\n');
  } finally { fs.closeSync(out); }

  fs.renameSync(tmp, file);
  return { before: n, after: keep.size, bytesBefore, bytesAfter: fs.statSync(file).size };
}
