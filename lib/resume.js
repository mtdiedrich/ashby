// The resume is the resume — a PDF on disk, not a transcription of one.
//
// `resume.pdf` is already the file uploaded to every application form, so it is
// the single source of truth. Sending it to the model as a document block means
// there is no second plaintext copy to keep in sync, and nothing silently goes
// stale the next time the PDF is edited. The model reads the real layout too,
// which a flattened paste loses.

import fs from 'node:fs';
import path from 'node:path';
import { resumePath } from './paths.js';

export const RESUME_PATH = resumePath();

// The Messages API takes PDFs and plain text as document blocks. .docx is not a
// supported document media type — export a PDF instead of silently sending nothing.
const MEDIA = { '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/plain' };

let _block = null;

/**
 * The resume as a content block, ready to prepend to a user message.
 * Cached in memory: the file is read and encoded once per process.
 * @returns {object|null} null when no resume file is present.
 */
export function resumeBlock() {
  if (_block !== null) return _block || null;

  if (!fs.existsSync(RESUME_PATH)) {
    console.warn(`⚠  ${RESUME_PATH} not found — the model will score and write without your resume.`);
    _block = false;
    return null;
  }

  const ext = path.extname(RESUME_PATH).toLowerCase();
  const media = MEDIA[ext];
  if (!media) {
    console.warn(`⚠  ${RESUME_PATH} is ${ext}, which the API does not accept as a document. ` +
                 `Export a PDF (or set ASHBY_RESUME to one) — continuing without it.`);
    _block = false;
    return null;
  }

  const data = fs.readFileSync(RESUME_PATH);
  _block = {
    type: 'document',
    title: 'Resume',
    source: media === 'application/pdf'
      ? { type: 'base64', media_type: 'application/pdf', data: data.toString('base64') }
      : { type: 'text', media_type: 'text/plain', data: data.toString('utf8') },
    // Identical on every call, so cache it rather than re-billing the pages.
    cache_control: { type: 'ephemeral' },
  };
  return _block;
}
