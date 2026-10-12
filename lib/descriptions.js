// Every posting's description, kept out of corpus.jsonl.
//
// The corpus used to hold descriptions only for titles the filter passed, because
// holding them all projected a 5.5 GB heap. The filter is gone and every posting is
// scored, so every description is needed — about 1.2 billion characters, nearly all
// of them two-byte strings once parsed. poll, crawl and the board each hold the whole
// corpus in memory; with descriptions in it that is ~2.5 GB of strings apiece against
// a 4 GB heap.
//
// So the corpus is metadata, and the text lives here, one row per posting:
//
//   {"id":"…","hash":"…","description":"…"}
//
// Append-only, newest row per id wins, like the corpus. Nothing reads it whole: an
// index of id → byte offset is built by reading only the front of each line, and a
// description is read by seeking to it. The index is cached on the file's size and
// extended incrementally as rows are appended, since the file only grows between
// compactions.

import fs from 'node:fs';
import { P } from './paths.js';
import { payFromText } from './pay-text.js';

// id and hash are written first (see splitRecord), so both come off the line's head
// without parsing a description that may be 60 KB.
const HEAD = /^\{"id":("(?:[^"\\]|\\.)*"),"hash":"([^"]*)"/;
const HEAD_BYTES = 512;
const CLOSE = 0x7d;                         // '}' — a line not ending in it is torn

const EMPTY = () => ({ file: null, ino: null, size: 0, scanned: 0, index: new Map(), rows: 0 });
let cache = EMPTY();

// Index complete lines from `from` onward. A trailing line with no newline yet is
// left for the next scan rather than indexed half-written.
function scan(file, from, index) {
  const fd = fs.openSync(file, 'r');
  const CHUNK = 1 << 20;
  const buf = Buffer.allocUnsafe(CHUNK);
  let pos = from, carry = null, carryAt = from, rows = 0;
  try {
    for (;;) {
      const n = fs.readSync(fd, buf, 0, CHUNK, pos);
      if (n <= 0) break;
      const chunk = carry ? Buffer.concat([carry, buf.subarray(0, n)]) : buf.subarray(0, n);
      const base = carry ? carryAt : pos;
      let start = 0, nl;
      while ((nl = chunk.indexOf(10, start)) !== -1) {
        let end = nl;
        if (end > start && chunk[end - 1] === 13) end--;          // CRLF
        if (end > start && chunk[end - 1] === CLOSE) {
          const m = HEAD.exec(chunk.toString('utf8', start, Math.min(end, start + HEAD_BYTES)));
          if (m) {
            let id; try { id = JSON.parse(m[1]); } catch {}
            if (id != null) { index.set(id, { hash: m[2], off: base + start, len: end - start }); rows++; }
          }
        }
        start = nl + 1;
      }
      carry = Buffer.from(chunk.subarray(start));
      carryAt = base + start;
      pos += n;
    }
  } finally { fs.closeSync(fd); }
  return { scanned: carryAt, rows };
}

/** id → { hash, off, len } of the newest row per posting. Cached; do not mutate. */
export function descriptionIndex() {
  const file = P.descriptions;
  const st = fs.existsSync(file) ? fs.statSync(file) : null;
  const size = st?.size ?? 0, ino = st?.ino ?? null;
  const same = cache.file === file && cache.ino === ino;
  if (same && cache.size === size) return cache.index;
  // Grew: append-only, so only the new tail needs reading. Anything else is a
  // rebuild — including a compaction by another process, which renames a new file
  // into place (a new inode) that may already have grown past the old size.
  const base = same && size > cache.size ? cache : { ...EMPTY(), file };
  const r = size ? scan(file, base.scanned, base.index) : { scanned: 0, rows: 0 };
  cache = { file, ino, size, scanned: r.scanned, index: base.index, rows: base.rows + r.rows };
  return cache.index;
}

/** Rows and distinct postings, for deciding when to compact. */
export function descriptionStats() {
  const index = descriptionIndex();
  return { rows: cache.rows, ids: index.size };
}

function readRow(fd, e) {
  const buf = Buffer.allocUnsafe(e.len);
  fs.readSync(fd, buf, 0, e.len, e.off);
  return buf;
}

/** One posting's stored description, or null when none is stored. */
export function descriptionOf(id) {
  const e = descriptionIndex().get(id);
  if (!e) return null;
  const fd = fs.openSync(P.descriptions, 'r');
  try {
    const d = JSON.parse(readRow(fd, e).toString('utf8')).description;
    return typeof d === 'string' ? d : null;
  } catch { return null; } finally { fs.closeSync(fd); }
}

/**
 * A posting's description, whichever shape it is in: the store first, then a
 * description the record itself carries — corpus rows written before the store
 * existed, and poll-shaped records in tests. '' when there is none anywhere.
 */
export function describe(p) {
  const stored = p?.id != null ? descriptionOf(p.id) : null;
  return stored ?? String(p?.description ?? p?.descriptionPlain ?? '');
}

/**
 * A freshly normalized posting, split for its two files. The corpus row loses the
 * text but keeps what the board needs from it: `descPay`, the pay the text states,
 * read once here so the board never needs the description to draw the pay column.
 * null means "read, and none stated" — distinct from a row that predates this.
 */
export function splitRecord(rec) {
  const { description = '', ...rest } = rec;
  return {
    meta: { ...rest, descPay: payFromText(description) },
    desc: { id: rec.id, hash: rec.hash, description },
  };
}

/**
 * Rewrite the store with the newest row of each id in `keep` — the postings still
 * live — dropping superseded rows and closed postings. Bytes are copied, not
 * re-serialized. Via a temp file and a rename, so a failure leaves the original.
 */
export function compactDescriptions({ keep }) {
  const file = P.descriptions;
  if (!fs.existsSync(file)) return { before: 0, after: 0, bytesBefore: 0, bytesAfter: 0 };
  const index = descriptionIndex();
  const before = cache.rows, bytesBefore = fs.statSync(file).size;
  const entries = [...index.entries()].filter(([id]) => keep.has(id)).sort((a, b) => a[1].off - b[1].off);

  const tmp = file + '.compacting';
  const src = fs.openSync(file, 'r');
  const out = fs.openSync(tmp, 'w');
  const NL = Buffer.from('\n');
  try {
    for (const [, e] of entries) { fs.writeSync(out, readRow(src, e)); fs.writeSync(out, NL); }
  } finally { fs.closeSync(src); fs.closeSync(out); }
  fs.renameSync(tmp, file);
  cache = EMPTY();
  return { before, after: entries.length, bytesBefore, bytesAfter: fs.statSync(file).size };
}
