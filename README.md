# ashby

Finds ML engineering roles across Ashby-hosted job boards, scores them against your
resume three different ways, and fills in the application forms.

**You choose what to apply to, and you click submit.** Nothing here queues an
application or sends one.

```
                 ┌──────────────── the only network call
                 ▼
  slugs.txt ─► poll ─► corpus.jsonl ─┬─► fitness    ─► should I apply
                │      every posting │
                │                    ├─► coverage   ─► what I can demonstrate
                ▼                    │
           fresh.jsonl ──────────────┴─► similarity ─► how close it reads to my resume
          what still needs                    │
             scoring                          ▼
                                     ui ─► you pick ─► queue.jsonl ─► apply ─► [you submit]
```

---

## Setup

```powershell
npm install
```
```powershell
npx playwright install chromium
```

Three files, none of them in git:

```powershell
copy .env.example .env
```
```powershell
copy config\me.example.json config\me.json
```
```powershell
copy config\context.template.md config\context.md
```

- **`.env`** — `ANTHROPIC_API_KEY`, and `OPENAI_API_KEY` for embeddings (Anthropic has
  no embeddings endpoint).
- **`config/me.json`** — name, email, location, education, work authorization. Fills forms.
- **`config/context.md`** — your hard constraints, preferences, project write-ups, and a
  few paragraphs in your own voice.

Put your resume at **`config/resume.pdf`**. It must be a `.pdf`, `.txt`, or `.md` — the
API does not accept `.docx` as a document.

Your resume is never pasted into `context.md`. The PDF goes to the model as a document
on every call, so it stays the single source of truth. `context.md` covers only what a
resume doesn't: what you'll refuse, what you want, the detail behind the bullet points,
and the cadence the model writes in. Neither scorer can invent your specifics and both
are told not to try, so a thin `context.md` produces empty fields rather than
fabricated answers.

> **A stale environment variable silently beats `.env`.** `dotenv` does not replace
> variables that already exist, so an old `OPENAI_API_KEY` in your Windows User
> environment shadows the one you just set and every call 401s. This project passes
> `override: true` so `.env` always wins — but if another tool misbehaves, that's why.

---

## Use

```powershell
npm run poll
```

Fetches every posting from every board into `corpus.jsonl`, then writes `fresh.jsonl` —
the ones worth scoring. This is the only command that touches the network.

```powershell
npm run score
```

Scores everything staged, on all three fronts. Each scorer skips what it has already
done, so the order doesn't matter, re-running is free, and a posting stays on the
worklist until all three have seen it. Run them individually with `npm run fitness`,
`npm run coverage`, `npm run similarity` if you only want one.

Costs, per posting: **fitness** one call to your `ASHBY_MODEL`; **coverage** two Haiku
calls; **similarity** a fraction of a cent. `npm run fitness -- --dry` prices a run
before you commit to it.

Each shows a progress bar with an ETA — a 150-posting fitness run is several minutes.

```powershell
npm run ui
```

The board at `localhost:7777`. Pick what you want.

```powershell
npm run apply
```

Opens each queued posting, fills what it can, and stops.

PowerShell 5.1 has no `&&` — chain with `;`. Flags need npm's separator:
`npm run coverage -- --dry`.

---

## The board

Every posting in one sortable table, all three scores side by side, `—` for anything
not computed. They measure different things and routinely disagree — a role can have
high coverage (you meet the listed requirements) and low fitness (it's the wrong kind
of job entirely), which is the whole reason there are three columns.

Click a row for the model's reasoning, the requirement-by-requirement breakdown with
evidence, and the description. Buttons: **queue for application**, **send to scorers**,
**not interested**.

**stage top 25** in the header stages the 25 highest-similarity postings that still
need scoring, respecting whatever filters are active. That is the way to put the
embedding ranker's best guesses in front of the expensive scorers in bulk.

Queueing is the only thing that writes `queue.jsonl`, and `apply` reads nothing else.
**Not interested** writes `dismissed.jsonl` and keeps `poll` from proposing it again —
reversible, and the only "no" the system records.

Scores drift between runs on identical input. The score column shows the spread when a
posting has been judged more than once; anything straddling your threshold is being
sorted by variance, not by fit.

---

## Every command

| Command | What it does |
|---|---|
| `npm run poll` | Fetch every board into `corpus.jsonl`, rewrite `fresh.jsonl` with what still needs scoring. `--dry`, `--no-crawl`, `--all` (ignore title filter), `--anywhere` (ignore location), `--limit N`. |
| `npm run score` | All three scorers over the worklist. |
| `npm run fitness` | Should you apply — a judgement weighing role, seniority, pay, your constraints. `--dry`, `--force`. |
| `npm run coverage` | Extract each posting's requirements, score the resume against them one by one. `--dry`, `--limit N`, `--force`, `--scorer opus`, `--show`. |
| `npm run similarity` | Embed anything whose text changed, plus the resume. `--dry`, `--force`. |
| `npm run ui` | The board. `--port N`, `--no-open`. |
| `npm run apply` | Fill the queued forms. `--no-model` (rules only, no API call), `--limit N`, `--url <apply-url>`. |
| `npm run gaps` | What you keep missing, aggregated across everything. `--required`, `--slug`, `--since`, `--cluster`, `--csv out.csv`. |
| `npm run harvest` | Validate candidate slugs from `data/raw.txt` into `slugs.txt`. `--no-recheck`. |
| `npm run test-fill` | Run the form filler headless against any apply URL. No model, no submit. |
| `npm run check-docs` | Fail if this README has drifted from the code. |
| `npm test` | The suite. |

Schedule the daily fetch with Task Scheduler (`cron` isn't available):

```powershell
schtasks /create /tn "ashby-poll" /tr "cmd /c cd /d F:\Project\ashby && npm run poll >> poll.log 2>&1" /sc daily /st 06:00
```

`apply` is never scheduled — it needs you at the keyboard.

---

## Applying

`apply` opens each queued posting in a real Chrome window, uploads your resume, waits
for Ashby's own parser to backfill, fills what the deterministic rules can from
`me.json`, then asks the model about whatever is left.

Fields the model wrote are outlined **gold** — read them, they're a first draft. Fields
it refused are **red**:

- **File uploads** beyond the resume.
- **Checkboxes, always.** On these forms they are arbitration agreements, "I hereby
  certify that the answers given by me are true", and demographic self-identification.
  Nothing in this repo ticks one.
- **Anything not answerable from `context.md`.** The model skips rather than guessing,
  because a plausible invented answer on a job application is worse than a gap.

Then it stops. You fix the red fields, submit, and press Enter for the next one.

If a red field needs real work, leave it paused — Chrome runs with
`--remote-debugging-port=9222`, so you can attach Claude Code to the live tab:

> Attach to the open tab on localhost:9222. Fill the fields outlined red. Context is in
> config/context.md. Do not submit.

Worth doing once before spending a model call:

```powershell
npm run apply -- --no-model --limit 1
```

---

## Tuning

**Pay floor** — the `- Minimum base:` line under `## Hard constraints` in `context.md`.
Written in exactly one place: `poll` parses it and the model reads the same file, so
they can't drift. Accepts `$150,000`, `150000`, or `150k`. `poll` prints the floor it
is using on every run.

**Title and location filters** — `lib/filters.js`, shared by every stage. `MAX_AGE_DAYS`
is at the top of `bin/poll.js`. Changes take effect on the next `poll`; there is nothing
to invalidate, because the worklist is recomputed each run.

**Re-judging everything** — a posting is a candidate until it has been scored, so move
the score file aside rather than deleting it:

```powershell
move data\fitness.jsonl data\fitness.old.jsonl
```

**Model** — `claude-opus-5` by default: `$env:ASHBY_MODEL = "claude-sonnet-5"`.

**More companies** — Ashby has no cross-org search; each company has its own board at
`api.ashbyhq.com/posting-api/job-board/{slug}`. Put candidate slugs or pasted
`jobs.ashbyhq.com/...` URLs in `data/raw.txt` and run `npm run harvest`. To collect
them, search `site:jobs.ashbyhq.com "ML Engineer"` and run this on each results page in
DevTools:

```js
copy([...new Set([...document.querySelectorAll('a[href*="jobs.ashbyhq.com"]')]
  .map(a => new URL(a.href).pathname.split('/')[1]).filter(Boolean))].join('\n'));
```

Google CAPTCHAs headless browsers fast, which is why that step is manual. Boards on
custom domains never show up in a `site:` search — same API, different hostname.

---

## Files

```
bin/    the commands          lib/     shared modules        test/  the suite
data/   everything generated  config/  yours                 web/   ui.html
```

`data/` and `config/` are gitignored — the corpus, your resume, and the job search stay
local. Paths resolve through `lib/paths.js` rather than being named inline, so scripts
work from any directory.

| File | What it is |
|---|---|
| `slugs.txt` | Validated board slugs. Grows; never shrinks. |
| `corpus.jsonl` | Every posting from every board, unfiltered. The only store of postings. |
| `fresh.jsonl` | The worklist: staged, not yet scored on all three fronts. Rewritten by `poll`, read by every scorer, consumed by none. |
| `fitness.jsonl` | Append-only log of every judgement, re-scores included. |
| `coverage.jsonl` | Per-requirement scores and the evidence for each. |
| `requirements.jsonl` | Requirements extracted per posting, cached by content hash. |
| `vectors.jsonl` | Embeddings, base64 float32, keyed by content hash. |
| `queue.jsonl` | What you picked. The only input to `apply`. |
| `dismissed.jsonl` | What you said no to. |
| `log.jsonl` | One line per apply attempt: what filled, what failed, what was left red. |
| `dead.txt` · `raw.txt` · `candidates.txt` | Slug harvesting: rejected, pending, and the shipped seed list. |

---

## Tests

```powershell
npm test
```

Node's built-in runner over `test/`. No framework, no dependency. Covers the places
where being wrong is silent: salary parsing (hourly and monthly annualising, currency,
unstated pay), the title and location filters, whitespace normalising, the vector
maths, pay-floor parsing, and candidate selection end to end.

Written test-first — the failing test goes in before the implementation, and a bug gets
a test reproducing it before it gets a fix. Tests never touch real data:
`test/helpers.js` hands each one a temp `ASHBY_HOME` and `lib/paths.js` resolves paths
lazily so the redirection works.

---

## What the Ashby API actually does

Verified against live boards, not assumed. Each of these was wrong in the original spec
or cost real debugging:

- **`compensationTierSummary` is a string**, not an object — `"€110K – €185K • Offers
  Equity"`. Salary numbers live in `compensation.summaryComponents[]` where
  `compensationType === 'Salary'`, with `interval` and `currencyCode`. Hourly and
  non-USD ranges need annualising and converting before any comparison.
- **`isRemote` is true on Hybrid postings.** `workplaceType` is the field that means
  remote. Trusting `isRemote` skips the location check entirely and lets Tokyo through.
- **Slugs are case-insensitive** — `Ashby` and `ashby` are one board, so lowercase
  before dedupe or you poll it twice.
- A dead slug 404s. A live board with no openings returns `200 {"jobs":[]}` and is kept.
- **`descriptionPlain` is full of whitespace-only lines** — non-breaking spaces, mostly.
  One posting had 111 blank lines. `lib/text.js` normalises it.
- **The application form has no `<form>` element.** Fields are `[data-field-path]`,
  "required" is a hashed `_required_` class on the label rather than `aria-required`,
  and the autocomplete's listbox is portaled to `document.body` outside the field entry.
- Most boards publish no salary at all. A posting with no stated range **passes** the
  pay filter on purpose; the model reads the description instead.
- **Ashby dedupes candidates by email**, so an application you didn't mean to send is
  not undoable. That is what picking your own queue is for.
