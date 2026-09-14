// Plain text of the resume, for embedding.
//
// The scoring pipeline sends resume.pdf to Claude as a document block and never
// needs it as text. The embedding pipeline does — vectors are made from strings.
// Haiku transcribes the PDF once and the result is cached next to it, keyed by a
// hash of the file, so editing the PDF re-transcribes and nothing else does.

import fs from 'node:fs';
import { P } from './paths.js';
import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import 'dotenv/config';
import { RESUME_PATH, resumeBlock } from './resume.js';

const CACHE = P.resumeText;
const MODEL = 'claude-haiku-4-5';

export async function resumeText() {
  if (!fs.existsSync(RESUME_PATH)) throw new Error(`${RESUME_PATH} not found`);
  const fileHash = crypto.createHash('sha256').update(fs.readFileSync(RESUME_PATH)).digest('hex').slice(0, 16);

  if (fs.existsSync(CACHE)) {
    const c = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
    if (c.hash === fileHash && c.text) return c.text;
  }

  const doc = resumeBlock();
  if (!doc) throw new Error(`cannot read ${RESUME_PATH} as a document`);

  console.log(`transcribing ${RESUME_PATH} with ${MODEL}...`);
  const client = new Anthropic();
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: 'Transcribe the attached resume to plain text. Preserve every role, date, ' +
            'technology, metric, and bullet exactly as written. No commentary, no summary, ' +
            'no markdown fences - the transcription only.',
    messages: [{ role: 'user', content: [doc, { type: 'text', text: 'Transcribe it.' }] }],
  });

  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  if (!text) throw new Error('transcription came back empty');

  fs.writeFileSync(CACHE, JSON.stringify({ hash: fileHash, model: MODEL, at: new Date().toISOString(), text }, null, 1));
  console.log(`  ${text.length} chars cached in ${CACHE}`);
  return text;
}
