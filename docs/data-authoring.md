# Authoring and verifying program data

> **The seed dataset is only partly verified.** All 15 program records still carry
> `lastVerified: null` and were drafted from secondary knowledge, not read off the official
> sources. The three income tables in `src/data/reference/income-tables.ts` **are** verified
> as of 2026-08-21 (see below) -- including `WI_SMI_60`, whose `source` citation the issue
> #6 refresher moved to a more stable page (described further down); a human independently
> re-confirmed the figures against that new citation before `verified` was set back to
> `true`, per "Reviewing a proposed update" below. The UI's "unverified data" banner stays up
> regardless, until the program records are verified too, since it checks all of them
> together. Working through the program-record verification pass below is still
> a prerequisite for showing this to the public.

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

## Adding a new program

1. Create `src/data/programs/<id>.ts` exporting a `Program`. Copy the nearest existing
   record — `foodshare-snap-wi.ts` for a standard income-tested benefit,
   `the-river-food-pantry.ts` for something with no income test.
2. Write `eligibility` with the builders from `@/domain/criteria` (`allOf`, `anyOf`,
   `incomeAtOrBelow`, `livesIn.madison`, …) rather than raw object literals.
3. Register it in `src/data/programs/index.ts`.
4. Run `npm test`.

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

Re-verification is the same procedure as above, ending in a new `lastVerified` date.

## Future ingestion

The schema is built so a pipeline could populate it later — Grants.gov, Benefits.gov,
WI DHS, Dane County and City of Madison open data, 211 Wisconsin. Every field except
`eligibility` is flat and machine-fillable.

`eligibility` is the hard part and should stay hand-authored for the foreseeable future.
Eligibility rules are written for humans in prose, and the failure mode of getting them
subtly wrong at scale is severe. A plausible middle path: ingest the descriptive fields
automatically, flag records whose source text changed since `lastVerified`, and route those
to a human. Automate the noticing, not the judgement.
