# Authoring and verifying program data

> **The seed dataset is nearly fully verified.** 14 of 15 program records now carry a real
> `lastVerified` date (issue #2), and all three income tables in
> `src/data/reference/income-tables.ts` are verified as of 2026-08-21 (issue #3) --
> including `WI_SMI_60`, whose `source` citation the issue #6 refresher moved to a more
> stable page (described further down); a human independently re-confirmed the figures
> against that new citation before `verified` was set back to `true`, per "Reviewing a
> proposed update" below. The one holdout is `dane-eviction-prevention`: its income
> threshold could not be traced to a current, citizen-facing source (see the comment on
> that record), so it deliberately kept `lastVerified: null` and an unresolved-income
> `manualReview` rather than a guessed number. The UI's "unverified data" banner stays up
> until that record is resolved too, since it checks every record and every table together.
> See "What `lastVerified` means" below for what a date on a program record actually
> asserts.

## Why this is treated as a blocker

Wrong eligibility data does specific harm. Telling someone they do not qualify for food
assistance when they do can mean they never apply. Telling them they *do* qualify when they
do not costs them a wasted trip they may not be able to afford. Neither failure is visible
from inside the app, which is why the verification state is tracked in the data and
surfaced in the UI rather than left to memory.

The app shows a warning banner for as long as any record or income table is unverified. It
disappears on its own once they all carry a date.

## Verifying a program record

For each file in `src/data/programs/`:

1. Open the record's `source.url`. If the page is gone, find the current official page and
   update the URL — do not verify against a cached or third-party copy.
2. Check each field against the source:
   - `name`, `administeredBy` — as the agency writes them.
   - `summary`, `benefit` — accurate and in plain language. Aim for a reading level a
     stressed person on a phone can absorb.
   - `eligibility` — every threshold, and the *shape* of the rule. Is that income limit
     really 185% FPL? Is it gross or net? Is it an `allOf` or an `anyOf`?
   - `status` and `seasonalNote` — is the program open right now?
   - `howToApply.url` and `.phone` — follow the link, dial the number.
3. Move anything the rules engine cannot honestly model into `eligibilityCaveats`, or
   encode it as `manualReview` if it should keep the program in "might qualify".
4. Set `lastVerified` to today's date, `YYYY-MM-DD`.
5. Run `npm test`.

Verifying a record means a human loaded the source and read it. It does not mean the record
looked plausible.

### What `lastVerified` means

A date in `source.lastVerified` is a specific, bounded claim, not a blanket "this record is
correct" stamp:

- **It asserts**: a human loaded `source.url` (or a documented substitute — see "moved vs.
  never correct" below) on that date, and confirmed the `eligibility` rule's shape and
  thresholds, `status`, and the fields listed in step 2 above against what the source
  actually said.
- **It does not assert**: that every sentence in `summary`, every line in
  `eligibilityCaveats`, or every step in `howToApply.steps` was independently re-confirmed
  on that visit. Some of those carry over from an earlier pass, from a different source
  entirely, or from general knowledge that was reasonable to trust and not worth re-deriving
  from scratch every time.
- **The rule that makes the difference honest**: anything in the record that was *not*
  freshly confirmed against the cited source must be named as such, in a comment, at the
  time `lastVerified` is set. Silence reads as "checked." `wheap-crisis-assistance.ts`'s
  `source` comment is the model to copy — it says plainly what was confirmed directly (the
  page, the phone number, the disconnection-moratorium dates) and what was carried over
  unconfirmed (the "24 hours a day" claim, the homeowner-only furnace restriction, the
  apply-for-both claim), rather than letting the date imply all of it was checked.

If you cannot confirm the load-bearing part of a record — the rule that decides who
matches, not a caveat or a phone number — do not set `lastVerified` at all. Encode the
uncertainty (`manualReview`, a caveat, a narrower `eligibility`) and leave the date `null`,
same as `dane-eviction-prevention.ts`. A record with an honest `null` is worth more than one
with a date covering a threshold nobody actually re-derived.

### "Moved" vs. "never correct"

When `source.url` is dead, it matters which of two things happened, and the comment should
say which: the page **moved** (the org restructured its site; a Wayback Machine snapshot of
the old URL shows real content), or the URL was **never correct** (drafted from memory
during prototyping and simply wrong — no snapshot exists at any date, or the snapshot that
exists is itself an error page). Several `EnergyAssistance.aspx`/`Weatherization.aspx`-style
URLs in this dataset turned out to be the latter: checking
`http://archive.org/wayback/available?url=<old-url>` and getting back an empty
`archived_snapshots` settled it in seconds. This distinction is not just trivia for the
verifying human — issue #14's ingestion pipeline needs to treat "moved" and "never correct"
as different failure modes with different fixes, and the record's own comment is the
cheapest place to leave that signal for whoever builds it.

## Verifying the income tables

`src/data/reference/income-tables.ts` holds three tables, each with a `source` URL. The
exported constants (`FPL`, `WI_SMI_60`, `DANE_AMI`) deliberately carry no year suffix — the
year lives in `effectiveYear` and `lastVerified`, so a re-verification only ever changes
values inside the object, never an import elsewhere in the codebase.

- **`FPL`** — HHS poverty guidelines, 48 contiguous states and DC. Confirm the figures
  and the `perAdditionalPerson` increment. Used by SNAP, WIC, and school meals. Updates each
  January.
- **`WI_SMI_60`** — these are already the **60%** of state median income figures WHEAP
  uses, not full SMI. Rules ask for `incomeAtOrBelow('wi-smi', 100)` accordingly. If you
  replace these with full-SMI numbers you must also change every rule that references the
  scale. Published in Appendix E of the annual WHEAP Manual PDF — a large document that needs
  `pdftotext` or similar, not a quick page fetch.
- **`DANE_AMI`** — HUD income limits for the Madison, WI HMFA. Modelled as HUD computes
  them: a four-person median plus size-adjustment factors. Verify the four-person median
  and confirm the adjustment factors still match HUD's method. As of 2026, `huduser.gov`
  blocks automated fetches with a WAF challenge; state/regional housing agencies (WHEDA,
  FHLBank Chicago) republish the same HUD dataset and are a workable substitute, provided at
  least two independent republications agree.

Set `verified: true` and `lastVerified` to today's date once checked against the source.

These are republished annually. Updating them is a yearly maintenance task, and every
program's effective threshold moves when they do.

## Automated refresh (scripts/refresh-income-tables)

Issue #6 built a deterministic script -- no LLM anywhere in it -- that fetches all three
income tables from their live sources, validates them, and patches
`src/data/reference/income-tables.ts` in place for whatever changed. It never decides a
table is verified; it never runs against `main`; and its git diff, not a summary, is the
thing a human reviews.

```
npm run refresh:income-tables                        # fetch (recorded effectiveYear + 1) for every table
npm run refresh:income-tables -- --year=2026          # fetch a specific year instead (e.g. to re-verify)
npm run refresh:income-tables -- --dry-run            # validate and report, write nothing
npm run refresh:income-tables -- --report-file=out.md # also save the report to a file
```

Requirements to run it: **`pdftotext`** (Poppler) on `PATH` -- only the Dane AMI source
needs it, FPL and WI SMI are plain JSON/HTML. The npm script already runs `node
--use-system-ca`; without that flag, `liheapch.acf.gov` (the WI SMI source) fails Node's
built-in fetch with `UNABLE_TO_VERIFY_LEAF_SIGNATURE` even though `curl` and every browser
accept its certificate chain fine -- Node's bundled root store is pickier than the OS
store here. If you invoke the script directly rather than through the npm script, keep the
flag.

### What each table's refresher actually does

- **`FPL`** -- fetches ASPE's own JSON API (`.../poverty-guidelines/api/{year}/us/{size}`)
  for household sizes 1-8, derives `perAdditionalPerson` from the (checked-constant) delta
  between sizes, and cross-checks the size-4 figure against the human-facing guidelines
  page as a secondary, non-blocking check.

  **The API does not 404 for a year it does not have yet.** Asking for a future year
  returns HTTP 200 with the most recent year it actually has, silently, e.g.
  `.../2027/us/4` today returns `{"data":{"year":"2026",...}}`. Found this by actually
  running the script against next year's figures while building it -- without checking the
  echoed `data.year` against the year requested, the script would have written
  `effectiveYear: 2027` next to 2026's real dollar amounts. The script checks the echo on
  every request and treats a mismatch as "not yet published," not as success. If you touch
  `sources/fpl.ts`, keep that check.

- **`WI_SMI_60`** -- fetches the LIHEAP Clearinghouse's Wisconsin state median income page
  (`https://liheapch.acf.gov/profiles/povertytables/FY{year}/wismi.htm`), an HHS/ACF
  republication that prints the six household-size-1-6 dollar figures directly as plain
  HTML -- not the 2.5 MB WHEAP manual PDF the original hand verification (#3) had to use.
  Sizes 7-8 (and `perAdditionalPerson`) are not published anywhere as raw numbers; 45 CFR
  96.85(b) specifies them as a formula, so they are derived from the fetched size-4 figure,
  and the regulation's fixed percentages are used as a self-check against all six fetched
  values (six independent checks against one source, not one).

  **The rounding is truncation, not standard rounding**, confirmed by running the fetcher
  for real: `Math.floor(base * pct / 100)` reproduces all eight published figures (the six
  fetched plus the manual's own size-7/8 rows) exactly; `Math.round` is off by a dollar on
  several sizes. See the comment in `sources/wi-smi.ts` for the worked example.

  **A change-detection signal worth passing to issue #7:** the Clearinghouse page carries a
  publisher-authored `[Last edited MM/DD/YYYY]` stamp (e.g. `[Last edited 12/05/2025]` for
  the FY2026 page) directly in the page body. This refresher doesn't use it -- it just
  fetches and re-derives every run -- but it's a genuinely different thing from the generic
  `Last-Modified` HTTP header noise the issue #5 spike found unusable elsewhere: it's a
  human-maintained editorial date on a federal page, not a CDN/server artifact, so a diff on
  that one string is a real "did the underlying data actually change" signal. Worth #7
  checking for the same pattern on other government sources before assuming header-based
  change detection is the only option.

- **`DANE_AMI`** -- fetches exactly one fact from each of two independent PDFs (WHEDA's
  Section 8 Income Limits, FHLBank Chicago's HUD Income Guidelines): the county's stated
  median family income, and requires the two to agree exactly. `sizeAdjustment` and
  `perAdditionalPersonFactor` are HUD's fixed methodology, already modelled as constants,
  and this refresher never touches them.

  **`pdftotext -layout` mangles both PDFs' multi-column income-limit grids** -- columns
  from adjacent counties bleed into each other, producing numbers that look plausible and
  are wrong. Confirmed by hand while building this script (see the comment in
  `sources/dane-ami.ts`). The next person tempted to parse the full grid for a richer
  cross-check should read that comment first and expect to lose an afternoon to it. The
  isolated `"FY{year} MFI: $X"` / `"MFI: X"` line does not have this problem, which is why
  the script only ever reads that one line from each document.

### The guardrail: calibrated to 25%, and why

A year-over-year move over the guardrail on any figure holds that table's update back
entirely -- nothing is written, and the report says so, naming the table, the specific
figure, the old and new values, the percentage change, and the source URL. The threshold
started at 10% and was raised to 25% once real data from building this script showed 10%
was miscalibrated: it sits *below* normal annual movement rather than above it. Observed,
legitimate, real moves: FPL ~3-4%/year, Dane AMI's actual 2026 correction (#3) 9.1%, WI
SMI's 2026 correction 15-20%. A band that fires on every correct run is not a signal, it's
noise -- it trains people to click through it, which also makes them click through the one
run that matters. The guardrail's actual job is catching a *parse* error (a misread column,
a footnote captured as a value, a row offset), which produces a grossly wrong number, not a
12-20% one -- 25% still catches that comfortably. It also is not the only safety net: every
run that changes anything still produces a diff a human reads before it merges. See the
comment on `GUARDRAIL_PERCENT` in `lib/guardrail.ts` for the full reasoning; if you're
considering tightening this again, get real observed movement across a few more years
first, not just the one year that calibrated it originally.

### Reviewing a proposed update

This script can never write `verified: true`. When it changes a table's data, it writes
`verified: false` and `lastVerified: null`, and inserts a new comment paragraph -- clearly
marked `PROPOSED UPDATE (unverified)` -- directly above the export, without touching the
table's existing hand-written prose. That means:

1. **A refresher PR is not done when it merges.** Merging it with `verified: false` still
   in place ships the "unverified data" banner to production for that table -- the engine
   checks `verified`, not "a script touched this recently." Reviewing a proposed update
   means doing the same thing as "Verifying the income tables" above: open the source
   URL(s) in the comment, check the figures, and only then set `verified: true` and
   `lastVerified` to today's date as a **separate, deliberate edit** on top of what the
   script wrote.
2. **This script must only ever run on a branch that becomes a PR, never against `main`
   directly.** It refuses to write if the current branch is `main` or `master` (checked via
   `git rev-parse --abbrev-ref HEAD`) -- a proposed change always needs a human in the loop
   before it reaches production, and running it locally against a checked-out `main` is the
   one path that would skip that.

### Failure modes, and what each one asks a human to do

The script distinguishes four outcomes deliberately, because they call for different
responses -- collapsing them into one generic "failed" would train people to stop reading
the message:

- **not-yet-published** -- quiet, not an error. The next year's figures legitimately do not
  exist yet at the expected URL.
- **fetch-failed** -- could not reach or read a source at all. Fix: find the new URL, or
  wait out an outage. Every message names which leg failed (e.g. `[Dane AMI / FHLBank
  Chicago leg]`) -- Dane AMI's FHLBank Chicago URL carries an unpredictable per-year hash
  suffix and has to be scraped fresh from a listing page every run, which makes it the
  single most likely thing in this script to break first.
- **parse-failed** -- reached the source, but its shape did not match what the script
  expects. Fix: update the parser for the new layout.
- **disagreement** -- reached and parsed everything, but two independent sources (or a
  source vs. a regulation-derived expectation) do not agree. Fix: a human has to work out
  which source is right. Never averaged, never guessed.

Exit codes, for issue #15's benefit: **0** clean run (including "not yet published" and
successfully-applied changes); **1** a hard failure (fetch/parse/disagreement) or a write
refused for branch safety; **2** a change was found but held back by the guardrail. `#15`
still needs to: run this on a schedule, capture the report (`--report-file`) as the PR body,
`git diff --quiet` to decide whether to open a PR at all ("no change: exit quietly" is
already the script's behavior), and treat exit code 1 as a failed CI run rather than "no
change" -- silently swallowing a `parse-failed` as "nothing to do" is exactly the dangerous
outcome the issue calls out.

## Source change detection (scripts/check-sources)

Issue #7 built the other half of "keeping data fresh": a scheduled job that notices when a
program's `source.url` page *changes*, not just when its `lastVerified` date gets old. It
automates the noticing, never the judgement — a detected change opens a PR and a human does
the re-verification.

```
npm run check:sources                       # fetch all, update source-hashes.json, print the report
npm run check:sources -- --dry-run           # fetch and report, write nothing
npm run check:sources -- --id=wic-wisconsin  # just one record (repeatable)
npm run check:sources -- --stale-days=90      # widen/narrow the stalePrograms() window in the report
npm run check:sources -- --report-file=out.md
```

No extra tools to install (it reuses `scripts/refresh-income-tables/lib/http.ts`, so it
sends a desktop-Chrome UA — WI state and some nonprofit sites 403 anything else). It reads
the live `PROGRAMS` array via a small `node:module` resolve hook
(`scripts/check-sources/resolve-hook.mjs`), so the ids and URLs it checks are always the
real ones.

### What it does, and the one hard part

For each record it fetches `source.url`, reduces the page to its **meaningful text**, hashes
that, and compares to the committed baseline in
`scripts/check-sources/source-hashes.json` (one entry per program id, sorted, pretty-printed
— a real change is a one- or two-line diff a reviewer can read).

The reduction step is the whole ballgame. `docs/eligibility-extraction.md` Section 5
measured that byte-level change on these sources is dominated by incidental churn — render
timestamps, CSRF tokens, rotating announcement banners, session ids in links, analytics
blobs — on pages whose actual figures move once a year. Three automatic change signals were
tried there and all three rejected. So `lib/normalize.ts` strips the page hard: drop
`<script>/<style>/<form>/<head>`, narrow to the page's main-content landmark — `<main>`,
then `[role="main"]`, then a `#content` / `#main` container, then the weak `<body>`
fallback (government CMS templates put everything volatile *outside* the landmark) — drop
remaining nav/header/footer, strip all tags and attributes, decode entities, fold
typographic Unicode to ASCII, and scrub date/timestamp/copyright/"N views"/opaque-token
text patterns. It errs aggressive: a missed edit is caught on the next run or by the
time-based check; a false "changed" trains the reviewer to ignore the job. Run-to-run
stability is proven, not asserted, in `lib/__tests__/normalize.test.ts` (and was verified
against all 17 live pages: two consecutive real fetches, zero baseline churn).

The one place `<form>`-stripping backfires: ASP.NET WebForms / SharePoint wraps the whole
`<body>` in a single `<form id="aspnetForm">`, so stripping `<form>` wholesale deletes the
entire page (issue #82 — this silently disabled change detection for the three
`energyandhousing.wi.gov` records; an empty normalization hashes consistently, so they
compared nothing to nothing every run and always reported `unchanged`). So `check.ts`
wraps `normalize()` in `normalizeWithUnwrap()`: when the plain reduction comes back
near-empty (`< 200` chars), it retries once with that wrapper `<form>` neutralised to a
`<div>` — `unwrapContentShell` from `scripts/render-fallback/lib/unwrap-shell.ts`, the
exact transform the ingestion path (`recoverEmptyPage`) runs, reused rather than
reimplemented. The CSRF/nonce/session inputs it was hiding are still dropped by
`normalize()`'s blanket tag strip and opaque-token scrub. A real `<main>` page never
enters the retry (it reduces well above 200), so the #7 stability property is untouched —
re-verified across all 17 live pages, two consecutive runs, byte-identical baseline. As a
backstop, a record whose normalized text is shorter than `MIN_PLAUSIBLE_CHARS` (50; the
smallest real page is ~350) is reported as **unreadable**, never `unchanged` — an empty
normalization is a reducer bug, never a valid baseline.

When a record falls all the way through to the `<body>` fallback, the report names it under
**Weak content-region fallback** — nav/header/footer are in its hash, so a site-wide
template change can flag it (and every sibling on that domain) at once without the
eligibility rule moving. If one of those shows up as `changed`, check the diff for chrome
before treating it as a real edit; a hand-picked selector for that page is the fix if it
churns (issue #49).

### The outcomes, and why they are kept distinct

| Outcome | Means | What a human does |
|---|---|---|
| **unchanged** | normalized text hashes to the stored value | nothing — silent, no PR |
| **new** | no baseline yet (first run, or the URL changed) | nothing — baseline recorded |
| **changed** | reachable, 200, normalized text moved | re-verify the record against the source (below) |
| **unreadable** | reachable, 200, but normalized text is empty or `< MIN_PLAUSIBLE_CHARS` | a reducer bug, not an edit — fix `normalize.ts` until it sees the page; **do not** re-baseline against the empty hash (issue #82). Escalates on the first run |
| **gone** | 404 / 410 — the page was removed, not edited | find the current official page; fix `source.url` in the record **and** in `source-hashes.json`; note "moved" vs "never correct" per the section above; then re-verify. **Escalates on the first run** — a retry counter must never hide a vanished program |
| **unreachable** | timeout, 403, 5xx, network error | almost always a blip at 17 monthly sources. The last good hash is kept and a `consecutiveFailures` counter is recorded (force-pushed to the `automation/source-change-detection` branch as bookkeeping, never to `main`, no PR). Only the **2nd consecutive** failed run escalates to a re-verification PR; a successful fetch resets the counter. Once escalated, treat a genuinely-removed page as "gone" |

A 404 is deliberately not an "edit" — see "Moved vs. never correct" above, and issue #14.
`unreachable` stays distinct from `gone` for the same reason: the retry counter delays a
flaky-fetch PR, but a real 404 is actionable immediately (issue #49).

The report also prints `stalePrograms(days)` (from `src/data/programs/index.ts`) on the same
run — the time-based half of the same question, now wired up.

### The re-verification loop

The scheduled workflow (`.github/workflows/check-sources.yml`, monthly) runs the script on a
detached HEAD, first seeding `source-hashes.json` (and its `consecutiveFailures` counters)
from the `automation/source-change-detection` branch when that branch exists. If
`source-hashes.json` changed *and* there is an actionable finding (`changed` / `gone` / an
escalated `unreachable`), it force-pushes `automation/source-change-detection` and opens (or
updates) one PR with the report as its body. If the only change is a first-time
`unreachable`'s `consecutiveFailures` counter, it force-pushes that one field to the same
branch (bookkeeping — no page moved, nothing to review) and opens nothing. It never commits
to `main`: `main` is Cloudflare Pages' production branch and every push to it deploys the
live site (`docs/deploy.md`), so a counter bump driven by a flaky government server must not
land there. That PR is the tracked item. To close it:

1. For each **changed** record, do the full "Verifying a program record" procedure above
   against the (new) source text. The hash moving is not proof the *eligibility rule*
   changed — it might be reworded prose or a new caveat — so read it like any re-verification.
2. Land any correction, and set a fresh `lastVerified` (or leave it `null` with a
   `manualReview`, per the rules above), as edits **on top of** the baseline bump the bot
   committed.
3. For **gone** records, fix the URL first (in the record and in `source-hashes.json`), then
   re-verify.
4. Merge. The baseline advances with the reviewed state.

Exit codes: **0** clean, or the only change is a first-time `unreachable`'s failure counter
(bookkeeping — force-pushed to `automation/source-change-detection`, never `main`, no PR);
**1** a write was refused because the script was run on `main`/`master` (it never advances
the committed baseline without a PR, same rule as
`refresh-income-tables`); **2** at least one record is changed, gone, `unreadable`, or
`unreachable` for two consecutive runs.

## Descriptive-field ingestion (scripts/ingest-descriptive)

Issue #14, item 3 of `docs/data-sources.md`'s "Recommended ingestion order". Where
`check-sources` says only "this page's text moved, go look", this goes one step further for
the **descriptive half** of a record: it names the field, the proposed new value, and the
verbatim source excerpt it came from, so a reviewer's job is verification, not research.

```
npm run ingest:descriptive                       # fetch all, update proposals.json, print the report
npm run ingest:descriptive -- --dry-run           # fetch and report, write nothing
npm run ingest:descriptive -- --id=sun-bucks-wi   # just one record (repeatable)
npm run ingest:descriptive -- --report-file=out.md
```

Scope, deliberately narrow:

- **`source.url` health** -- `ok` / `redirected` (same host, new path) / **`moved`** (a
  different host -- the FNS->FNA case from `docs/data-sources.md`, distinct from both
  `changed` and `gone`) / `gone` (404/410) / `unreachable` / `blocked`. A `moved` or
  `redirected` result becomes a concrete `source.url` proposal; `gone` only flags (finding
  the right replacement page is a human call).
- **`howToApply.phone`** -- if the record has no phone and the page has exactly one, that is
  a low-confidence proposal with its excerpt. If the record has a phone that is no longer on
  the page, or the page has several candidates, that is a review flag, never a guess.
- **`status`** -- high-precision phrases ("not currently accepting applications", "placed on
  a waitlist") that disagree with the recorded status become a review flag.

What it does **not** do: it never reads, extracts, proposes, or writes an `eligibility`
rule. The LLM extractor in `scripts/llm-extraction/` is built but deliberately not wired in
-- its held-out eval produced a schema-valid dangerous over-claim (issue #51). See
`scripts/ingest-descriptive/eligibility-seam.ts`.

The output is `scripts/ingest-descriptive/proposals.json` -- a committed, diffable review
queue with the same fixed-point property as `source-hashes.json` (an unchanged run
reproduces it byte-for-byte, so the monthly workflow opens nothing). It is not a direct
edit to `src/data/programs/*.ts` or `snapshot.json`: the record modules are hand-authored
with load-bearing source comments, `snapshot.json` is generated, and the repo's curation
model is "git is the database, PR review is the write gate" (see `design.md`). Resolving a
proposal means landing the accepted change in the record file and running
`npm run build:snapshot`, exactly as for any hand edit; the entry then drops out of the
queue on the next run.

**When a review flag is a false positive** — the record is already correct — add an
`acknowledgement` block to that entry in `proposals.json` by hand:

```json
"acknowledgement": {
  "reviewedOn": "2026-09-05",
  "reason": "Why the record is right and the flag is noise. Written for the next reviewer.",
  "sourceHash": "sha256:…"
}
```

The `sourceHash` is the entry's normalized-page hash — copy it from that record's line in
`scripts/check-sources/source-hashes.json` (same `normalize`, same digest). The report then
lists the finding under **Reviewed — no change needed** instead of **Needs human review**,
and it stops counting toward the exit code. The acknowledgement is carried forward on every
run *only while that hash still matches the live page* — the moment the page text moves it
is dropped automatically and the finding is a fresh review again, so an acknowledgement can
never permanently silence a real future discrepancy (issue #49). `madison-housing-choice-voucher`'s
`status-signal` is the worked example: its `seasonalNote` already documents that the
Section 8 voucher waiting list has been closed since April 2023, and the page's generic
"we maintain a wait list per program" boilerplate is what the heuristic matched.

Sources that currently yield nothing: `211wisconsin.communityos.org` is on the hard-deny
list (`scripts/ingest-descriptive/lib/robots.ts`) alongside findhelp.org.

`energyandhousing.wi.gov` (SharePoint; the WHEAP and Weatherization pages) was thought to be
a JS-rendered SPA that "normalizes to zero readable text". It is not (issue #76). A plain
fetch returns the full server-rendered page, income table included; both text reducers just
threw it away because ASP.NET WebForms wraps the whole `<body>` in one `<form>` and they
strip `<form>` wholesale. `scripts/render-fallback/lib/unwrap-shell.ts` unwraps that shell
whenever a page reduces to nothing — used by descriptive ingestion, agentic extraction, and
(issue #82) `check-sources`' `normalize()` — so these three records are back in scope. See
`scripts/render-fallback/lib/unwrap-shell.ts` and `tests/fixtures/js-pages/SOURCES.md`.

## Adding a new program

1. Create `src/data/programs/<id>.ts` exporting a `Program`. Copy the nearest existing
   record — `foodshare-snap-wi.ts` for a standard income-tested benefit,
   `the-river-food-pantry.ts` for something with no income test.
2. Write `eligibility` with the builders from `@/domain/criteria` (`allOf`, `anyOf`,
   `incomeAtOrBelow`, `livesIn.madison`, …) rather than raw object literals.
3. Register it in `src/data/programs/records.ts` (the hand-authored source of truth), in the
   right locality group. Array order is preserved into the snapshot verbatim.
4. Run `npm run build:snapshot` and commit the regenerated
   `src/data/programs/snapshot.json` alongside your record. The app loads the snapshot, not
   `records.ts`, so a new program is invisible until it is regenerated — `npm run build`
   fails if the committed snapshot is stale, and so does `npm test`.
5. Run `npm test`.

### If a rule needs a fact that does not exist yet

Adding a fact is deliberately a three-step change, and `tests/data/vocabulary.test.ts` fails
until all three are done:

1. Declare the key in `FACT_KEYS` and add its `FactSpec` in `src/domain/facts.ts`. Booleans
   need a `negated` phrasing; enums need `optionLabels`. Both feed the generated
   explanations.
2. Reference it from some program's `eligibility`.
3. Add a question that supplies it in `src/interview/screens.ts` — or, better, extend an
   existing question. Check whether an existing answer already implies it before adding a
   new question; see "Asking as few questions as possible" in [design.md](design.md).

Every fact must be written by exactly **one** question. Two questions writing the same fact
will silently overwrite each other, and the vocabulary test rejects it.

### When a fact earns a question

**A fact is worth asking when it unlocks programs worth including.** The test is coverage,
not whether a rule already in the dataset happens to reference it.

The old rule was the opposite — "no current rule needs this, so asking is pure friction" —
and it is circular: a fact stays unasked because no rule needs it, and no rule can need a
fact the interview never supplies. Held that way the vocabulary can never grow, and the
dataset quietly caps itself at whatever facts it started with. `age` sat unasked under that
reasoning until issue #88: the Tier 3 corpus
([eligibility-extraction-tier3.md](eligibility-extraction-tier3.md)) showed a whole class of
programs — SeniorCare, the Medicare Savings Programs (QMB/SLMB/SLMB+/QDWI), Homestead
Credit, and more — that could not be added at all while age was unaskable, and
`badgercare-plus` was already carrying its 0–64 bound as caveat prose the engine never
evaluates.

Friction is still a real cost, weighed honestly against what the question buys:

- **A question is expensive.** It is a screen for someone who may be in a crisis. Prefer
  extending an existing question, and keep the new one on its own screen so `flow.ts` can
  drop it the moment nothing undecided needs it (see the `about-you` screen — most people
  never see it).
- **Ask for the least that the rules need.** Age is asked as a band, not a number: every
  age-gated rule needs a boundary (0–64, 60+, 62+, 65+), never a precise age, and a band
  reads as a life-stage question rather than an ID check.
- **The coverage argument can still lose.** `citizenshipStatus` stays reserved: immigration
  rules are full of exceptions (children often qualify when adults do not), and a rule that
  gets them slightly wrong tells a family they are ineligible when they are not — the worst
  error this app makes. The affected programs carry a caveat and stay in "might qualify".
  The new rule does not mean asking everything; it means the coverage question gets asked
  honestly, per fact.

### An unasked fact must never bucket a program `eligible` or `ruledOut` on its own (issue #79)

If a program's eligibility turns on a fact and that fact is unanswered, the program stays
in **"might qualify"** — `unknown` is a first-class value in the engine, and that is the
honest bucket. Two consequences for authoring:

- **Never leave a real eligibility condition in `eligibilityCaveats` prose alone.**
  `match.ts` evaluates the `Criterion` tree only; it never reads caveats. A condition that
  lives only in prose is invisible to the engine, so a program can bucket `eligible` for
  someone the caveat plainly excludes (this is exactly what `badgercare-plus` did to a
  66-year-old before #88). If the condition is decidable from an asked fact, encode it in
  the tree. If it is not, use `manualReview` so the verdict is capped at "might qualify".
- **Encoding a bound narrows the rule — do it carefully.** #5 §4.4's asymmetry stands:
  wrongly excluding someone is worse than wrongly including them. Gate only the branch that
  genuinely requires the condition. `badgercare-plus`'s age bound sits on the childless-adult
  income branch, not the top-level `allOf`, so a 66-year-old raising a grandchild still
  matches through the household branch. And because `noneOf('age', ['65-plus'])` returns
  `unknown` for a blank answer, a declined age leaves the record at "might qualify" — never
  ruled out.

The extractor pipeline follows the same rule: `RESERVED_FACT_KEYS` (facts.ts) is the single
source of truth for both the engine's vocabulary test and the extraction schema gate
(`scripts/llm-extraction/schema-gate.ts`). A fact moving out of that list makes it encodable
on both sides at once.

The snapshot's `factVocabulary` (see [design.md](design.md), "The shippable snapshot") is
recomputed from the rules on every `npm run build:snapshot`, so a new fact appears there
automatically once some rule references it — you do not edit it by hand. `npm run build`
and `tests/data/snapshot.test.ts` fail if a shipped rule references a fact the interview
cannot ask.

## Things the engine should not model

Encode as `eligibilityCaveats` prose, not as rules:

- Asset and resource tests with many exclusions.
- Work requirements with layered exemptions.
- Anything depending on immigration status. See [design.md](design.md) — the exceptions are
  intricate enough that getting them slightly wrong causes the worst error this app can
  make.
- Documentation requirements. These belong in `requiredDocuments`.

Use `manualReview` instead of `always` when the blocker is real but undecidable — an open
waiting list, funding that may have run out. That keeps the program visible as a lead
without promising an outcome the agency controls.

## Keeping data fresh

`stalePrograms(days)` in `src/data/programs/index.ts` returns records not checked within a
window, defaulting to 180 days. Program details drift constantly: waiting lists open and
close, funding runs out mid-year, phone numbers change. A record verified two years ago is
not meaningfully better than an unverified one.

Re-verification is the same procedure as above, ending in a new `lastVerified` date. Two
things surface which records need it: the time-based `stalePrograms()` check, and the
page-based "Source change detection" job above — both report on the same schedule.

## Future ingestion

The schema is built so a pipeline could populate it later — Grants.gov, Benefits.gov,
WI DHS, Dane County and City of Madison open data, 211 Wisconsin. Every field except
`eligibility` is flat and machine-fillable.

The "plausible middle path" below — ingest descriptive fields automatically, flag changed
source text for a human, automate the noticing not the judgement — is now partly built:
`scripts/ingest-descriptive` (issue #14) does the descriptive half, and the section above
describes it. What remains future work: descriptive **prose** (`summary`, `benefit`,
`howToApply.steps`) is still hand-authored — auto-diffing free text against a stripped page
produces noise, and rewriting it well needs the same judgement `eligibility` does — and
Tier-1 directory ingestion of *new* programs (where cross-source deduplication actually
bites) has no confirmed access path per `docs/data-sources.md`.

`eligibility` is the hard part and should stay hand-authored for the foreseeable future.
Eligibility rules are written for humans in prose, and the failure mode of getting them
subtly wrong at scale is severe — issue #51 is a concrete example: an LLM extractor lifted a
real threshold out of a conditional branch and dropped the conditions, producing a
schema-valid rule that would tell people they qualify when they do not.

The curation "database" is the git repo itself: history is the change log, PR review is the
write gate — see [design.md](design.md), "The shippable snapshot" (issue #8). The first
ingestion pipeline (#14) took this literally: rather than machine-editing the hand-authored
record modules or the generated `snapshot.json`, it maintains a committed review queue
(`scripts/ingest-descriptive/proposals.json`) and opens a PR against it. A human lands each
accepted proposal in the record file and regenerates the snapshot, the same as any hand
edit. If a later pipeline stage ever writes records directly, the snapshot stays its output
target and `SnapshotRecord` carries the per-record `provenance` field reserved for it. A
committed SQLite DB was considered and deferred — it is not justified until cross-source
deduplication stops being something a human can catch in review (argued in design.md).
