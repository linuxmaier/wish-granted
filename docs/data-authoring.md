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

## Refreshing the income tables

**By hand.** The deterministic refresher that used to do this
(`scripts/refresh-income-tables`, issue #6) was deleted in the 2026-09-08 unwind
(#97), along with the rest of the pipeline. Nothing fetches these figures now,
and nothing warns you when they lapse.

The procedure is the verification procedure above, applied to all three tables:
fetch each from its live source, check `bySize` and `perAdditionalPerson`
against it, bump `effectiveYear`, and set `lastVerified` to the date you
actually read the page. The docblock in `src/data/reference/income-tables.ts`
names the current expiry; `docs/standing-decisions.md` carries it as a dated
obligation rather than a nice-to-have, because every program's effective
threshold moves when these do.


## Source change detection

**There is none.** `scripts/check-sources` (issues #7, #82) was deleted in the
unwind. Nothing notices when a source page moves, 404s, or quietly rewrites its
eligibility rule.

Until something replaces it, the only signal is time-based: `stalePrograms()`
below. Re-verify on that schedule and assume nothing about pages you have not
opened recently. Recorded as a known gap in `docs/standing-decisions.md`.


## Descriptive-field ingestion

**There is none.** `scripts/ingest-descriptive` (issue #14) proposed phone
numbers, URLs and statuses into a committed review queue; it was deleted in the
unwind. Every field of every record is hand-authored today.


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

**A fact is worth asking when it unlocks programs worth including** — coverage, not whether
a rule already in the dataset happens to reference it. The rule, the circular one it
replaced (#88), and the per-fact reopen conditions live in
[standing-decisions.md](standing-decisions.md), "When a fact earns a question". Do not
re-derive them here; this section is the procedure only.

In practice, before adding a fact:

1. Name the programs it would unlock. If you cannot, it has not earned a question yet.
2. Check whether an existing question can carry it — a checkbox on a `multi` question that
   already renders costs nothing extra to ask.
3. Ask for the least the rules need. A boundary, not a precise value.
4. Give a new question its own screen, so `flow.ts` can drop it when nothing undecided
   depends on it (see the `about-you` screen — most people never see it).

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
- **Encoding a bound narrows the rule — do it carefully.** Gate only the branch that
  genuinely requires the condition, so the bound cannot rule out someone it was never
  about. `badgercare-plus`'s age bound sits on the childless-adult
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
- Anything depending on immigration status. See
  [standing-decisions.md](standing-decisions.md) — the exceptions are intricate enough that
  a slightly wrong rule would tell a family they are ineligible when they are not.
- Documentation requirements. These belong in `requiredDocuments`.

Use `manualReview` instead of `always` when the blocker is real but undecidable — an open
waiting list, funding that may have run out. That keeps the program visible as a lead
without promising an outcome the agency controls.

## Keeping data fresh

`stalePrograms(days)` in `src/data/programs/index.ts` returns records not checked within a
window, defaulting to 180 days. Program details drift constantly: waiting lists open and
close, funding runs out mid-year, phone numbers change. A record verified two years ago is
not meaningfully better than an unverified one.

Re-verification is the same procedure as above, ending in a new `lastVerified` date. Since
the page-based change detector was deleted (above), `stalePrograms()` is the **only** thing
that surfaces which records need it — and it measures elapsed time, not whether the page
actually changed. A source can be rewritten the day after you verify it and nothing will
say so.

## Future ingestion

There is no pipeline. The one built through 2026 was unwound on 2026-09-08 —
see #97 for why, and [`pipeline-principles.md`](pipeline-principles.md) for the
constraints any future attempt inherits. Do not re-argue it here; whether
`eligibility` stays hand-authored is a standing decision, recorded in
[`standing-decisions.md`](standing-decisions.md).

The schema is still built so a pipeline could populate it later: every field
except `eligibility` is flat and machine-fillable, and `SnapshotRecord` carries
a per-record `provenance` field reserved for that.

Two things do not move whatever comes next:

- **A human reviews every eligibility change before it lands.**
- **The curation "database" is the git repo itself** — history is the change log,
  PR review is the write gate. See [design.md](design.md), "The shippable
  snapshot" (issue #8). A committed SQLite DB was considered and deferred; it is
  not justified until cross-source deduplication stops being something a human
  can catch in review.
