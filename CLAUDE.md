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
the separator — `npm run coverage -- --dry`.

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

ESM executes on import. `import('../bin/coverage.js')` runs the scorer and spends
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

- **Nothing auto-queues.** `score.js` ranks. `queue.jsonl` is written only when the
  user picks something in the UI. `apply.js` reads only `queue.jsonl`.
- **Nothing submits an application.** `apply.js` fills and stops.
- **Nothing agrees to anything.** Arbitration agreements, truthfulness
  certifications, consent and acknowledgement boxes are never ticked, whatever
  widget they use. These commit the user to something.
- **Self-identification is declined, never answered.** Gender, ethnicity/race,
  veteran and disability fields get the field's own "decline to answer" option and
  nothing else — see `declineIndex` in `lib/fill.browser.js`. If the field offers
  no way to decline, it is left empty. The safety property is that the matcher
  requires an explicit verb of declining, so it cannot select "I am not a protected
  Veteran" or "No, I do not have a disability" — both of which would be the tool
  asserting something about the user. Any change there needs `test/eeo.test.js`
  extended first.
- **Nothing invents the user's details.** The model skips rather than guesses; a gap
  is better than a fabricated answer on a job application.

## Money

`score.js` and `apply.js` cost Anthropic tokens per posting; `embed.js` costs OpenAI
tokens. Say what a run will cost before starting a large one, and prefer `--dry`,
`--keep`, and `--no-model` when testing.
