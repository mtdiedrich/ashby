// Nothing may name a data file by bare string. A literal path silently ignores
// ASHBY_HOME, which both breaks the tests and survives the file being moved —
// context.md was missed in the bin/ reorg for exactly this reason and every
// scoring run died on it.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome, cleanup } from './helpers.js';

let home;
afterEach(() => { if (home) cleanup(home); home = null; });

const sources = () => [
  ...fs.readdirSync('bin').map(f => path.join('bin', f)),
  ...fs.readdirSync('lib').map(f => path.join('lib', f)),
].filter(f => f.endsWith('.js'));

test('no source file names a data file by bare string', () => {
  // paths.js is where the names legitimately live; check-docs names retired files
  // on purpose to exclude them.
  const exempt = new Set([path.join('lib', 'paths.js'), path.join('bin', 'check-docs.js')]);
  const offenders = [];

  for (const f of sources()) {
    if (exempt.has(f)) continue;
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/'([a-z][a-zA-Z._-]*\.(?:md|jsonl|txt|pdf|csv))'/g)) {
      if (m[1] === 'package.json') continue;
      offenders.push(`${f}: ${m[1]}`);
    }
  }
  assert.deepEqual(offenders, [], 'use lib/paths.js instead of a literal filename');
});

test('context is read from config/, and honours ASHBY_HOME', async () => {
  home = tempHome({ 'config/context.md': '## Hard constraints\n\n- Minimum base: $1\n' });
  const { context } = await import('../lib/ai.js?' + Math.random());
  assert.match(context(), /Minimum base/);
});

test('a missing context.md says which path it looked at', async () => {
  home = tempHome({});
  const { context } = await import('../lib/ai.js?' + Math.random());
  assert.throws(() => context(), (e) => e.message.includes(home) || e.message.includes('config'));
});
