// A progress bar for the scorers.
//
// fitness, coverage and embed each grew their own counter, in three different
// styles, and fitness printed a fresh line per batch — twenty lines of scrollback
// for one run and no idea how long it had left. A 153-posting fitness run is
// minutes; it should say so.
//
// Writes to stderr so piping stdout stays clean, and falls back to plain lines
// when stderr is not a terminal (a cron log should not be full of \r).

const isTTY = () => process.stderr.isTTY === true;

/** "12s", "3m 20s", or '' when there is nothing to extrapolate from. */
export function eta(done, total, elapsedMs) {
  if (done <= 0 || done >= total) return '';
  const perItem = elapsedMs / done;
  const left = Math.round((total - done) * perItem / 1000);
  if (left < 60) return `${left}s`;
  return `${Math.floor(left / 60)}m ${String(left % 60).padStart(2, '0')}s`;
}

/** The bar as a string. Pure, so the shape of it is testable. */
export function render({ done, total, width = 24, label = '', elapsedMs = 0 }) {
  const safeTotal = Math.max(total, 0);
  const safeDone = Math.min(Math.max(done, 0), safeTotal);
  const frac = safeTotal > 0 ? safeDone / safeTotal : 0;
  const filled = Math.round(frac * width);

  const bar = '█'.repeat(filled) + ' '.repeat(Math.max(0, width - filled));
  const pct = `${Math.round(frac * 100)}%`.padStart(4);
  const left = eta(safeDone, safeTotal, elapsedMs);

  return `${label ? label + ' ' : ''}[${bar}] ${pct}  ${safeDone}/${safeTotal}${left ? '  ~' + left + ' left' : ''}`;
}

/**
 * A live bar. `tick()` after each unit of work, `finish()` when done.
 *
 *   const p = progress(jobs.length, 'judging');
 *   for (...) { ...; p.tick(); }
 *   p.finish();
 */
export function progress(total, label = '') {
  const started = Date.now();
  let done = 0;
  let lastLine = 0;

  const draw = () => {
    const line = render({ done, total, label, elapsedMs: Date.now() - started });
    if (isTTY()) {
      process.stderr.write('\r' + line + '  ');
    } else if (done === total || Date.now() - lastLine > 15_000) {
      // Non-interactive: a line occasionally, not a carriage-return smear.
      process.stderr.write(line + '\n');
      lastLine = Date.now();
    }
  };

  draw();
  return {
    tick(n = 1) { done = Math.min(done + n, total); draw(); },
    set(n) { done = Math.min(Math.max(n, 0), total); draw(); },
    finish() {
      done = total;
      if (isTTY()) { draw(); process.stderr.write('\n'); }
      const secs = Math.round((Date.now() - started) / 1000);
      process.stderr.write(`${label || 'done'}: ${total} in ${secs}s\n`);
    },
  };
}
