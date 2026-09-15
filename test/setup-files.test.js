import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

// README's setup steps tell you to copy two files out of config/. .gitignore excluded
// the whole config/ DIRECTORY with `!` negations under it — and git cannot re-include
// a file whose parent directory is excluded, because it never descends into it. Both
// negations were dead and neither file was ever committed, so a fresh clone could not
// follow the setup instructions at all.

const git = (...args) => {
  try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { return null; }
};

const ignored = (path) => {
  try {
    execFileSync('git', ['check-ignore', '-q', path], { stdio: 'ignore' });
    return true;
  } catch { return false; }
};

test('the files README tells you to copy are actually in the repo', { skip: !git('rev-parse', '--git-dir') }, () => {
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  for (const f of ['config/me.example.json', 'config/context.template.md']) {
    assert.ok(readme.includes(f.split('/')[1]), `README should reference ${f}`);
    assert.equal(ignored(f), false, `${f} is gitignored, so a fresh clone will not have it`);
  }
});

test('nothing personal is committable', { skip: !git('rev-parse', '--git-dir') }, () => {
  for (const f of ['config/me.json', 'config/context.md', 'config/resume.pdf',
                   'config/.resume-text.json', 'data/corpus.jsonl', '.env']) {
    assert.equal(ignored(f), true, `${f} MUST stay ignored — it is personal`);
  }
});

test('the committed example carries no real personal data', () => {
  const ex = JSON.parse(fs.readFileSync(new URL('../config/me.example.json', import.meta.url), 'utf8'));
  const real = new URL('../config/me.json', import.meta.url);
  if (!fs.existsSync(real)) return;            // nothing to compare against
  const mine = JSON.parse(fs.readFileSync(real, 'utf8'));
  for (const key of ['name', 'email', 'phone', 'street', 'postalCode', 'linkedin', 'github']) {
    if (mine[key] == null || ex[key] == null) continue;
    assert.notEqual(String(ex[key]).toLowerCase(), String(mine[key]).toLowerCase(),
      `me.example.json's ${key} is your real value — it is committed`);
  }
});
