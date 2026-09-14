# ashby

Find ML engineering roles across Ashby-hosted job boards, rank them against your
resume, and fill the application forms. **You choose what to apply to, and you click
submit.** Nothing here queues an application or sends one.

Two pipelines over the same set of boards.

```
   ┌─ pipeline 1 ── filtered, judged by a model ──────────────────────────────┐
   │                                                                          │
   │  slugs.txt ─► poll.js ─► fresh.jsonl ─► score.js ─► fitness.jsonl         │
   │                                                          │               │
   │                                                  ui.js ──┤ you pick      │
   │                                                          ▼               │
   │                                                    queue.jsonl           │
   │                                                          │               │
   │                                                     apply.js ─► [submit] │
   └──────────────────────────────────────────────────────────────────────────┘

   ┌─ pipeline 2 ── everything, ranked by embedding ──────────────────────────┐
   │                                                                          │
   │  slugs.txt ─► crawl.js ─► corpus.jsonl ─► embed.js ─► vectors.jsonl      │
   │                                                          │               │
   │                                                     match.js             │
   └──────────────────────────────────────────────────────────────────────────┘
```

**Pipeline 1** applies title, location and pay filters, then has Claude read each
surviving posting and score it against your resume and constraints. Precise, costs a
model call per posting, and can only find what its title regexes match.

**Pipeline 2** takes every posting on every board — no filters — embeds them, and
ranks by cosine similarity to your resume. Cheap, covers everything, and is blind to
seniority, pay, and your constraints. Use it to surface candidates pipeline 1's
filters would never see, then run those through `fitness.js`.

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
Find postings you haven't seen and stage them for scoring.

```powershell
npm run fitness
```
Judge them — should you apply. One model call per posting.

```powershell
npm run coverage
```
Break each posting into its requirements and score the resume against them one at a
time, for a coverage number and a gap list. Optional; two Haiku calls per posting.

```powershell
npm run similarity
```
Refresh the whole corpus and embed whatever changed, so every posting has a similarity
score. Cheap — cents a month after the first run.

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

### I changed context.md and want everything re-judged

`poll.js` only emits postings it hasn't judged before, so re-scoring needs it to
re-emit:

```powershell
npm run poll -- --rejudge
```
```powershell
npm run fitness
```
This re-scores every current match — it costs a model call per posting. `fitness.jsonl`
keeps both the old and new scores; the UI shows the newest and flags the spread.

### I changed the filters in poll.js

Same thing — `--rejudge` is what makes a filter change take effect on postings you've
already seen:

```powershell
npm run poll -- --rejudge; if ($?) { npm run fitness }
```

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

First time only — fetch every posting and embed them. `crawl.js` takes about a minute,
`embed.js` about four and costs ~$0.16:

```powershell
npm run crawl
```
```powershell
npm run embed
```

Then browse them in the UI — the **similar** tab next to **scored**:

```powershell
npm run ui
```

Its own filters (US only / remote only / include non-ML titles) and a **state** column
showing what pipeline 1 has done with each posting: `unseen` means the model has never
looked at it, `staged` means it is in `fresh.jsonl` waiting for `fitness.js`, then
`scored`, `queued`, `applied`. Expand any `unseen` row for a **send to score.js**
button, which stages that one posting.

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

Keeping it current is the same two commands — `crawl.js` picks up new and changed
postings, `embed.js` only embeds what actually changed, so a daily refresh is seconds
and fractions of a cent:

```powershell
npm run crawl; if ($?) { npm run embed }
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
`fresh.jsonl` and `postings.jsonl`. Don't redirect `--json` into `fresh.jsonl` by hand
for this — the field names differ and you'd score postings with no description.

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
npm run embed
```
Re-transcribes the PDF and re-embeds it. Scoring picks up the new PDF automatically —
it's sent as a document on every call, so there's nothing to regenerate.

---

## Every command

| Command | What it does |
|---|---|
| `npm run harvest` | Validate candidate slugs from `raw.txt`, merge into `slugs.txt`, 404s to `dead.txt`. Takes filenames as arguments; `--no-recheck` skips re-validating known slugs. |
| `npm run poll` | Poll every board, apply filters, emit postings not judged before. `--seed` marks everything seen without emitting. `--rejudge` re-emits every current match, for after you change the filters. |
| `npm run fitness` | Judge `fresh.jsonl` against your resume and `context.md` — a holistic 0-1 **fitness**, with reasoning. Appends to `fitness.jsonl` and truncates `fresh.jsonl`; `--keep` leaves it, for re-runs. |
| `npm run coverage` | Extract each posting's requirements and score the resume against them one by one, for a **coverage** number and a gap list. `--dry`, `--limit N`, `--force`, `--scorer opus`, `--show`. |
| `npm run gaps` | Aggregate coverage across postings — what you keep missing. `--required`, `--slug`, `--since`, `--cluster`, `--csv out.csv`. |
| `npm run ui` | Local web UI on `http://localhost:7777`. `--port N`, `--no-open`. |
| `npm run show` | Same data in the terminal. `--why` for reasoning without descriptions, plus `--queued`, `--unqueued`, `--full`, `--history`, or a company/keyword for detail. |
| `npm run apply` | Fill the forms in `queue.jsonl`. `--no-model` runs the deterministic rules only (no API call), `--limit N`, `--url <apply-url>` for a one-off. |
| `npm run test-fill -- <url>` | Run the form filler headless against any apply URL with placeholder data. No model, no submit. |
| `npm run similarity` | Refresh the corpus and embed whatever changed — `crawl` then `embed` in one command. |
| `npm run crawl` | Pipeline 2. Every posting on every board, unfiltered, into `corpus.jsonl`. `--stats` reports what's stored. |
| `npm run embed` | Embed anything new or changed, plus the resume. `--dry` prices it first, `--force` re-embeds everything. |
| `npm run match` | Rank the corpus by similarity to your resume. `--top N`, `--us`, `--remote`, `--company <slug>`, `--min 0.4`, `--json`. `--to-fresh` writes results into `fresh.jsonl` for `fitness.js`. `--all` skips the title filter; `--raw` uses uncentred cosine, for comparison. |
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
one, and a **send to score.js** button on anything unseen. It needs `crawl.js` and
`embed.js` to have run; without vectors it says so.

`ui.html` is a template the server reads per request; edit it and refresh, no restart.
Opening it as a file directly shows "nothing here" — it needs the server.

---

## Pipeline 2 — embeddings

```powershell
npm run crawl
```
```powershell
npm run embed
```
```powershell
npm run match -- --us --top 40
```

`crawl.js` stores every posting from every board, filtered by nothing. `embed.js`
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
| `seen.json` | Posting ids `poll.js` has already judged. |
| `fresh.jsonl` | Work queue: polled, not yet scored. Truncated by `fitness.js`. |
| `postings.jsonl` | Durable copy of everything `poll.js` emitted, descriptions included. |
| `fitness.jsonl` | **The log.** One line per judgement, append-only, re-scores included. Never pruned. |
| `queue.jsonl` | What you picked in the UI. The only input to `apply.js`. |
| `log.jsonl` | One line per apply attempt: what the rules filled, what the model planned, what failed. |
| `corpus.jsonl` | Pipeline 2. Every posting, unfiltered. |
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
`BLOCK_LOC`, `MAX_AGE_DAYS`. After changing them, `npm run poll -- --rejudge` re-emits
everything currently posted instead of only what's new.

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
