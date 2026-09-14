// context.md is the single source of truth for your constraints.
//
// poll.js used to carry its own MIN_PAY constant, which meant the number lived in
// two places and quietly disagreed — the poller discarded jobs above the floor
// written in context.md, so they were never scored and never seen. Anything both
// a script and the model need to agree on gets parsed from context.md here.

import fs from 'node:fs';
import { P } from './paths.js';

// Resolved per call, not at import: a captured path cannot be redirected, which
// breaks tests and would silently survive moving the file.
const FILE = () => P.context;
const DEFAULT_MIN_PAY = 0;   // no context.md / unparseable -> filter nothing on pay

/** The "## Hard constraints" section, or '' when absent. */
function hardConstraints() {
  if (!fs.existsSync(FILE())) return '';
  const lines = fs.readFileSync(FILE(), 'utf8').split('\n');
  const start = lines.findIndex(l => /^##\s+Hard constraints\s*$/i.test(l));
  if (start === -1) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(l => /^##\s/.test(l));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

/**
 * Minimum annual base pay, in USD, from "- Minimum base: $150,000".
 * Accepts $150,000 / 150000 / 150k / $150K.
 * Returns DEFAULT_MIN_PAY (and warns) when it cannot be read, so a typo opens the
 * filter up rather than silently hiding every job.
 */
export function minimumBase() {
  const section = hardConstraints();
  const m = section.match(/minimum base\s*:\s*\$?\s*([\d,.]+)\s*(k)?/i);

  if (!m || /TODO/i.test(m[0])) {
    console.warn(`⚠  no "Minimum base:" found in ${FILE()} § Hard constraints — not filtering on pay.`);
    return DEFAULT_MIN_PAY;
  }

  let n = Number(m[1].replace(/,/g, ''));
  if (m[2]) n *= 1000;                       // "150k"
  else if (n < 1000) n *= 1000;              // "150" meaning 150k

  if (!Number.isFinite(n) || n <= 0) {
    console.warn(`⚠  could not read a pay floor from "${m[0].trim()}" in ${FILE()} — not filtering on pay.`);
    return DEFAULT_MIN_PAY;
  }
  return n;
}

/** Raw hard-constraint lines, for printing back so you can see what is in force. */
export function constraintLines() {
  return hardConstraints()
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('-'))
    .map(l => l.replace(/^-\s*/, ''));
}
