# ashby

Find ML engineering roles across Ashby-hosted job boards, rank them against your
resume, and fill the application forms. **You choose what to apply to, and you click
submit.** Nothing here queues an application or sends one.

Two pipelines over the same set of boards.

```
  slugs.txt ─► poll ──────────────► corpus.jsonl ──► similarity ─► vectors.jsonl
                 │                      every posting, unfiltered
                 │  the only fetch
                 ▼  selects candidates
                    fresh.jsonl ──► fitness   ──► fitness.jsonl    should I apply
                                └─► coverage  ──► coverage.jsonl   what I can demonstrate
                                                       │
                                     ui: one board ◄───┘   you pick / dismiss
                                          │
                                          ▼
                                     queue.jsonl ──► apply ──► [you submit]
```

**Pipeline 1** applies title, location and pay filters, then has Claude read each
surviving posting and score it against your resume and constraints. Precise, costs a
model call per posting, and can only find what its title regexes match.

**Pipeline 2** takes every posting on every board — no filters — embeds them, and
ranks by cosine similarity to your resume. Cheap, covers everything, and is blind to
seniority, pay, and your constraints. Use it to surface candidates pipeline 1's
filters would never see, then run those through `fitness.js`.

---

## Layout

```
ashby/
  bin/      the commands — one script per stage
  lib/      shared modules (paths, filters, comp, select, vectors, the DOM filler)
  test/     the suite
  data/     everything generated: corpus, vectors, scores, queue, logs
  config/   yours: resume.pdf, me.json, context.md
  web/      ui.html
  profile/  Chrome profile apply.js reuses, so logins survive between runs
```

`data/` and `config/` are gitignored — the corpus, your resume, and the job search
itself stay local. Every path resolves through `lib/paths.js` rather than being named
inline, so scripts work from any working directory and a file can be moved in one
place.

---

## Setup

```powershell
npm install
```
```powershell
npx playwright install chromium
```

Three files, none of which are in git:

```powershell
copy .env.example .env
```
```powershell
copy configme.example.json configme.json
```
```powershell
copy configcontext.template.md configcontext.md
```

- **`.env`** — `ANTHROPIC_API_KEY` for scoring and form-filling. `OPENAI_API_KEY`
  only if you use pipeline 2 (Anthropic has no embeddings endpoint).
- **`me.json`** — name, email, location, education, work authorization. Fills forms.
- **`context.md`** — your constraints, preferences, projects, and writing voice.

Put your resume at **`config/resume.pdf`** (or set `ASHBY_RESUME`). It must be a `.pdf`,
`.txt`, or `.md` — the API does not accept `.docx` as a document.

Your resume is **not** pasted into `context.md`. The PDF is sent to the model directly
as a document on every call, so it stays the single source of truth — edit the PDF and
both scoring and answers pick it up with no transcription step.

`context.md` covers only what a resume doesn't: hard constraints, soft preferences, the
detail behind the bullet points, and a few unpolished paragraphs the model matches your
cadence from. Neither script can invent your specifics and both are told not to try, so
a thin `context.md` produces empty fields rather than fabricated answers.

> **A stale environment variable beats `.env`.** `dotenv` does not replace variables
> that already exist, so an old `OPENAI_API_KEY` in your Windows User environment will
> silently shadow the one you just set and every call will 401. This project passes
> `override: true` so `.env` always wins — but if another tool misbehaves, that's why.

---

## Daily use

Five commands, one per thing you might want.

```powershell
npm run poll
```
Fetch every posting from every board, then stage anything nothing has judged,
staged, or dismissed. This is the only command that hits the network.

```powershell
npm run score
```
Score every staged posting on all three fronts — **fitness** (should you apply),
**coverage** (what fraction of the requirements you can demonstrate), **similarity**
(how close it reads to your resume).

Each scorer skips what it has already done, so the order does not matter, re-running
costs nothing, and a posting stays on the worklist until all three have seen it. You
can still run them one at a time — `npm run fitness`, `npm run coverage`,
`npm run similarity` — if you only want one.

```powershell
npm run ui
```
The board at `http://localhost:7777`. All three numbers side by side, `—` for anything
not computed. Pick what you want and queue it.

```powershell
npm run apply
```
Opens each queued posting, fills what it can, and stops. You submit.

Nothing is queued automatically, and nothing is ever submitted for you.

Flags need npm's separator: `npm run coverage -- --dry`, `npm run match -- --us --top 40`.


---

## Recipes

Every command is listed below; these are the orders you actually run them in.

### First time — from nothing to your first application

```powershell
npm install; npx playwright install chromium
```
Then create `.env`, `me.json`, `context.md` and drop in `resume.pdf` (see **Setup**).
Fill in at least the four **Hard constraints** lines — they do the most work.

```powershell
npm run poll
```
```powershell
npm run fitness
```
```powershell
npm run ui
```
Pick what you want, then dry-run the form filler once before spending a model call:

```powershell
npm run apply -- --no-model --limit 1
```
It opens a real browser on a real posting, uploads your resume and fills what the
deterministic rules can, without calling the API. Confirm your `me.json` values land in
the right fields, then:

```powershell
npm run apply
```

### Every morning

```powershell
npm run poll; if ($?) { npm run fitness }
```
Then `npm run ui` when you want to pick, `npm run apply` when you're at the keyboard.

### I changed context.md or the filters and want things re-judged

A posting is a candidate while nothing has judged it, so re-judging means clearing
what was judged. `fitness.jsonl` is append-only history — move it aside rather than
deleting it, and the UI keeps showing the old scores until new ones land:

```powershell
move data\fitness.jsonl data\fitness.old.jsonl
```
```powershell
npm run poll; if ($?) { npm run fitness }
```

That re-stages and re-judges everything currently matching, at one model call per
posting. For a smaller taste, `npm run poll -- --limit 20` caps what gets staged.

A pay-floor or filter change needs no special flag: `poll` re-reads `context.md` and
`lib/filters.js` every run, so the next run simply selects differently.

### I want to watch more companies

Put candidate slugs or pasted `jobs.ashbyhq.com/...` URLs in `raw.txt`, then:

```powershell
npm run harvest
```
```powershell
npm run poll; if ($?) { npm run fitness }
```
Every posting on a newly added board is new, so expect a burst — including roles that
have been open for months. `MAX_AGE_DAYS` in `poll.js` caps that if you want it.

### I want to see postings ranked by embedding similarity

First time only — `poll` fetches every posting, then `similarity` embeds them.
About five minutes and ~$0.16:

```powershell
npm run poll
```
```powershell
npm run similarity
```

Then browse them on the board:

```powershell
npm run ui
```

Its own filters (US only / remote only / include non-ML titles) and a **state** column
showing what has happened to each posting: `unseen` (nothing has looked at it),
`staged` (waiting in `fresh.jsonl`), `judged`, `queued`, `applied`, and `dismissed`
for anything you said no to. Expand a row for **send to scorers**, which stages that
one posting, and **not interested**, which keeps `poll` from proposing it again.

Or the same ranking in the terminal:

```powershell
npm run match -- --us --top 40
```

Useful variations:

```powershell
npm run match -- --remote --top 25
```
```powershell
npm run match -- --company deepgram
```
```powershell
npm run match -- --us --min 0.15 --top 100
```
```powershell
npm run match -- --us --top 25 --all
```
`--all` drops the title filter, so you also see the roles whose titles don't look like
ML at all — sometimes the point of having the broad net. `--raw` turns off centring if
you want to see what the uncentred scores look like.

Keeping it current is your normal daily `poll`, then `similarity` to vectorise what
changed — seconds and fractions of a cent:

```powershell
npm run poll; if ($?) { npm run similarity }
```

### I want the broad net judged properly, not just ranked

Similarity is recall, not fit. To put the best of it in front of the real judge:

```powershell
npm run match -- --us --top 60 --to-fresh
```
```powershell
npm run fitness
```
Those then appear in `npm run ui` like anything else, with reasoning and concerns, and
you queue from there.

`--to-fresh` converts corpus records into the shape `fitness.js` expects and writes both
`fresh.jsonl`. Don't redirect `--json` into `fresh.jsonl` by hand
for this — the field names differ and you'd score postings with no description.

### I do not want to see this posting again

Open it in the board and hit **not interested**. That writes `dismissed.jsonl` and
`poll` stops proposing it. Reversible — the row shows as `dismissed` with an
**un-dismiss** button.

There is no "seen" list any more. A posting is a candidate exactly while nothing has
judged it, staged it, or dismissed it — all facts already on disk, rather than a
separate ledger that can drift out of step with them.

### Why did it reject that one?

```powershell
npm run show -- --unqueued --why
```
Or open `npm run ui` and read the **unqueued** tab. Every score carries a one-line
reason and a list of concerns.

### A form filled wrong on some board

```powershell
npm run test-fill https://jobs.ashbyhq.com/<company>/<id>/application
```
Headless, placeholder data, no model, no submit. Prints every field it found, the kind
it detected, what the rules filled and what was left over. To watch it in a real
browser instead:

```powershell
npm run apply -- --url https://jobs.ashbyhq.com/<company>/<id>/application --no-model
```

### I edited my resume

```powershell
npm run similarity
```
Re-transcribes the PDF and re-embeds it. Scoring picks up the new PDF automatically —
it's sent as a document on every call, so there's nothing to regenerate.

---

## Every command

| Command | What it does |
|---|---|
| `npm run harvest` | Validate candidate slugs from `raw.txt`, merge into `slugs.txt`, 404s to `dead.txt`. Takes filenames as arguments; `--no-recheck` skips re-validating known slugs. |
| `npm run poll` | **The only command that talks to the job boards.** Fetches every posting into `corpus.jsonl`, then stages candidates into `fresh.jsonl`: anything matching your filters that nothing has judged, staged, or dismissed. `--no-crawl` skips the fetch, `--dry` shows without staging, `--all` ignores the title filter, `--anywhere` the location filter, `--limit N` caps it. |
| `npm run score` | Run all three scorers over the worklist: fitness, then coverage, then similarity. Each skips what it has already done, so order does not matter and re-running is free. |
| `npm run fitness` | Judge `fresh.jsonl` against your resume and `context.md` — a holistic 0-1 **fitness**, with reasoning. Appends to `fitness.jsonl` and truncates `fresh.jsonl`; `--keep` leaves it, for re-runs. |
| `npm run coverage` | Extract each posting's requirements and score the resume against them one by one, for a **coverage** number and a gap list. `--dry`, `--limit N`, `--force`, `--scorer opus`, `--show`. |
| `npm run gaps` | Aggregate coverage across postings — what you keep missing. `--required`, `--slug`, `--since`, `--cluster`, `--csv out.csv`. |
| `npm run ui` | Local web UI on `http://localhost:7777`. `--port N`, `--no-open`. |
| `npm run show` | Same data in the terminal. `--why` for reasoning without descriptions, plus `--queued`, `--unqueued`, `--full`, `--history`, or a company/keyword for detail. |
| `npm run apply` | Fill the forms in `queue.jsonl`. `--no-model` runs the deterministic rules only (no API call), `--limit N`, `--url <apply-url>` for a one-off. |
| `npm run test-fill -- <url>` | Run the form filler headless against any apply URL with placeholder data. No model, no submit. |
| `npm run similarity` | Embed any posting whose text changed since last time, plus the resume. Reads the corpus; does not fetch. `--dry` prices it first, `--force` re-embeds everything. |
| `npm run match` | Rank the corpus by similarity to your resume. `--top N`, `--us`, `--remote`, `--company <slug>`, `--min 0.4`, `--json`. `--to-fresh` writes results into `fresh.jsonl` for `fitness.js`. `--all` skips the title filter; `--raw` uses uncentred cosine, for comparison. |
| `npm test` | Run the test suite — Node's built-in runner over `test/`. No dependencies. |
| `npm run check-docs` | Fails if this README has drifted from the code — an undocumented script, flag, or data file. |

### Scheduling

`cron` isn't available. Register a Task Scheduler job:

```powershell
schtasks /create /tn "ashby-poll" /tr "cmd /c cd /d F:\Project\ashby && npm run poll >> poll.log 2>&1 && npm run fitness >> score.log 2>&1" /sc daily /st 06:00
```

`apply.js` is never scheduled — it needs you at the keyboard.

---

## The UI

`npm run ui` serves a sortable table: score, state, title, company, location, pay, days
live. Click any row to expand — the model's reasoning and concerns on the left, the job
description on the right.

**Queueing is the only thing that writes `queue.jsonl`.** Scoring ranks; you decide.
`apply.js` reads that file and nothing else.

The score column shows a spread when a posting has been scored more than once
(`0.45–0.60`). Scores move between runs on identical input — that's ordinary model
variance, so treat a score as a bucket, not a measurement.

The **similar** tab shows pipeline 2 instead: the whole corpus ranked by embedding
similarity to your resume, with a `state` column for what pipeline 1 has done with each
one, and a **send to scorers** button on anything unseen. It needs `npm run poll` and `npm run similarity` to have run; without vectors it says so.

`ui.html` is a template the server reads per request; edit it and refresh, no restart.
Opening it as a file directly shows "nothing here" — it needs the server.

---

## Pipeline 2 — embeddings

```powershell
npm run poll
```
```powershell
npm run similarity
```
```powershell
npm run match -- --us --top 40
```

`poll` stores every posting from every board, filtered by nothing. `similarity`
embeds anything without a current vector — dedupe is by **content hash of the exact
text embedded**, so a re-listed posting is skipped and an edited one re-embeds
automatically. Haiku transcribes `resume.pdf` to text once (cached in
`.resume-text.json`, keyed by a hash of the PDF) so there's something to embed.

Vectors are OpenAI `text-embedding-3-small`, 1536 dims, stored base64-Float32 in
`vectors.jsonl` — about a third the size of JSON arrays and much faster to parse.
Everything is normalized on write, so similarity is a plain dot product.

The first full pass is ~5,100 postings and about **$0.16**; after that it's only what
changed, so cents a month.

Hand promising matches to the real judge:

```powershell
npm run match -- --us --top 60 --to-fresh
```

`--to-fresh` rewrites corpus records into the shape `fitness.js` reads. The two stores
use different field names (`company`/`description`/`compensation` versus
`slug`/`descriptionPlain`/`salary`), so redirecting `--json` into `fresh.jsonl` by hand
scores every posting with an empty description and says nothing about it.

Scores are **centred**: the corpus mean is subtracted before comparing. Every job
posting shares the same register and vocabulary, so raw vectors all point roughly the
same way and plain cosine ranks boilerplate density — on this corpus it squeezed every
result into 0.503–0.532 and put an intern and an engineering manager in the top 25.
Centring leaves what makes a posting distinct, which spread the same results across
0.116–0.234. `--raw` gives the old behaviour back for comparison.

The title filter from `poll.js` applies here too (`lib/filters.js`, shared by both
pipelines), so interns, managers and firmware roles do not take up slots. `--all`
includes them.

Cosine similarity measures **topical overlap, not fit**. It will rank an ML role at a
company you'd never join above a perfect role described in unusual words, and it knows
nothing about seniority, pay, or your hard constraints. Its value is recall.

---

## Files

| File | What it is |
|---|---|
| `slugs.txt` | Validated Ashby board slugs. Grows; never shrinks. |
| `fresh.jsonl` | The worklist: staged and not yet scored on all three fronts. Rewritten by `poll`, read by every scorer, consumed by none. |
| `fitness.jsonl` | **The log.** One line per judgement, append-only, re-scores included. Never pruned. |
| `queue.jsonl` | What you picked in the UI. The only input to `apply.js`. |
| `log.jsonl` | One line per apply attempt: what the rules filled, what the model planned, what failed. |
| `corpus.jsonl` | **Every posting from every board**, unfiltered. The only store of postings. |
| `dismissed.jsonl` | Postings you said no to in the UI, so `poll` stops proposing them. |
| `vectors.jsonl` | Pipeline 2. Embeddings, keyed by content hash. |
| `coverage.jsonl` | Per-requirement scores and evidence, from `coverage.js`. |
| `requirements.jsonl` | Requirements extracted per posting, cached by posting hash. |
| `candidates.txt` | Seed list of company slugs shipped with the repo. |
| `dead.txt` | Slugs that 404'd. |

---

## Growing the slug list

Ashby has no cross-org search. Each company has its own board behind one public,
unauthenticated endpoint:

```
GET https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true
```

`slugs.txt` ships with 87 validated boards. To add more, put candidates — bare slugs or
pasted `jobs.ashbyhq.com/...` URLs, both work — in `raw.txt` and run `npm run harvest`.

To collect candidates, search Google for `site:jobs.ashbyhq.com "ML Engineer"` with the
time filter set to the past year, and on each results page run this in DevTools:

```js
copy([...new Set([...document.querySelectorAll('a[href*="jobs.ashbyhq.com"]')]
  .map(a => new URL(a.href).pathname.split('/')[1]).filter(Boolean))].join('\n'));
```

Google CAPTCHAs headless browsers quickly, which is why this step is manual on purpose.
Boards on custom domains never appear in a `site:` search — same API, different
hostname, add those by hand.

---

## Tuning

**Pay floor** — `- Minimum base:` under `## Hard constraints` in `context.md`. That line
is the only place it's written: `poll.js` parses it and the model reads the same file,
so they can't drift. Accepts `$150,000`, `150000`, or `150k`. `poll.js` prints the floor
it's using on every run.

**Title and location filters** — top of `poll.js`: `WANT`, `REJECT`, `US_LOC`,
`BLOCK_LOC` in `lib/filters.js`, shared by every stage, and `MAX_AGE_DAYS` at the top
of `bin/poll.js`. Changes take effect on the next `npm run poll` — there is nothing to
invalidate, because candidate selection is computed fresh each run.

**Fill rules** — `RULES` in `lib/fill.browser.js`, matched against the field label.
Values come from `me.json`.

**Model** — `claude-opus-5` by default:

```powershell
$env:ASHBY_MODEL = "claude-sonnet-5"
```

---

## Red fields

`apply.js` outlines model-filled fields **gold** — read them, they're a first draft.
Fields it wouldn't answer are **red**:

- **File uploads** beyond the resume (cover letter, portfolio).
- **Checkboxes, always.** On these forms they're arbitration agreements, "I hereby
  certify that the answers given by me are true", and demographic self-identification.
  Nothing in this repo ticks one.
- **Anything not answerable from `context.md`.** The model is told to skip rather than
  guess, because a plausible invented answer on a job application is worse than a gap.

If a red field needs real work, leave `apply.js` paused at its Enter prompt — Chrome
runs with `--remote-debugging-port=9222`, so you can attach Claude Code to the live tab:

> Attach to the open tab on localhost:9222. Fill the fields outlined red. Context is in
> context.md. Do not submit.

---

## Tests

```powershell
npm test
```

Node's built-in runner over `test/`. No framework, no dependency, covering the parts
where being wrong is silent: salary parsing (hourly and monthly annualising,
currency conversion, unstated pay), the title and location filters, whitespace
normalising, the vector maths, pay-floor parsing, and candidate selection end to end.

This project is written test-first. The failing test goes in before the implementation,
and a bug gets a test reproducing it before it gets a fix.

Tests never touch your real data. `test/helpers.js` hands each one a temp `ASHBY_HOME`,
and `lib/paths.js` resolves paths lazily so that redirection works. That matters more
than it sounds: the suite's first file-reading test found that modules were capturing
their paths at import time, which made them both untestable and silently immune to the
file ever moving.

---

## Notes on the API

Verified against live boards, 2026-09-13:

- `compensation.compensationTierSummary` is a **string** (`"€110K – €185K • Offers Equity"`),
  not an object. Salary numbers live in `compensation.summaryComponents[]` where
  `compensationType === 'Salary'`, with `interval`, `currencyCode`, `minValue`,
  `maxValue`. `lib/comp.js` annualises hourly/monthly, converts to USD, and compares
  against the **top** of a stated range.
- Most boards publish no salary. A posting with no stated range **passes** the hard
  filter on purpose; `pay_ok: "not_stated"` marks them.
- **`isRemote` is true for Hybrid postings too.** `workplaceType` is the field that
  actually means remote. Trusting `isRemote` skips the location check entirely.
- Slugs are case-insensitive — `Ashby` and `ashby` are one board. Everything is
  lowercased before dedupe.
- A dead slug 404s. A live board with no openings returns `200 {"jobs":[]}` and is kept.
- `descriptionPlain` is full of whitespace-only lines (non-breaking spaces). `lib/text.js`
  normalises it; one posting had 111 blank lines.
- The application form has **no `<form>` element**. Fields are `[data-field-path]`, and
  required is signalled by a hashed `_required_` class on the label, not `aria-required`.
  The autocomplete's listbox is portaled to `document.body`, outside the field entry.
- Ashby dedupes candidates by email, so an application you didn't want to send is not
  undoable. That's what picking your own queue is for.
