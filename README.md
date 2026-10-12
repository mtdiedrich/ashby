# ashby

Collects every posting from every Ashby and Greenhouse board it knows, scores each one
against your resume, and fills in the application forms. The only filter is
location: US roles, and roles open to the US, are scored and shown. Nothing is filtered
by title, pay or age — the board ranks rather than hides.

**You choose what to apply to, and you click submit.** Nothing here queues an
application or sends one.

```
                 ┌──────────────── the only network call
                 ▼
  slugs.txt ─► poll ─► corpus.jsonl  +  descriptions.jsonl
                │      every posting     every description
                ▼
           fresh.jsonl ─────────────────► fitness    ─► am I qualified for this
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

- **`.env`** — `ANTHROPIC_API_KEY`, and `JEV_API_KEY` from TypeSafe AI, which scores
  every posting.
- **`config/me.json`** — name, email, phone, street and postcode, location, education,
  work authorization, pay expectations. Fills forms.
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
> variables that already exist, so an old API key in your Windows User
> environment shadows the one you just set and every call 401s. This project passes
> `override: true` so `.env` always wins — but if another tool misbehaves, that's why.

---

## Use

```powershell
npm run poll
```

Fetches every posting from every board into `corpus.jsonl` and every description into
`descriptions.jsonl`, drops postings their boards no longer list, then writes
`fresh.jsonl` — every US posting not yet scored. This is the only command that fetches
postings.

```powershell
npm run score
```

Scores everything staged: one Jev call per posting asking two questions — are you
qualified for it, and is it the kind of work your resume shows — about $0.00012 each.
It skips what it has already answered, so re-running is free, and a posting stays on
the worklist until it has been scored. `npm run score -- --dry` prices a run first;
`-- --limit N` scores only N, and `-- --jobs N` sends N requests at once (default 6).

```powershell
npm run levels
```

Optional. For scored postings that publish no pay, looks the company up on levels.fyi
and records what people there reported, so the board can show an estimate. Free, and
anything looked up in the last 30 days is skipped. See **Pay estimates** under the board.

```powershell
npm run ui
```

The board at `localhost:7777`. Pick what you want.

```powershell
npm run apply
```

Opens each queued posting, fills what it can, and stops.

PowerShell 5.1 has no `&&` — chain with `;`. Flags need npm's separator:
`npm run score -- --dry`.

---

## The board

Every posting in one sortable table, `—` for anything not computed.

**qualified** and **aligned**, the first two columns, are the model scores: Jev's
answers to two questions about the posting's title, company and whole description and
your resume, each as a probability. **qualified** asks whether your resume meets the
role — *is the candidate qualified for this job?* **aligned** asks the reverse, whether
the role meets your resume — *is this the kind of work, domain and level the resume
shows?* They part ways on a role far below your level, or a catch-all "join our talent
community" page: qualified, not aligned. See **Fitness, both ways** below. Postings with
no stored description are left blank rather than judged on a title.

Click a row for both scores, the pay sentence when pay came from the description, and
the description itself. Buttons: **queue for application**, **send to scorers**,
**not interested**.

**Score ranges** — the row of `min`/`max` boxes under fitness, fresh and value hides
every posting outside them. Bounds are inclusive and compared at the two decimals the
cell shows; bounds on different columns must all hold; a posting with no value for a
bounded column is hidden. The ranges only hide rows — unlike the header toggles they
refetch nothing, so `value` does not re-scale as you narrow. **clear ranges** resets them;
otherwise they are remembered in that browser.

**Pay** — the pay column takes its figure from three places, in order:

1. the posting's own pay field;
2. pay stated in the description — many postings leave the field empty and write
   "Salary range: $150,000 to $250,000 USD annually" into the text instead. Read by
   `lib/pay-text.js` and drawn like posted pay; hover says it came from the
   description, and the expanded row quotes the sentence. Ranges are read anywhere; a
   single figure only in a sentence about pay; millions, funding rounds and benefits
   ("up to $25K reimbursement", "housing subsidy of $2,500 per month") never. Regional
   bands give their full span; USD is preferred when a posting lists several
   currencies;
3. only then a levels.fyi estimate.

**Pay estimates** — where a posting states no pay anywhere, the pay column can show a
levels.fyi estimate in italics, marked **est.**, once `npm run levels` has run:

- **exact** — the posting's title is one of the company's own level titles;
- **same level** — the same seniority (Senior, Staff, Lead…) at that company;
- **all levels** — the company's US base across every level, shown as its 25th–75th
  percentile, when the title carries no seniority to match on.

The line under it names the level and how many submissions it rests on (`n=`), and the
tooltip gives the source and total comp. US figures only: levels.fyi's company-wide
numbers sometimes describe another country even on its US page, and those are dropped.
A company with no levels.fyi page or no usable US data gets nothing — never a market
rate or another company's numbers. Many smaller companies have only a handful of
submissions; weigh `n=` accordingly.

Estimates are for reading only. Nothing that filters, ranks or scores postings reads
them, and sorting by pay ranks published pay alone. Glassdoor and Indeed are not used:
both answer automated requests with a bot check.

Queueing is the only thing that writes `queue.jsonl`, and `apply` reads nothing else.
**Not interested** writes `dismissed.jsonl` and keeps `poll` from proposing it again —
reversible, and the only "no" the system records.

Two of the columns are derived, and they are what you actually sort on:

**fresh** — how much of its value the posting still has, with its age underneath. Halves
every 7 days: listed today 1.00, a week old 0.50, a month 0.05. Exponential because
value does not fall off evenly — a job listed today is worth applying to, one a week old
has lost ground to everyone who applied first, and 200 versus 300 days is nothing. It is
absolute, so a posting does not become fresher because something older turned up beside
it. `HALF_LIFE_DAYS` in `lib/composite.js` if you want it gentler.

**value** — the geometric mean of qualified, aligned and fresh. Each score is min-maxed
across the rows currently shown first: they run low while freshness spans the whole of
0..1, so unscaled, freshness would quietly outweigh them. That makes the score parts
relative — the best in view counts as 1 — and they re-scale when you change the
filters. Geometric, not average, so a posting has to be decent on all three: a role
you are overqualified for does not outrank a real match, and a perfect fit listed
months ago does not outrank a good one posted this week. With three parts freshness
carries a third of the weight rather than half, so a stale posting is held back less
than it was under the one-score value. This is the default sort; sort by
**qualified** or **aligned** for the best matches regardless of age.

Value is blank until all three exist — including for a posting scored before
2026-10-12, which has a qualified answer and no aligned one until the next
`npm run score`. An unscored posting is unknown, not bad.
Parts are floored at 0.02 before the geometric mean, because min-max always puts the
lowest row at exactly 0 and a geometric mean with a zero in it is zero — without the
floor those rows collapse and lose every distinction below them.

Freshness is not min-maxed. It **halves every 7 days** — listed today scores 1.00, a
week old 0.50, a fortnight 0.25, a month 0.05, and anything past two months is
effectively zero. Applying early is most of the advantage a job board gives you, and a
linear scale does not express that. It is also absolute, so a posting does not get
fresher because something older turned up beside it. `HALF_LIFE_DAYS` in
`lib/composite.js` if you want it gentler.

---

## Every command

| Command | What it does |
|---|---|
| `npm run poll` | Fetch every board into `corpus.jsonl` and `descriptions.jsonl`, drop closed postings, rewrite `fresh.jsonl` with every US posting not yet scored. `--dry`, `--no-crawl`, `--limit N`, `--jobs N` (boards fetched at once, default 12), `--ats ashby|greenhouse` (fetch just one). |
| `npm run score` | Score the worklist: asks Jev two questions about each posting, given the whole posting and your resume — are you qualified for it, and is it the kind of work your resume shows — about $0.00012 each. `--dry` (price it), `--limit N` (score at most N), `--force` (ask again even if answered), `--rescore` (ask again for every posting ever scored whose answer is to an older version of the questions), `--jobs N` (requests at once, default 6). Was the `fitness` script until 2026-10-12. |
| `npm run levels` | levels.fyi pay estimates for scored US postings that state no pay, in their pay field or their description. Display only. `--dry` (list the pages, fetch nothing), `--refresh` (ignore the 30-day memory), `--limit N` (at most N company pages), `--jobs N` (pages at once, default 1), `--delay MS` (wait between pages, default 1500 — levels.fyi has a bot check and stops the run when it trips). |
| `npm run ui` | The board. `--port N`, `--no-open`. |
| `npm run cost` | What the model calls have cost, by what spends it. `--last` (the most recent run), `--runs` (one line per run), `--batch` (the same totals at the Batch API's 50%). |
| `npm run apply` | Fill the queued forms, then ask whether you submitted each one. `--no-model` (rules only, no API call), `--limit N`, `--url <apply-url>`, `--wait-parse N` (seconds to wait for Ashby's resume parser, default 3). |
| `npm run harvest` | Find and validate new company boards. `--discover` searches the four crawl sources; `--wayback`, `--hn`, `--github`, `--commoncrawl` each pick one; `--yc` guesses from the YC directory (opt-in, see below); `--greenhouse` harvests Greenhouse boards instead of Ashby; with none of those it reads `data/raw.txt`. `--no-recheck` skips re-validating boards you already have. |
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
- **Agreements and certifications, always.** Arbitration clauses, "I hereby certify
  that the answers given by me are true", consent boxes. Nothing in this repo agrees
  to anything on your behalf.
- **Anything not answerable from `context.md`.** The model skips rather than guessing,
  because a plausible invented answer on a job application is worse than a gap.

### Fitness, both ways

Two scores, from [Jev](https://docs.typesafe.ai) (TypeSafe AI), asked in one request per
posting: its title, company and whole description, and your resume, with two yes/no
questions answered as probabilities.

| | asks | low when |
|---|---|---|
| **qualified** (`fitness`) | *Based on their resume, the candidate is qualified for this job.* — does the resume meet the role | the resume falls short in experience, skills or level |
| **aligned** (`alignment`) | *This job is a close match for the work the candidate's resume shows they do.* — does the role meet the resume | the role is unrelated, or far above or far below the resume's level |

The second question costs almost nothing: the posting and resume are billed once per
request, and adding it measured at 2% more input tokens (989 → 1,008). A run is still
about $0.00012 a posting. On a sample of 24 real postings, qualified matched its old
one-question answers within 0.01, while aligned took "AI Generalist (No Experience
Required)" from 0.92 to 0.18, entry-level associate roles to 0.2–0.3 and catch-all
talent-community pages to about 0.5, and kept real ML roles at 0.8–0.9.

Qualified is the last of several single scores. Embedding similarity, a Sonnet judgement of fit, a combined
`score`, and requirement coverage (Haiku extracting each posting's requirements, Jev
asking whether the resume shows each one) were all dropped on 2026-10-02. Coverage went
last, after 100 postings where it and fitness disagreed by 0.25 or more were judged by
hand: fitness was closer in 90, with a mean error of 0.08 against coverage's 0.35.
Coverage averaged the requirements that decide a job — a PhD, ten years, Staff level —
in with generic ones anyone meets, and ran about a third of a point optimistic. Fitness
reads the posting whole; its weakness is running a little low on genuine fits, which
the min-max scaling in `value` absorbs.

Answers are cached per description, resume and version of the questions. The version
changed when the second question was added (2026-10-12), so every posting answered
before then is back on the worklist and the next `npm run score` asks it both;
`--rescore` asks again for everything scored under an older version. Jev's spend is printed by the
command itself; `npm run cost` only counts Anthropic calls.

Their data files were deleted the same day.

### The board stays responsive

The table ships only what a row draws — 0.2 MB for 600 rows. Descriptions are fetched
per posting when you expand it, and kept, so collapsing and re-expanding costs nothing.

Every matching row is sent and sorted, but only 300 are painted at a time; "show more"
paints another 300 without refetching. Painting all 2,871 was 48,000 DOM nodes and
about 290ms of layout on every render.

With no title filter the board covers every US posting — over 150,000 — so it
sends the top 5,000 (`?limit=`, up to 20,000) ordered by `value`, the same column the
page sorts on, so the slice is exactly the head of what you would see. It used to order by fitness
(since dropped) and send the top 600, which silently dropped every posting under two
days old — they scored below the fitness cutoff and never reached the browser at all.

That was 5.8 MB before, all of it rebuilt as HTML on every keystroke in the filter
box, including 600 detail panes hidden behind CSS. Typing was unusable. The filter is
also debounced now, and `corpus.jsonl` is cached on mtime rather than re-parsed per
request — 246,000 postings is about 1.5 seconds a parse, and it was paying that on
every board load *and* every row you opened.

Measured after: 8 keystrokes block the main thread for 0 ms; `/api/detail` returns in
under 100 ms.

### A posting that cannot finish

A posting is only *finished* once it has a fitness score, and `poll` re-stages anything
that isn't — so a posting that can never get one is re-staged on every run, forever.

**Re-listed postings.** Answers are cached by content — title, company, location and
description, paired with the resume — but recorded under a posting id, and
`finished()` looks postings up *by id*. When a company deletes and re-posts a job the
description is byte-identical, so the answer exists while nothing downstream sees it.
The answer is copied to the new id, free, and the run says so (`re-listed, copied
free: N`).

**Postings with no description.** Judging one on its title alone would be a confident
number about nothing, so it is skipped and counted (`N skipped, no description`). It
still won't finish; dismiss it from the board if you want it gone.

### What a run costs

```powershell
npm run cost
```

Every model call appends its `usage` to `data/usage.jsonl`, so this is measured
rather than estimated. Measured over ~1,000 postings:

| | share of the bill | per posting |
|---|---|---|
| fitness (Sonnet 5, effort `high`) — since dropped | 73% | $0.0080 |
| coverage — extract (Haiku) — since dropped | 17% | $0.0034 |
| coverage — score (Haiku, then Jev) — since dropped | 10% | $0.0049 |

That was the bill while those scorers ran. Scoring is now a single Jev call, about
$0.00012 a posting, and no Anthropic tokens at all; `apply` is the Anthropic spend.

`--runs` separates concurrent runs. Two scoring runs at once write to the same log,
and before run ids existed their spend blended.

### How long a run takes

`poll` fetches every board on both systems — around 10,000 of them, a few minutes —
and shows a bar with an ETA while it does. Greenhouse's API sometimes sits on a request
for up to 20 seconds before answering; a board that has not started responding within
3 seconds is asked again (up to three tries), so those stalls no longer set the pace:

```
Ashby: 3918 boards
Greenhouse: 6103 boards
fetching boards [█████████               ]  38%  3820/10021  ~2m 14s left
```

Selecting from the corpus afterwards takes a couple of seconds. It used to read the
whole 190 MB file four times in one run; it reads it once.


Scoring is almost entirely waiting on the API, so it runs several requests at once.
Measured on 24 postings:

| | |
|---|---|
| `--jobs 1` (sequential) | 6m 19s |
| `--jobs 6` (default) | 1m 32s |

A full 500-posting run is roughly 25 minutes rather than two hours. Raise it with
`--jobs N` or `ASHBY_JOBS=N`; the ceiling is your account's tokens-per-minute limit,
and past it you get 429s, which `ask()` retries with backoff — so overshooting costs
time rather than results.

`--jobs 1` restores the old sequential behaviour, which is worth having when you are
debugging a prompt and want the output in order.

The first request of every run goes out alone. It writes the prompt cache — your
`context.md` and resume PDF — and everything after reads it at a fraction of the
price. Starting all six at once would have all six miss and each pay the write.

`poll` passes `--jobs` through to the board fetch, where it defaults to 12.

### Pay expectations

`me.json` carries two numbers:

```json
"salaryExpectation": 165000,
"hourlyRate": 150
```

**Neither is a screening floor.** Nothing is filtered out on them — they are only what
gets typed into a "salary expectations" box. There is no screening floor at all since
2026-10-03: every posting is scored, and `Minimum base` in `context.md` is read only
by the model, as a constraint. `npm test` asserts the selection code never reads the
ask.

Which one is used depends on the engagement, not on the field's name — boards label a
contract rate box "salary expectations" all the time:

| | asks |
|---|---|
| Salaried role | `salaryExpectation`, annual |
| Contract role, or any posting quoting an hourly range | `hourlyRate`, per hour |
| Field says "hourly"/"annual" explicitly | that, overriding the above |

**If the posting publishes a range and your number is below the bottom of it, the ask
rises to just above their floor instead** — 5%, rounded up to a whole thousand (or a
multiple of 5 for an hourly rate). Asking $165K against a posted $205K–$300K band
anchors you below what they have already budgeted, so it asks $216,000.

The bump only happens against a stated USD floor. A range in another currency is left
alone rather than converted into a negotiating position at a guessed exchange rate,
and a posting with no published range just gets your stated number. If pay is a
drop-down of bands rather than a free-text box, it is left red — which band to pick is
a judgement call about a boundary, not a lookup.

**Self-identification questions are handled deterministically, before the model sees
them.** Gender, ethnicity/race, veteran status and disability are set to that field's
own decline option — "Decline to Self Identify", "I don't wish to answer", "I prefer
not to answer", whatever the board happens to call it. The wording differs per field
and per board, so this matches a phrase rather than a literal.

It only ever selects an option that explicitly declines. If a board offers no way to
decline, the field is left red for you. It will never select "I am not a protected
Veteran" or "No, I do not have a disability" — those are substantive answers, and the
tool does not make claims about you. Set `"declineSelfIdentify": false` in `me.json`
if you would rather answer these yourself.

Then it stops and asks:

```
  Submitted?
    [y] yes, submitted
    [n] no, drop from queue
    [k] not yet, keep in queue
    [s] stop here, keep in queue
```

Nothing here submits anything, so this is your answer rather than something the tool
can observe. It is recorded **as you answer**, one posting at a time — a run you
interrupt keeps everything you already dealt with.

| | |
|---|---|
| `y` | logged as submitted, dropped from the queue, shows **submitted** on the board |
| `n` | logged, dropped from the queue, shows **opened** — seen, not sent |
| `k` | stays in the queue and the tab stays open, so the next run reopens it |
| `s` | stops the run; this posting stays in the queue along with the rest |
| anything else | not an answer: it says so and asks again. It used to count as `n`, so a typo dropped the posting from the queue. |

The board separates the two: **submitted** means you said yes. Opening a form and
closing it used to count as applying, which made the board claim applications that
were never made.

### Two job boards

Both Ashby and Greenhouse publish an unauthenticated API listing every open posting
for a company, so both feed one corpus. `lib/ats.js` holds everything specific to
each: the endpoint, the response shape, and the conversion to a corpus record.

```powershell
npm run harvest -- --greenhouse
```

That finds and validates Greenhouse boards; `npm run poll` then crawls both. Greenhouse
is most of the corpus — about 167,000 postings against Ashby's 62,000.

Four differences are worth knowing, all checked against live boards:

| | Ashby | Greenhouse |
|---|---|---|
| description | plain text | **escaped HTML**, unescaped and stripped on the way in |
| pay | structured, on ~38% | **none published** — 42 of Stripe's 639 mention it even in prose |
| remote | `workplaceType` | inferred from the location string, `null` when it says nothing |
| employment type | published | not published |

So a Greenhouse posting almost always shows no pay. That is the board being honest
rather than a bug: the pay column falls back to pay stated in the description, then a
levels.fyi estimate, and the salary ask falls back to your `me.json` figure with no
floor to clear.

**`apply` fills both boards.** `lib/fill.browser.js` detects which one it is on and
reads the matching DOM — Ashby's `[data-field-path]` entries, or Greenhouse's
`#application-form` with its `.field-wrapper`, `.select__container` and `.file-upload`
containers. Anything else is still refused and opened not at all, rather than
producing a page of red.

Which board a posting belongs to is decided by `atsOf()`, which prefers the record's
own `ats` field and otherwise infers from the `greenhouse:` id prefix and the board
host. It has to infer, because queue rows used to be copied from the fitness record,
which did not always carry the field — which is how a Greenhouse posting once spent 30 seconds
waiting for an Ashby selector before failing.

**One Greenhouse limitation.** Its comboboxes are react-select, which ignores the
synthesized pointer events the in-page filler dispatches. Self-identification is
handled from outside the page with a trusted click, so gender, ethnicity, veteran and
disability are declined properly. Other Greenhouse comboboxes — country, "are you
authorized to work", and similar — cannot be filled in-page and are reported as *not
applied* rather than claimed. Every fill now verifies itself and fails if the field is
still empty afterwards, because a rule that reports success without effect is worse
than one that fails.

### What the corpus stores

**Every description is stored, in its own file.** Until 2026-10-03 the corpus kept
descriptions only for titles the filter passed, because all of them in `corpus.jsonl`
projected a 5.5 GB heap — poll, crawl and the board each hold the whole corpus in
memory. With the filter gone every posting is scored and every description is needed,
about 1.2 billion characters. So `corpus.jsonl` is metadata (~900 bytes a posting) and
the text goes to `descriptions.jsonl`, which nothing reads whole: an index of id → byte
offset is built from the front of each line, and a description is read by seeking to
it — once to hash it and once to ask Jev about it, never held for a whole run.

The pay a description states is read once at crawl time and kept on the corpus row as
`descPay`, so the board's pay column never needs the text. The worklist carries no
descriptions either; 225,000 of them were 1.3 GB.

**Closed postings are dropped.** When a board answers and no longer lists a posting,
the crawl takes it out of `corpus.jsonl`, `descriptions.jsonl`, `fresh.jsonl` and
`pay-estimates.jsonl`, so it leaves the board and the worklist. A board that fails or times out closes nothing,
and neither does one that answers with no postings at all — that looks the same as a
board having a bad moment. Fitness rows are kept, since a re-listing with the same
text reuses them; `log.jsonl`, `queue.jsonl` and `dismissed.jsonl` are history and
are never pruned.

**The corpus compacts itself.** It is append-only — a posting re-crawled with changed
content is written again and readers take the newest — so a change that touches many
postings at once leaves every superseded row behind. Introducing the policy above
rewrote 60,903 Ashby rows in one pass, the file reached 555 MB, and it crossed Node's
maximum string length (about 512 MB), at which point `poll`, `crawl` and the board all
died with `ERR_STRING_TOO_LONG`.

Nothing reads the file as one string any more, and `crawl` now rewrites it whenever
the dead rows exceed a quarter of the live ones, or the file nears that limit. That
took 555 MB back to 189 MB. `node bin/crawl.js --compact` forces it by hand.
`descriptions.jsonl` is append-only on the same terms and compacted on the same rule —
after any closure, or once a quarter of its rows are superseded.

### Postal address

Boards ask for one on about 1% of forms — 2 of 178 scanned — and when they do it is a
textarea wanting the whole thing, not a street line. So `me.json` keeps the parts:

```json
"street": "100 Example Ave",
"postalCode": "52401"
```

and they are composed with `location` into `100 Example Ave` / `Cedar Rapids, Iowa 52401`
(over two lines in a textarea, comma-joined in a single-line input). There is no second
copy of your city to keep in step.

A standalone zip field is also filled, though none of the 178 forms had one.

The one thing to know: **"Email Address" is a more common label than any real address
field.** The email rule normally claims it first, but only when an email is configured —
so the address rule refuses email, website, LinkedIn, GitHub and `Address Line 2`
outright rather than relying on rule order.

### Startup delay

`apply` waits for Ashby's own resume parser to backfill your name before it starts
filling, because a late backfill would overwrite what it typed. Boards that do this
take about a second. Boards that never do it used to cost a flat 15 seconds each —
measured at 15,002ms of a 20,337ms startup. The wait is now 3 seconds and it says
which happened; `--wait-parse N` raises it if you hit a slow board.



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

**Filters** — one: location. `poll` stages, `fitness` scores and the board shows
only postings in the US or open to it — `usLocation()` in `lib/filters.js`, through
`inUS()` in `lib/select.js`. A US city, state name or state code ("St. Louis, MO",
"Killeen, Tx", "Olathe KS", "TX - Carrollton"), "Remote", "United States",
"Anywhere", "Worldwide", "Global" or "North America" counts. Any country, Canadian
province or foreign region in the primary location rules a posting out — "Remote –
Ukraine", "Colombia - Fully Remote", "CA - Toronto", "Toronto, ON, CA" — even with
a US office in its secondary locations, unless that primary location names a US place
too ("Remote (US/Canada)", "Vancouver, WA", "Panama City, FL"). A location naming no
country ("Hybrid", "HQ") is left out. The title, pay-floor and age filters were removed on 2026-10-03. The
crawl still stores non-US postings, so widening this needs no re-fetch. To narrow
further, use the board's toggles, score ranges and search box — they hide rows, they
never stop anything being scored.

**Re-scoring everything** — `npm run score -- --rescore --force` asks again for every
posting ever scored.

**Model** — `apply` asks `claude-opus-5` by default: `$env:ASHBY_MODEL = "claude-sonnet-5"`.

**More companies** — Ashby has no cross-org search; each company has its own board at
`api.ashbyhq.com/posting-api/job-board/{slug}`, so coverage is entirely a question of
how many slugs you know.

```powershell
npm run harvest -- --discover
```

Three automatable sources, none needing a browser or a key.

**Wayback Machine** (`--wayback`) is the one that matters. The CDX index answers
"every URL ever crawled under this host", which is the question we actually have —
the other two can only find a board somebody chose to link to. One request returns
about 200,000 archived URLs and some 6,400 distinct slugs, and 94% of everything the
other two found is already in it. It takes about a minute.

**Hacker News** (`--hn`) — the monthly "Who is hiring" threads are thick with Ashby
apply links, and Algolia indexes every comment behind a public API. Seconds.

**GitHub code search** (`--github`) — some 32,000 indexed files mention
`jobs.ashbyhq.com`, and the API returns the matching text fragment, so slugs come
straight out of the results without fetching a file. GitHub allows 10 code-search
requests a minute, so this one takes ten minutes of mostly waiting.

**Common Crawl** (`--commoncrawl`) — a second URL index over a different crawl. Largely
a subset of Wayback's: of 2,059 slugs it returned, 1,734 were already known live and
281 already known dead. One pass is worth it, but it is not another Wayback.

**Y Combinator** (`--yc`, opt-in) — the only source that is not a crawl, and so the
only one that can find a board nobody has ever linked to or archived. YC publishes its
whole directory, and Ashby is common among its companies: 507 of the boards already
known were reachable from a YC name, slug or domain. The trade is precision — about
2.3% of untested candidates are live, averaging under two postings each, and every
candidate costs a validation request. It is not part of `--discover` because it is a
guess rather than a sighting.

Slugs are always validated before they are kept. The archive is historical, so about
half of what it turns up is a company that has since moved ATS or folded — that is
expected, and the dead ones go to `dead.txt` so they are not re-checked from scratch
next time. Validation is the slow part of a big run: a few thousand candidates at
twelve concurrent requests takes several minutes.

Re-run it occasionally. It is cheap, and each new board arrives with its whole back
catalogue, so expect a burst of old postings the first time one appears.

To add boards by hand, put slugs or pasted `jobs.ashbyhq.com/...` URLs in
`data/raw.txt` and run `npm run harvest`. A Google search for
`site:jobs.ashbyhq.com "ML Engineer"` with this in DevTools on each results page still
works, it is just manual — Google CAPTCHAs headless browsers fast:

```js
copy([...new Set([...document.querySelectorAll('a[href*="jobs.ashbyhq.com"]')]
  .map(a => new URL(a.href).pathname.split('/')[1]).filter(Boolean))].join('\n'));
```

Boards on custom domains never show up in a `site:` search — same API, different
hostname, add those by hand.

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
| `corpus.jsonl` | Every posting from every board, unfiltered — metadata, plus `descPay`, the pay its description states. The only store of postings. |
| `descriptions.jsonl` | Every posting's description, one row per posting and content hash, newest wins. Written by the crawl (and by the board's stage button for a posting it lacks); read by `fitness` and the board's expanded row, by byte offset. |
| `fresh.jsonl` | The worklist: every US posting not yet scored, without descriptions. Rewritten by `poll`, read by every scorer, consumed by none. |
| `jev-fitness.jsonl` | The scores: Jev's probabilities that you are qualified (`fitness`) and that the role is aligned with your resume (`alignment`), per posting, resume version and version of the questions. Rows from before 2026-10-12 carry `fitness` only. Written by `npm run score`; read by the board, `poll` and `levels`. Newest per posting wins. |
| `queue.jsonl` | What you picked. The only input to `apply`. |
| `dismissed.jsonl` | What you said no to. |
| `pay-estimates.jsonl` | levels.fyi estimates from `npm run levels`, one line per posting looked up — misses included, so they are not asked again for 30 days. Newest per posting wins. Read by the board only. |
| `config/levels-companies.json` | Optional, yours. Board slug → levels.fyi company slug where they differ (`{"andurilindustries": "anduril"}`); `null` never looks that company up. |
| `log.jsonl` | One line per apply attempt: what filled, what failed, what was left red. |
| `dead.txt` · `raw.txt` · `candidates.txt` | Slug harvesting: rejected, pending, and the shipped seed list. |
| `usage.jsonl` | One line per model call: run id, label, model, effort, and the `usage` object. What `npm run cost` reads. |
| `greenhouse-slugs.txt` · `greenhouse-dead.txt` | The same two lists for Greenhouse. Kept separate so a token that collides with an Ashby slug cannot confuse either. |

---

## Tests

```powershell
npm test
```

Node's built-in runner over `test/`. No framework, no dependency. Covers the places
where being wrong is silent: salary parsing (hourly and monthly annualising, currency,
unstated pay), location matching, whitespace normalising, the description store, and
candidate selection end to end.

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
- Most boards publish no salary at all. Many state it in the description instead,
  which the pay column reads.
- **Ashby dedupes candidates by email**, so an application you didn't mean to send is
  not undoable. That is what picking your own queue is for.
