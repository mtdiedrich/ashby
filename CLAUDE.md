# ashby — working agreements

## Layout

`bin/` commands · `lib/` shared modules · `data/` generated state · `config/` the
user's resume and constraints · `web/` ui.html. Nothing lives in the root but docs
and package.json.

**Never name a data file by bare string.** `npm test` enforces this — see
`test/paths.test.js`. It was missed once for `context.md` because the audit regex
only looked for `.jsonl/.json/.txt`, and every scoring run then died on it. Every path goes through `lib/paths.js`, so
scripts work from any working directory and a file can be moved in one place. Add new
files to `P` there rather than hardcoding them.

Commands are npm scripts: `npm run poll`, `npm run fitness`, `npm run ui`. Flags need
the separator — `npm run fitness -- --dry`.

Job-search tooling over Ashby-hosted boards. Two pipelines; `README.md` explains both.

## Keep the README current — this is not optional

`README.md` is the only usage documentation. It drifted badly once already: it
documented 4 of 10 scripts and still described a queueing flow that had been removed.

**In the same turn that you change any of the following, update `README.md`:**

- adding, renaming, or deleting a script in `bin/`
- adding, renaming, or removing a CLI flag
- changing what a script reads or writes (the **Files** table)
- changing the daily workflow or the order of steps
- changing a setup requirement (an env var, a new key, a file the user must create)

Then run `npm run check-docs`. It fails if a script or flag is undocumented. Do not
report the work finished while it fails.

Specifically keep in sync:
- the **Every command** table — one row per script, with its flags
- the **Files** table — one row per file the pipelines read or write
- the **Daily use** section — the actual current workflow, not a historical one

## Tests come first

This project uses TDD. `npm test` runs Node's built-in test runner over `test/` —
no framework, no dependency.

**Write the failing test before the implementation.** When changing behaviour, the
test that would have caught the old behaviour goes in first. When fixing a bug, the
test reproducing it goes in first.

Tests must not touch real data. `test/helpers.js` gives each test a temp `ASHBY_HOME`;
`lib/paths.js` resolves every path lazily so that redirection works. **Never capture a
path at module load** (`const FILE = P.context`) — resolve it per call (`P.context`
inside the function). A captured path cannot be redirected and the suite cannot see it.

Run `npm test` before reporting work finished.

## Never import a script to inspect it

ESM executes on import. `import('../bin/fitness.js')` runs the scorer and spends
money. To check a script loads, run it with a harmless flag (`--dry`, `--show`,
`--stats`) or `node --check`. This has already cost an unasked-for $0.58.

## Shell

Windows PowerShell 5.1. **No `&&`** — chain with `;`, or `; if ($?) { ... }` for
run-on-success. Code fences the user might run should be tagged `powershell`, one
command per fence.

## Editing files

Prefer the Edit/Write tools over shell heredocs and `python - <<EOF` for source
files. Both have corrupted files in this project: heredocs collapsed `\n` escapes
into real newlines, and Python turned `\b` into literal backspace characters inside a
regex. If you do use a script to edit code, **verify the result** — `node --check`
plus an actual behavioural test, not just a successful exit.

## Verify against reality, not assumption

This project exists because the original spec's field names were wrong. Several bugs
since came from trusting a plausible explanation instead of checking:

- `isRemote` is `true` on Hybrid postings; `workplaceType` is the real field
- a stale `OPENAI_API_KEY` in the Windows User environment silently beat `.env`,
  because `dotenv` does not override existing variables
- a 401 got blamed on the provider, then on a `printf`, before the environment was
  checked third

When something fails, find the cause before proposing a fix, and say plainly when an
earlier explanation was wrong.

## Boundaries that do not move

- **Nothing auto-queues.** Scoring ranks. `queue.jsonl` is written only when the
  user picks something in the UI. `apply.js` reads only `queue.jsonl`.
- **Nothing submits an application.** `apply.js` fills and stops.
- **Nothing agrees to anything.** Arbitration agreements, truthfulness
  certifications, consent and acknowledgement boxes are never ticked, whatever
  widget they use. These commit the user to something. The one checkbox that is
  ticked is a group of exactly two boxes, "Yes" and "No" — a yes/no *question* some
  Ashby boards render that way (`yesNoBoxes` in `lib/fill.browser.js`). It stops
  being one if its label reads as consent (`CONSENT`) or self-identification, and
  exactly one box is ever left ticked. `test/ashby-form.test.js` guards both.
- **Self-identification is declined, never answered.** Gender, ethnicity/race,
  veteran, disability, sexual orientation and transgender-status fields get the field's own "decline to answer" option and
  nothing else — see `declineIndex` in `lib/fill.browser.js`. If the field offers
  no way to decline, it is left empty. The safety property is that the matcher
  requires an explicit verb of declining, so it cannot select "I am not a protected
  Veteran" or "No, I do not have a disability" — both of which would be the tool
  asserting something about the user. Any change there needs `test/eeo.test.js`
  extended first.
- **Nothing records a submission the user did not confirm.** `apply.js` cannot
  observe a submit — it never submits — so `log.jsonl`'s `submitted` field is the
  user's answer to a prompt, nothing else. Treating "a tab was opened" as an
  application made the board claim applications that were never made. Records are
  written per posting, as answered, so an interrupted run keeps what it did.
- **Nothing invents the user's details.** The model skips rather than guesses; a gap
  is better than a fabricated answer on a job application.
- **An ask is not a floor.** `me.json`'s `salaryExpectation`/`hourlyRate` are what
  gets typed into a form. The screening floor is `Minimum base` in `context.md`.
  Selection code must never read the ask — `test/pay-ask.test.js` enforces this by
  scanning `lib/select.js`, `lib/comp.js`, `lib/filters.js` and `bin/poll.js`.

## Write work as it lands, never at the end

Every script here that banked results in memory and wrote once has lost work:
embed.js discarded 43 already-purchased vectors on a late failure, apply.js threw
away a whole run's queue removals on Ctrl-C, and fitness.js lost every score in the
run if it stopped early — a 1,400-posting run is half an hour and about $32.

Use `appendRows()` from `lib/jsonl.js` inside the worker. These files are append-only
and every reader keys by id or a timestamp, so **the order of lines in them is not
load-bearing** — writing in completion order costs nothing. "So the file order is
deterministic" is what justified banking fitness.js's scores, and it was not worth
the run.

## Failures that are the same for every item

A bad API key is the same answer for all of them. One run made 1,396 requests,
printed 1,396 identical 401s, filled its progress bar to 100%, reported "1396 in 25s"
and then "0 scored" — the only honest line was the zero.

- Keys are preflighted **once**, before any work: `preflight()` in `lib/ai.js`,
  `requireKey()` in `lib/keys.js`. A placeholder is caught before a single request.
- `pool()` takes `stopOn`; the scorers pass `isAuthError` so the run aborts on the
  first 401 instead of repeating it.
- Anything thrown by a preflight carries `status = 401` so `isAuthError` sees it.
  Without that the pool treated it as an ordinary per-item failure and printed it
  once per posting.

`isAuthError` is deliberately narrow on strings: "401" appears in job titles, and a
"401k Administrator" posting must not look like an authentication failure.

## Money

`apply.js` costs Anthropic tokens per posting. `fitness.js` calls Jev (TypeSafe AI,
`JEV_API_KEY`) — about $0.00012 a posting, and not counted by `npm run cost`, which reads
only Anthropic usage. Say what a run will cost before starting a large one, and prefer `--dry`,
`--keep`, and `--no-model` when testing.

## The worklist is the only way in

`fresh.jsonl` is what every scorer reads. `poll` rewrites it with whatever is not
yet `finished`, so **a posting counted as finished while a score is still missing can
never acquire that score** — it is gone from the only list anything consults.

`finished()` in `lib/select.js` therefore requires every front. There is one now:
Jev's fitness (`bin/fitness.js`, `lib/jev-fitness.js`, `jev-fitness.jsonl`). When
there were three it once checked only two, which stranded 15 postings with no vector,
and so no `score` and no `value` — visible on the board and permanently unrankable.

Everything else was dropped on 2026-10-02: embedding similarity, a Sonnet fitness
judgement, a combined `score`, and requirement coverage with its Haiku extraction,
`npm run gaps` and the Batch API. Coverage went after 100 hand-judged postings where
fitness was closer in 90 (see `lib/jev-fitness.js`). Their data files were deleted. `value` is the geometric mean of min-maxed fitness and freshness.

**Fitness caches by content but `finished()` looks up by id.** A re-listed posting —
new id, identical description — has an answer and no finished id. `worklistWork`
copies the answer to the new id (`reuse`), and `bin/fitness.js` writes those copies
before its "nothing to do" exit. Coverage once had the same bug; dropping it must not
bring it back.

If you add a scorer, it goes in `finished()` in the same commit, and `poll` reports
its count alongside the others, counted over the same population.

## Two ATSes, one corpus

Everything board-specific lives in `lib/ats.js` — endpoint, response shape,
normalisation. Nothing else should branch on which ATS a posting came from, with two
exceptions that are deliberate: `apply.js` routes on the ATS because
`fill.browser.js` carries a DOM adapter per board, and the board shows which is which.

`apply.js` fills Ashby and Greenhouse. Which one is decided by `atsOf()` in
`lib/ats.js`, never by reading `row.ats` directly — derived rows drop the field, and
that is exactly how a Greenhouse posting once hung 30s on an Ashby selector.
Greenhouse's react-select ignores synthesized pointer events, so its
self-identification fields are declined from the Playwright side by
`declineDemographics()` in `lib/decline.js`, which re-exports the page's own matcher so
one DECLINE list serves both call sites. Never add a second copy of that wording.
`test/greenhouse-form.test.js` runs the real filler in a browser against a form with
the Greenhouse shapes that broke it: intl-tel-input around the phone (a hidden search
combobox plus ~244 permanently-present hidden `[role=option]`s), react-select that opens
only on its toggle, multi-selects, and a click swallowed before hydration.

A record with no `ats` field is Ashby. Every one of the 62,000 rows written before
this predates the field, and Ashby ids stay unprefixed for the same reason —
prefixing would orphan them along with every fitness, coverage and vector record
keyed to them. Greenhouse ids carry a `greenhouse:` prefix because theirs are small
integers.

**Never read a data file with `readFileSync(f, 'utf8')`.** Node caps a string at
0x1fffffe8 (~512 MB) and corpus.jsonl passed it, taking down poll, crawl and the
board at once with ERR_STRING_TOO_LONG. Use `linesOf()` in `lib/corpus.js`, which
streams with a StringDecoder so a multi-byte character across a chunk boundary is
not silently turned into replacement characters.

**The corpus is append-only, so it has to be compacted.** A change that alters how
records are written rewrites every posting it touches and leaves the old rows behind;
that is what crossed the limit above. `compactCorpus()` keeps the newest row per id,
via a temp file and a rename so a failure leaves the original intact. crawl runs it
automatically past 1.25x dead rows.

**The corpus does not store every description.** It holds metadata for everything and
descriptions only for titles `wantedTitle` passes; anything else is marked
`descriptionStored: false` and fetched on demand when staged. An empty description is
never the same as a missing one, and scoring a blank produces a confident number about
nothing. Measured: 96.5% of a 380 MB corpus was descriptions that would never be read.

## The board

`web/ui.html` renders every row on each keystroke, so what rides on a row matters.

- **A board row carries only what a column draws.** `summaryOf`/`detailOf` in
  `lib/board-row.js` split it; the expanded pane fetches `/api/detail` per posting.
  Shipping descriptions and requirement evidence with every row made one response
  5.8 MB and made typing in the filter box unusable.
- **The filter input is debounced.** `render()` rebuilds the whole table.
- **Every row is sent and sorted; only `PAINT_STEP` (300) are painted.** 2,871 rows is
  48,000 DOM nodes and ~290ms of layout per render, which stalls the browser. The cap
  is applied in `render()` **after** sorting and filtering, so it only hides the tail
  of the list you are already looking at — unlike the old server-side slice, which cut
  on a different ordering than the page displayed. "Show more" re-renders; it does not
  refetch.
- **The server orders by the same key the page does** — `byValue` in
  `lib/board-row.js`. It used to order by fitness and slice the top 600 while the
  page sorted what it got by `value`; every posting under two days old fell below
  the fitness cutoff (0.32) and was never sent, so the board's freshest row read two
  days old while seven newer ones sat on disk. **A slice taken on one ordering
  cannot serve a view ordered by another** — if the page gains a new sort column,
  either send the whole filtered set or slice on that column.
- **`corpus()` is cached on mtime in ui.js (`corpusCached`).** 246,000 postings is
  ~1.5s a parse and it was being paid on every request, including every row expand.
  Anything added to a request path must go through the cache, not `corpus()`.

## Concurrency

Scoring passes run through `pool()` in `lib/pool.js`, not a bare `for await` loop.
Two things there are load-bearing and easy to undo by accident:

- **Results come back in input order.** Callers index work by position; the old
  fitness scorer matched replies on `<posting index="N">`. Collecting in completion
  order attaches results to the wrong postings, silently.
- **`warmup: true` runs the first call alone.** When the system prompt is long enough
  to cache (fitness's carried `context.md` and the resume PDF under `cache_control`), the first call writes that cache and the
  rest read it at ~0.1x. Opening at full width makes the whole first wave miss and
  each one pay the write premium.

Default is 6, overridable with `--jobs N` or `ASHBY_JOBS`. `--jobs 1` is sequential
and is the thing to reach for when debugging a prompt.
