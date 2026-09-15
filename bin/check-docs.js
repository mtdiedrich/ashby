// Fails if README.md has drifted from the code.
//
//   node check-docs.js
//
// The README documented 4 of 10 scripts before anyone noticed, and still described a
// workflow that had been removed. Asking for it to be kept current did not work;
// this makes the drift visible.
//
// It checks three things:
//   - every script in the project root appears in the "Every command" table
//   - every CLI flag a script actually parses is documented somewhere in the README
//   - every file the pipelines read or write appears in the "Files" table

import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url);
const at = p => new URL(p, ROOT);
const readme = fs.readFileSync(at('README.md'), 'utf8');
const scripts = fs.readdirSync(at('bin'))
  .filter(f => f.endsWith('.js') && f !== 'check-docs.js')
  .sort();

const problems = [];

// Scripts that are implementation details of an npm command rather than commands
// themselves. Their flags need no user-facing documentation.
const INTERNAL = new Set(['crawl.js', 'embed.js']);

// ---- scripts documented -------------------------------------------------
// A script counts as documented under either name: bin/poll.js or 'npm run poll'.
const documented = s => readme.includes(s) || readme.includes('npm run ' + s.replace(/.js$/, ''));
for (const s of scripts) {
  if (!documented(s)) problems.push(`script not mentioned in README: ${s}`);
}

// ---- flags documented ---------------------------------------------------
// Matches argv.includes('--x') and argv.indexOf('--x'), which is how every script
// here parses its options.
for (const s of scripts) {
  const src = fs.readFileSync(at('bin/' + s), 'utf8');
  if (INTERNAL.has(s)) continue;
  const flags = new Set([...src.matchAll(/(?:includes|indexOf)\(\s*'(--[a-z-]+)'/g)].map(m => m[1]));
  for (const f of flags) {
    if (!readme.includes(f)) problems.push(`flag not documented: ${s} ${f}`);
  }
}

// ---- data files documented ----------------------------------------------
// Anything a script reads or writes by literal name.
const dataFiles = new Set();
const RETIRED = new Set(['postings.jsonl', 'seen.json']);
const allSrc = [...scripts.map(f => 'bin/' + f), ...fs.readdirSync(at('lib')).filter(f => f.endsWith('.js')).map(f => 'lib/' + f)];
for (const s of allSrc) {
  const src = fs.readFileSync(at(s), 'utf8');
  for (const m of src.matchAll(/'([a-z][a-z0-9.-]*\.(?:jsonl|json|txt))'/g)) {
    const f = m[1];
    if (f.endsWith('package.json') || f === 'launch.json' || RETIRED.has(f)) continue;
    dataFiles.add(f);
  }
}
for (const f of [...dataFiles].sort()) {
  if (!readme.includes(f)) problems.push(`data file not documented: ${f}`);
}

// ---- report -------------------------------------------------------------
if (!problems.length) {
  console.log(`README.md covers ${scripts.length} scripts and ${dataFiles.size} data files. OK.`);
  process.exit(0);
}

console.error(`README.md is out of date — ${problems.length} problem(s):\n`);
for (const p of problems) console.error(`  ${p}`);
console.error(`\nUpdate README.md (Every command / Files / Daily use), then re-run.`);
process.exit(1);
