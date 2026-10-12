import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// One name for the scorer. `npm run score` and `npm run fitness` were two names for
// bin/fitness.js; since 2026-10-12 it is `npm run score`, running bin/score.js. The
// data keeps its names — jev-fitness.jsonl and the `fitness` field — because renaming
// them would orphan every answer already paid for.
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('the scorer is `npm run score`, and only that', () => {
  assert.equal(pkg.scripts.score, 'node bin/score.js');
  assert.equal('fitness' in pkg.scripts, false);
  assert.ok(fs.existsSync(new URL('../bin/score.js', import.meta.url)));
  assert.equal(fs.existsSync(new URL('../bin/fitness.js', import.meta.url)), false);
});

test('nothing tells the user to run the old command', () => {
  for (const f of ['README.md', 'CLAUDE.md', 'web/ui.html', 'bin/crawl.js', 'bin/score.js']) {
    const text = fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    assert.equal(/npm run fitness/.test(text), false, `${f} still says "npm run fitness"`);
  }
});
