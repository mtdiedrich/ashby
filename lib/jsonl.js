// Appending rows to a .jsonl file, one line each.
//
// Every scorer that accumulated results and wrote once at the end has lost work to
// it: embed.js discarded 43 already-purchased vectors on a late failure, apply.js
// threw away a whole run's queue removals on Ctrl-C, and fitness.js lost every score
// in the run if it stopped early. Write as the work lands.

import fs from 'node:fs';
import { linesOf } from './corpus.js';

/**
 * Append rows as JSONL. One synchronous syscall, so concurrent callers on a
 * single-threaded runtime cannot interleave lines.
 */
export function appendRows(file, rows) {
  if (!rows?.length) return 0;
  fs.appendFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  return rows.length;
}

/**
 * Remove every row whose id is in `drop`, leaving other lines byte for byte — torn
 * lines included, since this is not the place to decide they are garbage. Via a temp
 * file and a rename, so a failure leaves the original. Returns how many were removed.
 * For the small derived files; the corpus has compactCorpus().
 */
export function dropRows(file, drop) {
  if (!drop?.size || !fs.existsSync(file)) return 0;
  const kept = [];
  let removed = 0;
  for (const line of linesOf(file)) {
    let id; try { id = JSON.parse(line)?.id; } catch {}
    if (id != null && drop.has(id)) removed++; else kept.push(line);
  }
  if (!removed) return 0;
  const tmp = file + '.dropping';
  fs.writeFileSync(tmp, kept.length ? kept.join('\n') + '\n' : '');
  fs.renameSync(tmp, file);
  return removed;
}
