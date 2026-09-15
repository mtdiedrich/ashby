// Every file the pipelines read or write, resolved from the project root.
//
// Scripts used to name data files by bare string, which meant they only worked when
// run from the project root. With the scripts in bin/ that is no longer a safe
// assumption, so everything resolves against this file's own location instead.
//
// Paths are resolved lazily, through getters. That is not decoration: it lets a test
// point ASHBY_HOME at a temp directory *after* importing a module, so the suite can
// exercise real file reads without touching your actual corpus, scores, or resume.

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const INSTALL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Project root. ASHBY_HOME overrides it, which is how the tests stay hermetic. */
export const root = () =>
  process.env.ASHBY_HOME ? path.resolve(process.env.ASHBY_HOME) : INSTALL_ROOT;

export const ROOT = INSTALL_ROOT;          // the real install, never redirected
export const data   = (name) => path.join(root(), 'data', name);
export const config = (name) => path.join(root(), 'config', name);
export const web    = (name) => path.join(root(), 'web', name);

const files = {
  // pipeline 1
  slugs:        () => data('slugs.txt'),
  candidates:   () => data('candidates.txt'),
  raw:          () => data('raw.txt'),
  dead:         () => data('dead.txt'),
  // Greenhouse board tokens live in their own files. slugs.txt/dead.txt stay Ashby's
  // so nothing already on disk has to be migrated or re-validated.
  ghSlugs:      () => data('greenhouse-slugs.txt'),
  ghDead:       () => data('greenhouse-dead.txt'),
  fresh:        () => data('fresh.jsonl'),
  fitness:      () => data('fitness.jsonl'),
  coverage:     () => data('coverage.jsonl'),
  requirements: () => data('requirements.jsonl'),
  queue:        () => data('queue.jsonl'),
  dismissed:    () => data('dismissed.jsonl'),
  log:          () => data('log.jsonl'),
  themes:       () => data('.gap-themes.json'),

  // pipeline 2
  corpus:       () => data('corpus.jsonl'),
  vectors:      () => data('vectors.jsonl'),

  // yours
  me:              () => config('me.json'),
  meExample:       () => config('me.example.json'),
  context:         () => config('context.md'),
  contextTemplate: () => config('context.template.md'),
  resumeText:      () => config('.resume-text.json'),

  // chrome profile for apply.js
  profile:      () => path.join(root(), 'profile'),

  // ui
  uiHtml:       () => web('ui.html'),
};

/** P.fresh, P.corpus, ... resolved at access time. */
export const P = Object.defineProperties({}, Object.fromEntries(
  Object.entries(files).map(([k, fn]) => [k, { get: fn, enumerable: true }])));

/** The resume. ASHBY_RESUME wins; otherwise config/resume.pdf. */
export const resumePath = () =>
  process.env.ASHBY_RESUME ? path.resolve(process.env.ASHBY_RESUME) : config('resume.pdf');

/** data/ and config/ are gitignored, so a fresh clone has neither. */
export function ensureDirs() {
  for (const d of ['data', 'config', 'web']) {
    const full = path.join(root(), d);
    if (!fs.existsSync(full)) fs.mkdirSync(full, { recursive: true });
  }
}
