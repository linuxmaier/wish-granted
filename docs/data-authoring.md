# Authoring and verifying program data

> **The seed dataset is nearly fully verified.** 14 of 15 program records now carry a real
> `lastVerified` date (issue #2), and all three income tables in
> `src/data/reference/income-tables.ts` are verified as of 2026-08-21 (issue #3). The one
> holdout is `dane-eviction-prevention`: its income threshold could not be traced to a
> current, citizen-facing source (see the comment on that record), so it deliberately kept
> `lastVerified: null` and an unresolved-income `manualReview` rather than a guessed number.
> The UI's "unverified data" banner stays up until that record is resolved too, since it
> checks every record and every table. Re-verification on the usual cadence still applies —
> see "Keeping data fresh" below.

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
