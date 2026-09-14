// Test helpers: a throwaway ASHBY_HOME so tests read and write real files without
// touching your corpus, scores, resume, or queue.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Fresh temp home. Returns the path; call cleanup() when done. */
export function tempHome(files = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ashby-test-'));
  for (const d of ['data', 'config', 'web']) fs.mkdirSync(path.join(home, d), { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(home, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  process.env.ASHBY_HOME = home;
  return home;
}

export function cleanup(home) {
  delete process.env.ASHBY_HOME;
  try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
}

export const jsonl = rows => rows.map(r => JSON.stringify(r)).join('\n') + '\n';

/** A posting shaped like one from the Ashby API. */
export const posting = (over = {}) => ({
  id: over.id ?? 'id-1',
  title: over.title ?? 'Machine Learning Engineer',
  department: 'Engineering', team: 'ML',
  location: over.location ?? 'Remote',
  secondaryLocations: over.secondaryLocations ?? [],
  isRemote: over.isRemote ?? true,
  workplaceType: over.workplaceType ?? 'Remote',
  employmentType: 'FullTime',
  publishedAt: over.publishedAt ?? '2026-09-01T00:00:00.000Z',
  jobUrl: 'https://jobs.ashbyhq.com/acme/id-1',
  applyUrl: 'https://jobs.ashbyhq.com/acme/id-1/application',
  descriptionPlain: over.descriptionPlain ?? 'We need someone to train models.',
  compensation: over.compensation ?? null,
  ...over,
});

/** compensation block in the real API shape. */
export const comp = (min, max, { currency = 'USD', interval = '1 YEAR' } = {}) => ({
  compensationTierSummary: `$${min} – $${max}`,
  scrapeableCompensationSalarySummary: `$${min} - $${max}`,
  compensationTiers: [],
  summaryComponents: [
    { compensationType: 'Salary', interval, currencyCode: currency, minValue: min, maxValue: max },
  ],
});

/** A record as crawl.js stores it in corpus.jsonl. */
export const corpusRecord = (over = {}) => ({
  id: over.id ?? 'c-1',
  company: over.company ?? 'acme',
  title: over.title ?? 'Machine Learning Engineer',
  department: 'Engineering', team: 'ML',
  location: over.location ?? 'Remote',
  secondaryLocations: over.secondaryLocations ?? '',
  isRemote: true,
  workplaceType: over.workplaceType ?? 'Remote',
  employmentType: 'FullTime',
  publishedAt: over.publishedAt ?? new Date().toISOString(),
  jobUrl: 'https://jobs.ashbyhq.com/acme/c-1',
  applyUrl: 'https://jobs.ashbyhq.com/acme/c-1/application',
  compensation: over.compensation ?? null,
  description: over.description ?? 'Train and serve models.',
  fetchedAt: over.fetchedAt ?? new Date().toISOString(),
  hash: over.hash ?? 'h1',
  ...over,
});
