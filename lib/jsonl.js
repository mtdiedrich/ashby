// Appending rows to a .jsonl file, one line each.
//
// Every scorer that accumulated results and wrote once at the end has lost work to
// it: embed.js discarded 43 already-purchased vectors on a late failure, apply.js
// threw away a whole run's queue removals on Ctrl-C, and fitness.js lost every score
// in the run if it stopped early. Write as the work lands.

import fs from 'node:fs';

/**
 * Append rows as JSONL. One synchronous syscall, so concurrent callers on a
 * single-threaded runtime cannot interleave lines.
 */
export function appendRows(file, rows) {
  if (!rows?.length) return 0;
  fs.appendFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  return rows.length;
}
