// Reading the corpus. Kept separate from crawl.js so importing these does not
// kick off a crawl of 87 boards as a side effect.

import fs from 'node:fs';
import { P } from './paths.js';
import crypto from 'node:crypto';

const FILE = () => P.corpus;

const read = f => fs.existsSync(f)
  ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
  : [];

/** Newest record per posting id. */
export function corpus() {
  const latest = new Map();
  for (const r of read(FILE())) {
    const prev = latest.get(r.id);
    if (!prev || (r.fetchedAt ?? '') >= (prev.fetchedAt ?? '')) latest.set(r.id, r);
  }
  return latest;
}

export const rawLineCount = () => read(FILE()).length;

/** What gets embedded, and what the content hash is taken over. */
export const embedText = p => [
  p.title,
  p.company,
  [p.department, p.team].filter(Boolean).join(' / '),
  `${p.location}${p.workplaceType ? ' (' + p.workplaceType + ')' : ''}`,
  p.description,
].filter(Boolean).join('\n\n');

export const hash = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

/**
 * A corpus record in the shape score.js and the UI read.
 *
 * The two stores disagree on names: corpus has `company`, `description` and
 * `compensation` where the poll pipeline has `slug`, `descriptionPlain` and
 * `salary`. Handing a raw corpus record to score.js scores it against an
 * undefined company and an empty description, and nothing complains — so the
 * conversion lives here, used by both match.js and ui.js.
 */
export function asPosting(p, similarity, salaryOf) {
  const salary = salaryOf ? salaryOf(p) : null;
  return {
    slug: p.company,
    id: p.id,
    title: p.title,
    department: p.department,
    team: p.team,
    location: p.location,
    secondaryLocations: p.secondaryLocations,
    isRemote: p.isRemote,
    workplaceType: p.workplaceType,
    employmentType: p.employmentType,
    publishedAt: p.publishedAt,
    jobUrl: p.jobUrl,
    applyUrl: p.applyUrl,
    salary,
    payKnown: !!salary,
    descriptionPlain: p.description,
    ...(similarity == null ? {} : { similarity: Number(similarity.toFixed(4)) }),
  };
}
