import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { minimumBase, constraintLines } from '../lib/constraints.js';
import { tempHome, cleanup } from './helpers.js';

let home;
afterEach(() => { if (home) cleanup(home); home = null; });

const ctx = (line) => `# Context

## Hard constraints

Enforced.

- Location: remote US only
${line}
- Work authorization: US citizen

## Soft preferences

- Minimum base: $999,999
`;

test('reads a dollar-formatted floor', () => {
  home = tempHome({ 'config/context.md': ctx('- Minimum base: $150,000') });
  assert.equal(minimumBase(), 150000);
});

test('accepts bare digits, k-suffix and mixed case', () => {
  for (const [written, expected] of [['150000', 150000], ['150k', 150000], ['$170K', 170000], ['150', 150000]]) {
    home = tempHome({ 'config/context.md': ctx(`- Minimum base: ${written}`) });
    assert.equal(minimumBase(), expected, `for "${written}"`);
    cleanup(home); home = null;
  }
});

test('a TODO placeholder means no pay filtering, not a floor of zero-ish nonsense', () => {
  home = tempHome({ 'config/context.md': ctx('- Minimum base: TODO') });
  assert.equal(minimumBase(), 0);
});

test('a missing file means no pay filtering', () => {
  home = tempHome({});
  assert.equal(minimumBase(), 0);
});

test('only the Hard constraints section is read', () => {
  // Soft preferences also contains a "Minimum base" line; it must be ignored.
  home = tempHome({ 'config/context.md': ctx('- Minimum base: $150,000') });
  assert.equal(minimumBase(), 150000, 'must not pick up the Soft preferences value');
});

test('constraintLines returns the hard constraints verbatim', () => {
  home = tempHome({ 'config/context.md': ctx('- Minimum base: $150,000') });
  const lines = constraintLines();
  assert.ok(lines.some(l => l.startsWith('Location:')));
  assert.ok(lines.some(l => l.startsWith('Minimum base:')));
  assert.equal(lines.length, 3);
});
