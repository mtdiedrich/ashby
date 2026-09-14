// Every file the pipelines read or write, resolved from the project root.
//
// Scripts used to name data files by bare string, which meant they only worked when
// run from the project root. With the scripts in bin/ that is no longer a safe
// assumption — npm runs them from the root, but nothing stops you invoking one
// directly from somewhere else. Resolving against this file's own location makes
// the working directory irrelevant.

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const at = (dir) => (name) => path.join(ROOT, dir, name);
export const data   = at('data');
export const config = at('config');
export const web    = at('web');

/** Generated state. Nothing here is precious except by accumulation. */
export const P = {
  // pipeline 1
  slugs:        data('slugs.txt'),
  candidates:   data('candidates.txt'),
  raw:          data('raw.txt'),
  dead:         data('dead.txt'),
  seen:         data('seen.json'),
  fresh:        data('fresh.jsonl'),
  postings:     data('postings.jsonl'),
  fitness:      data('fitness.jsonl'),
  coverage:     data('coverage.jsonl'),
  requirements: data('requirements.jsonl'),
  queue:        data('queue.jsonl'),
  log:          data('log.jsonl'),
  themes:       data('.gap-themes.json'),

  // pipeline 2
  corpus:       data('corpus.jsonl'),
  vectors:      data('vectors.jsonl'),

  // yours
  me:           config('me.json'),
  meExample:    config('me.example.json'),
  context:      config('context.md'),
  contextTemplate: config('context.template.md'),
  resumeText:   config('.resume-text.json'),

  // chrome profile for apply.js
  profile:      path.join(ROOT, 'profile'),

  // ui
  uiHtml:       web('ui.html'),
};

/** The resume. ASHBY_RESUME wins; otherwise config/resume.pdf. */
export const resumePath = () =>
  process.env.ASHBY_RESUME ? path.resolve(process.env.ASHBY_RESUME) : config('resume.pdf');

/** data/ and config/ are gitignored, so a fresh clone has neither. */
export function ensureDirs() {
  for (const d of ['data', 'config', 'web']) {
    const full = path.join(ROOT, d);
    if (!fs.existsSync(full)) fs.mkdirSync(full, { recursive: true });
  }
}
