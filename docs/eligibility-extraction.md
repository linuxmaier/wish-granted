# Eligibility extraction — spike findings and recommendation (issue #5)

Investigated 2026-08-18 through 2026-08-21: fetched real source pages (not synthetic
fixtures), ran a real deterministic extractor against them with a measured hit rate,
designed and validated an LLM extraction prototype against the actual `Criterion` schema
gate, and priced both against live, dated Anthropic API pricing. Depends on and builds
directly on `docs/data-sources.md` (issue #4) -- its corpus survey, its "does not fit"
list, and its PolicyEngine findings are inputs here, not re-derived.

**One correction to how this spike itself first read its own evidence, made by the
reviewing coordinator and folded in below rather than hidden:** an early draft of this
document treated four broken/redirected source URLs, observed three days after #4 ran, as
measured *change*. They are not -- every one of the 15 seed program records was authored
from memory with `source.lastVerified: null`, so a 404 against an unverified baseline is
authoring error, not churn. Section 5 ("Change rate") explains what actually happened when
this spike tried three different automatic ways to measure change rate, and why none of
them worked.

**A second correction, this one made by events rather than by the coordinator:** issue #3
landed on `main` while this spike was in progress and independently verified
`src/data/reference/income-tables.ts`'s three reference tables against their real sources,
renaming `FPL_2025`/`WI_SMI_60_2025`/`DANE_AMI_2025` to `FPL`/`WI_SMI_60`/`DANE_AMI` in the
process. An earlier draft of Sections 3, 5, and 8 below described this extractor's
disagreement with the (then-unverified) seed data as an open defect. It no longer is one --
merging #3 in showed the extractor's independently-fetched figures match #3's
independently-verified ones **exactly**. Sections 3 and 8 below are rewritten as
corroboration, not a bug report, and say so explicitly.

## TL;DR

- **Tiering the corpus first was the right call.** Of 21 real source pages/documents
  spanning the 15 current programs plus #4's candidates, roughly 43% (Tiers 1+2) are
  script-coverable with zero LLM calls, 24% (Tier 4) genuinely have no rule published at
  all and need zero LLM calls too, and the real LLM-from-prose corner (Tier 3) is about
  **33% of the corpus, not "everything."**
- **The deterministic extractor is real, not a sketch.** `scripts/extract-income-tables.mjs`
  gets 4/4 attempted HTML income tables right against real page snapshots, including a
  colspan-only footer row and three different table markups. Its output for FPL and
  WHEAP/WI-SMI matches issue #3's independently, hand-verified reference tables **exactly**
  -- two different methods, two different source formats (a live HTML page vs. a PDF manual
  plus a regulatory cross-check), the same numbers to the dollar. That agreement is now an
  enforced regression test, not just an observation -- see
  [Section 3](#3-tier-1-the-deterministic-extractor-measured).
- **The LLM prototype is built and schema-validated, but was NOT run against a live model
  in this spike** -- no `ANTHROPIC_API_KEY` was available in the sandboxed environment
  this spike ran in. `scripts/llm-extraction/run-eval.ts` is real, runnable code with a
  9-case eval set grounded entirely in text this spike actually fetched; it reports
  `SKIPPED` for every case without a key rather than fabricating a result. This is stated
  as a gap, not glossed over -- see [Section 4](#4-tier-3-the-llm-question-scoped-and-prototyped-not-yet-measured).
- **The headline cost-model number is reviewer-minutes, not tokens.** At a few hundred
  programs, the token bill stays trivially small; a one-person review queue does not. See
  [Section 6](#6-the-headline-constraint-is-reviewer-throughput-not-token-cost).
- **PolicyEngine's two open questions stay open**, per #4's own flag and the coordinator's
  instruction -- reasoning is given, no conclusion is asserted. See
  [Section 7](#7-policyengine-open-questions-not-resolved-here).

---

## 1. Method

For the tiering: 21 real source pages/documents -- the citation URL of every one of the 15
current program records, plus #4's structured-data candidates (eCFR, Wisconsin
Administrative Code, HUD AMI, USDA FNS/FNA). Fetched via `WebFetch` where it worked, and
via `curl` with a standard desktop-Chrome user agent where it didn't (WI state and some
nonprofit sites 403 a naive fetcher's default UA but serve a normal one -- confirmed again
in this spike, matching #4's finding).

For the deterministic extractor: raw HTML was saved to `tests/fixtures/income-tables/` (see
its `SOURCES.md`) and parsed with a real, dependency-free script, not eyeballed.

For the LLM prototype: a real tool-forced JSON-schema extraction call was designed and
implemented against the actual `Criterion` type, with a validity gate that duplicates (by
design, so it is usable standalone) the checks in `tests/data/vocabulary.test.ts`.

For pricing: fetched live from `https://platform.claude.com/docs/en/about-claude/pricing`
on **2026-08-21** (quoted in full in [Section 6](#6-the-headline-constraint-is-reviewer-throughput-not-token-cost)).
This mattered in practice, not just in principle: a cached reference this spike had access
to still listed Claude Sonnet 5 at "$3/$15 per MTok standard, $2/$10 introductory through
2026-08-31." The live page states plainly that **the $2/$10 pricing is now the standard
price** -- the scheduled September 1 increase to $3/$15 was cancelled. A cost model built
on the remembered figure would have overstated Sonnet 5 costs by 50% for every month after
August 2026. This is the same lesson as the URL-churn correction above, applied to a
different kind of remembered fact.

---

## 2. Corpus and tiering (measured)

**Re-checked against the #3 merge:** #3 verified and corrected *values* inside three income
tables; it didn't add, remove, or reshape any source page. Tiering is about how a source
*expresses* its rule (table vs. prose vs. nothing), which #3 doesn't touch, so the corpus
count and tier shares below are unaffected by the merge and were not recomputed.

| Tier | Definition | Count | Share | Examples |
|---|---|---|---|---|
| **1 -- Deterministic** | Literal numeric table, consistent markup | 6 | 29% | HHS poverty guidelines, MadCAP water-bill table, Lifeline's FPL-multiple table, WHEAP 60%-SMI table, USDA SNAP standards PDF, HUD AMI dataset |
| **2 -- Semi-structured** | Recoverable prose pattern ("X% of the federal poverty level", "if you receive program Y you qualify") | 3 | 14% | Lifeline's categorical program list, MadCAP's categorical sentence, DPI school-meals percent-of-FPL prose (inferred from pattern, page URL moved before re-check -- see [Section 8](#8-findings-to-hand-off-not-fixed-here)) |
| **3 -- Prose, real reading comprehension** | Policy text with exceptions, cross-references, deduction stacks | 7 | 33% | WI DHS FoodShare/WIC landing pages, Summer EBT's compound eligibility logic, WHEAP/Weatherization program pages, eCFR 7 CFR 273, Wisconsin Administrative Code DHS 101 |
| **4 -- No rule published** | The source itself declines to state one | 5 | 24% | Tenant Resource Center (eviction prevention screening tool, explicitly "not an application... no guarantee"), Dane Joining Forces for Families, 211 Wisconsin (HSDS: no eligibility entity exists, per #4), River Food Pantry, Second Harvest |

**Tier boundary sensitivity:** several pages carry more than one pattern (e.g. MadCAP and
Lifeline each have a Tier-1 table *and* a Tier-2 categorical sentence). Tier assignment
above uses "primary extractable rule, sub-pattern noted separately" -- a stricter
one-tier-per-page rule would move roughly 2 pages from Tier 1 into Tier 2's count. That
shifts the 29%/14% split to about 19%/24%; it does not change the conclusion, because
Tiers 1+2 combined stay at 43% of the corpus either way, and Tier 3 stays the corpus's
one-third genuinely requiring comprehension.

**Net read:** 43% of the corpus is a script's job (Tiers 1+2), 24% needs a human to write
one line of code and zero tokens (Tier 4), and the actual LLM-from-prose corner is **Tier
3, about a third of the corpus** -- meaningfully smaller than "everything needs a model,"
which is exactly the question this spike was commissioned to test rather than assume.

---

## 3. Tier 1: the deterministic extractor (measured)

`scripts/extract-income-tables.mjs` -- plain Node, zero new dependencies (no cheerio, no
jsdom; a regex-based HTML table tokenizer is enough for the well-formed markup these
sources actually use). Run it with `npm run extract:income-tables`
(reads local fixtures) or `--live` to refetch. Tested by
`tests/data/income-table-extraction.test.ts` against real page snapshots in
`tests/fixtures/income-tables/` (fetched 2026-08-21; see that directory's `SOURCES.md`).

**Result: 4/4 attempted HTML income-table sources extracted correctly**, including the
exact dollar amount for every household size and, where published, the per-additional-
person add-on:

| Source | Household of 1 | Household of 4 | Per-additional-person |
|---|---|---|---|
| HHS poverty guidelines (2026) | $15,960 | $33,000 | $5,680 |
| MadCAP (Madison water-bill assistance) | $45,450 | $64,900 | not published (flat ceiling at "8 or more") |
| Lifeline (48 contiguous states) | $21,546 | $44,550 | $7,668 |
| WHEAP (60% WI SMI, PY2025-26, annual) | $38,421 | $73,888 | not published on this page |

Two more Tier-1 sources (USDA's SNAP income standards, published as an annual PDF; HUD's
Area Median Income figures, served as a dataset/spreadsheet download rather than an HTML
table) were identified but **not attempted** -- different tooling (a PDF table extractor;
the HUD dataset API), out of scope for this script, and recorded as such rather than
silently dropped from the count. The 4/4 figure above is the HTML-table subset's hit rate,
not a claim about all 6 Tier-1 sources.

**Even "deterministic" needed a per-source adapter, not one universal parser.** All four
sources use different table markup: `<td>N</td><td>$amt</td>` (FPL) vs.
`<th>N</th><td>$amt</td>` (MadCAP) vs. a 4-column region table (Lifeline) vs. a
monthly-and-annual two-value table where only one column is the right one (WHEAP). The
per-additional-person figure sits in a **colspanned footer row** on the FPL page, which
this parser doesn't model as a real table cell -- the first working version silently
missed it because the naive lookup (`row[valueCol]`) is undefined on a collapsed row; the
fix was to check for the "additional person" pattern against the whole row before applying
column indexing. That bug, found and fixed in this spike, is exactly the kind of "should
parse reliably" claim the issue asked not to take on faith.

**Independent corroboration with issue #3's hand-verified reference tables -- the single
best argument in this document for the deterministic path.** When this extractor was first
run, `src/data/reference/income-tables.ts`'s tables were still unverified seed data
(drafted from memory), and its output disagreed with them substantially -- e.g. a
household-of-4 WHEAP figure of $73,888 against a then-seed value of $62,300. That looked,
at the time, like a data-quality bug to flag. It wasn't: issue #3 landed on `main`
independently, mid-spike, and verified the real tables by a **completely different route**
-- a human reading the HHS Federal Register notice and the WHEAP PY26 manual PDF directly,
cross-checked against a federal regulation's formula (45 CFR 96.85). Neither side knew
about the other while working.

The result, now that both exist: **`FPL` and `WI_SMI_60` (`src/data/reference/income-tables.ts`)
match this extractor's independently-fetched figures exactly**, every household size:

| Table | Household of 1 | Household of 4 | Per-additional-person |
|---|---|---|---|
| `FPL` (verified by #3) | $15,960 | $33,000 | $5,680 |
| This extractor (fetched from `aspe.hhs.gov`) | $15,960 | $33,000 | $5,680 |
| `WI_SMI_60` (verified by #3) | $38,421 | $73,888 | $2,217 (from 45 CFR 96.85 + the PDF manual, a document this extractor never reads) |
| This extractor (fetched from `energyandhousing.wi.gov`) | $38,421 | $73,888 | not published on this HTML page |

Two independently-arrived-at numbers landing on the same figure to the dollar is stronger
evidence than either result alone -- a scripted extractor reproduced a hand-verified figure
exactly, from a different document, by a different method, with nobody trying to make them
agree. `tests/data/income-table-extraction.test.ts`'s "corroboration" block makes this a
permanent, enforced regression rather than a one-time observation: if either side ever
drifts from the other without a real source change behind it, the test suite fails loudly.

**Not corroborated: `DANE_AMI`.** This extractor never attempted HUD's Area Median Income
figures (a dataset/spreadsheet format, out of scope for an HTML-table parser -- see the
`NOT_ATTEMPTED` list above), so this spike has no independent data point to agree or
disagree with #3's verified `DANE_AMI` ($135,300 four-person median). Said plainly rather
than left implicit: agreement was checked and found for two of the three tables; the third
was never attempted, which is a different thing from "checked and passed."

---

## 4. Tier 3: the LLM question, scoped and prototyped (not yet measured)

### 4.1 What extraction has to produce

Per the issue: a `Criterion` tree (`src/domain/criteria.ts`) plus a verbatim source
excerpt, not free text. `scripts/llm-extraction/criterion-schema.ts` builds the JSON
Schema for this directly from `FACT_KEYS` (`src/domain/facts.ts`), so the schema handed to
a model can never drift out of sync with the real fact vocabulary the way a hand-copied
schema could. It is used as a forced tool-use call (`tool_choice: {type: "tool", ...}`,
`strict: true`) so the model can only construct valid node shapes.

JSON Schema alone cannot express "the value compared against an enum fact must be one of
*that fact's* declared options" (a cross-field constraint). `scripts/llm-extraction/schema-gate.ts`
is the second, ground-truth check: it **duplicates the exact logic** in
`tests/data/vocabulary.test.ts`'s "criteria are well formed" block (deliberately, so it
works standalone in a build-time pipeline without pulling in the whole test suite), and
`tests/data/llm-extraction-eval.test.ts` asserts it agrees with the real test suite by
running it against every one of the 15 real program records already in the dataset. A
model output that fails this gate must never reach a human reviewer as a candidate rule --
it goes back for another attempt or gets logged as a failed extraction. This is the
concrete implementation of "output must validate against the existing schema gate."

### 4.2 Abstention is designed in, not bolted on

The system prompt (`scripts/llm-extraction/run-eval.ts`) tells the model explicitly:
manualReview is a correct, expected answer, not a failure; under-claiming beats
over-claiming; a `confidence: "low"` field exists precisely so the model can flag a
technically-valid extraction it isn't sure of. `manualReview` can appear as the whole rule
or as **one leaf inside a larger `allOf`** -- generalizing the pattern already used
correctly by `madison-housing-choice-voucher.ts`, where real `livesIn`/`incomeAtOrBelow`
criteria sit alongside a `manualReview` leaf for the waitlist gate the CDA controls, not
the rules engine. That is the right shape for extraction to aim for: don't collapse a
whole program to manual review just because one condition inside it is genuinely
undecidable.

### 4.3 The eval set

`scripts/llm-extraction/eval-cases.ts` -- 9 cases, every excerpt real text this spike
fetched (never invented for the eval, the same rule the brief applies to the shipped
dataset):

**Should extract (4 cases):** MadCAP's categorical sentence ("if you qualify for
FoodShare, Section 8, SNAP, or WIC..." -- tests whether "Section 8" correctly maps to the
canonical `housing-choice-voucher` fact value, and whether "FoodShare"/"SNAP" collapse to
one value instead of two); MadCAP's 50%-AMI sentence; Lifeline's 135%-FPL sentence; WHEAP's
60%-SMI sentence (a deliberately-included near-miss trap: the cited income table *is
already* the 60%-of-SMI figure, so the correct rule is `incomeAtOrBelow('wi-smi', 100)`,
matching the convention the existing WHEAP records use -- a model that instead emits
`incomeAtOrBelow('wi-smi', 60)` double-applies the percentage and silently understates who
qualifies, which is the worst-error direction this project cares about most).

**Should abstain (5 cases):** SNAP's excess-shelter deduction (7 CFR 273.9 -- the
regulation text itself still prints a fiscal-year-2001 dollar figure, superseded every
year by an FNS notice the regulation doesn't contain; hard-coding it would mean citing a
25-year-stale number with total confidence); SNAP's alien/citizenship eligibility test (7
CFR 273 -- five factors including a hard 1996 cutoff date, matching `facts.ts`'s own
existing decision to leave `citizenshipStatus` unasked in v1); SNAP's ABAWD work-requirement
cross-reference (one sentence pointing at an entire other section's exemption tree -- tests
whether the model resists "one sentence, one rule" reasoning); Tenant Resource Center's
funding-contingent disclaimer (Tier 4 in miniature: a source that explicitly declines to
state a rule); and, most pointedly, **the same Tenant Resource Center excerpt tested again
specifically against `dane-eviction-prevention.ts`'s existing `incomeAtOrBelow('dane-ami',
80)`** -- that figure does not appear anywhere on the page cited as its source. A
correctly-abstaining extractor would have caught this, not caused it. See
[Section 8](#8-findings-to-hand-off-not-fixed-here).

### 4.4 What was and was not measured

**Not measured: an observed abstention rate.** `scripts/llm-extraction/run-eval.ts` is
real, complete, runnable code -- correct request shape, forced tool schema, the scoring
logic distinguishes "correct abstention" from "dangerous over-claim" from "correct
extraction" from "over-cautious" -- but **no `ANTHROPIC_API_KEY` was available in the
sandboxed environment this spike ran in**, so it was never executed against the live API.
Every case reports `SKIPPED` rather than a fabricated pass/fail; run it with
`npm run eval:llm-extraction` once a key is available. This is stated as a gap because it
is one: the issue's acceptance criteria explicitly asks for an observed abstention rate,
and this spike does not have one to report.

**What was measured instead:** `tests/data/llm-extraction-eval.test.ts` checks the harness
itself -- every hand-authored "correct extraction" target is itself schema-valid (the
ground truth is held to the same bar a model's output would be), every eval case is
grounded in a real citation and a non-trivial excerpt, and the gate genuinely agrees with
the production test suite on the real dataset. That is real verification of the mechanism;
it is not a substitute for running the mechanism against a model.

**Recommendation:** run `npm run eval:llm-extraction` with a real key before treating LLM
extraction as validated. Nine cases is enough to sanity-check the design, not enough to
certify an abstention rate with statistical confidence -- a production rollout should grow
this set substantially, weighted toward Tier 3's real shape (roughly half categorical/
percent-of-FPL prose, half the "doesn't fit" list from #4), before being trusted unattended.

---

## 5. Change rate: three signals that don't work, and the one that does

The steady-state cost estimate needs a rate of "how often does a Tier-3 source's actual
*rule* change," not "how often does a byte change." This spike tried three automatic
proxies and rejected all three, which is worth documenting so nobody re-tries them without
first reading this:

1. **URL 404s against an unverified baseline.** An early pass observed that 4 of the 15
   seed program source URLs now 404 or redirect, days after #4 first surveyed them, and
   read that as measured churn. It isn't: every one of the 15 records was authored from
   memory (`source.lastVerified: null` on all of them), so a wrong URL and a moved URL are
   indistinguishable from the outside, and the most likely explanation is that these URLs
   were wrong when written, not that four government/nonprofit sites moved in three days.
   **A change-rate signal is only meaningful against a verified baseline** -- this is a
   direct, concrete illustration of why #7's change detection has to run against verified
   `source.url` values to mean anything at all, not an abstract caveat.
2. **`Last-Modified` headers.** Checked directly against the four working Tier-1 sources
   (`curl -I`). Three of four returned a `Last-Modified` timestamp from **today**, on
   pages that publish a genuinely new number once a year. These are Drupal/SharePoint CMS
   platforms that appear to stamp `Last-Modified` at render/cache time, not at last
   substantive edit -- the header is not a change signal for these specific sources.
3. **Wayback Machine snapshot digests.** Queried the CDX API for
   `aspe.hhs.gov/topics/poverty-economic-mobility/poverty-guidelines`
   (`web.archive.org/cdx/search/cdx?...&collapse=digest`) for Feb-Dec 2024, i.e.
   deliberately excluding the January window when the real annual update happens. Result:
   **338 distinct content digests** in an 11-month period on a page whose actual published
   guideline figures change once a year, every January. Byte-level digest churn on a
   government page is dominated by something incidental to content (a render timestamp, a
   tracking parameter, template noise) -- collapsed-digest snapshot counts are not a
   change-rate signal for this class of source either.

**What actually works: known publication cadence.** HHS poverty guidelines republish every
January (a decades-long, well-documented federal practice, and the live-fetched page
itself is version-labeled "2026 POVERTY GUIDELINES"). WHEAP operates on a fixed
October-to-May program year with a new income table published at the start of each cycle.
USDA's SNAP income standards republish each federal fiscal year (October 1). That accounts
for effectively all of Tier 1: **once-a-year, on a knowable date**, for the sources this
spike checked.

Tier 3's prose pages don't have a comparably crisp public cadence. This spike did not
measure their real revision frequency -- doing so properly means #7's change detection
running for several months against a *verified* baseline and reporting what it actually
sees, which this spike had neither the time nor (per points 1-3 above) a trustworthy
proxy for. The cost model below uses a deliberately conservative, clearly-labeled
**structural estimate** (a minority of Tier-3 pages showing a substantive change in a
given year, well below Tier 1's "all of them, once a year" because policy prose changes
less often than a published number does) rather than presenting a guess as a measurement.

---

## 6. The headline constraint is reviewer throughput, not token cost

Read the token-cost numbers below, then read this section again: at every scale this spike
modeled, the token bill stays small enough to round to "cheap." The queue of humans needed
to review what the model produces does not scale the same way, and it is the actual
bottleneck a roadmap should plan around.

### 6.1 Pricing (live, dated)

Fetched **2026-08-21** from `https://platform.claude.com/docs/en/about-claude/pricing`.

| Model | Input | Output | 5-min cache write | Cache read | Notes |
|---|---|---|---|---|---|
| Claude Sonnet 5 | $2.00 / MTok | $10.00 / MTok | $2.50 / MTok | $0.20 / MTok | The page states the $2/$10 rate, launched as introductory pricing through 2026-08-31, **is now the standard price** -- the scheduled increase to $3/$15 will not occur. |
| Claude Opus 5 | $5.00 / MTok | $25.00 / MTok | $6.25 / MTok | $0.50 / MTok | Comparison line, per the coordinator's request. |

Batch API (50% off, non-latency-sensitive -- a reasonable fit for a build-time extraction
run): Sonnet 5 $1.00 / $5.00 per MTok. Forcing a single tool call adds a small, fixed
overhead (Sonnet 5: ~474 tokens of input per request for the tool-use system prompt when
`tool_choice` forces a specific tool, vs. ~354 for `auto`) -- included in the per-page
estimate below, not separately itemized, because it is small relative to a real source
excerpt.

**Model choice: Sonnet 5 for the bulk pass, Opus 5 as a comparison line.** This is a
build-time batch job with a mandatory human review gate downstream (Section 4.2, and the
constraints in Section 7 of the issue) -- not an unsupervised, correctness-critical path --
so Sonnet's cost/quality point is the right default; Opus is costed alongside for the
sensitivity table so the reader can see what upgrading everything would cost, not asserted
as necessary.

### 6.2 Assumptions (edit these)

| Assumption | Value | Basis |
|---|---|---|
| Tier-3 pages, current scale | 7 | Measured, Section 2 |
| Tier-3 pages, regional-expansion scale | ~140 (33% of a ~430-page corpus at ~20x program count) | Scaled from the measured 33% share, not re-measured |
| Tokens per page (excerpt + system prompt + schema + tool-use overhead) | ~3,000 input / ~600 output | Typical excerpt length observed in this spike's fetches (a few hundred to ~2,000 words) plus schema/prompt overhead; not a measured average across a large sample |
| Retry/validation overhead | 1.3x | One retry in ~3 cases (gate failure or abstention-worth-a-second-look), a placeholder pending real data from a live run |
| Change rate, Tier 1 (income tables) | 100%/year, once, on a known date | Section 5 |
| Change rate, Tier 3 (prose rules) | ~15%/year, structural estimate | Section 5 -- explicitly not measured; #7 should replace this once it has months of real verified-baseline data |
| Reviewer time per extracted rule | 5-10 minutes | A human reads the excerpt, the emitted `Criterion`, and the citation, and either approves, edits, or rejects -- comparable to a careful code-review pass on a small diff, not a fresh research task (the excerpt and provenance are already attached) |
| Reviewer availability | ~1 person, part-time | This project's actual current capacity, not a hired-review-team assumption |

### 6.3 Initial extraction

At current scale (7 Tier-3 pages, Sonnet 5, non-batch): 7 × (3,000 × $2.00 + 600 × $10.00)
/ 1,000,000 × 1.3 retry factor ≈ **$0.09**. Batch API roughly halves it. Opus 5 at the same
token counts: about **$0.46**. Either way, initial extraction at this project's real size
is not a cost question -- it's a five-minute API bill.

At the ~430-page / ~140-Tier-3-page regional-expansion scale: 140 × the same per-page cost
≈ **$1.80** (Sonnet 5) or **$9.10** (Opus 5). Still trivial in absolute terms.

### 6.4 Steady state (monthly)

Per Section 5: Tier 1 changes ~once/year on a known date (so its *steady-state monthly*
cost is that same small one-time number, amortized -- effectively free most months and a
predictable small spike in the known refresh month). Tier 3, at the ~15%/year structural
estimate, means roughly **1.25% of Tier-3 pages re-extracted in an average month**.

- **Current scale:** 7 × 1.25% ≈ 0.09 pages/month -- i.e. re-extraction fires roughly once
  a year for the whole current Tier-3 corpus, not every month. Monthly token cost rounds
  to zero.
- **Regional-expansion scale:** 140 × 1.25% ≈ **1.75 pages/month** re-extracted. At the
  same per-page token cost, that's under a cent a month.

**This is the point the issue asked this section to make, and the numbers bear it out:**
steady-state token cost tracks the change rate, not the corpus size, and at every scale
modeled here it is small enough that it is not the number worth optimizing.

### 6.5 Reviewer throughput -- the number that actually constrains the roadmap

Reviewer-minutes do not shrink the way token cost does, because *initial* extraction (not
just steady-state re-extraction) still has to pass through a human once, and initial
extraction scales with corpus size, not change rate.

| Scale | Tier-3 pages | Reviewer time (5-10 min/rule) | At ~1 part-time reviewer (~5 hrs/week) |
|---|---|---|---|
| Current (15 programs) | 7 | 35-70 minutes | Done same day |
| Regional expansion (~300 programs) | ~140 | 12-23 hours | 2.5-4.5 weeks of the reviewer's *entire* available time, doing nothing else |

At 300 programs, the token bill for initial extraction is under $2 and the review queue is
a month of one person's part-time capacity. **If this project scales toward "a few hundred
programs," reviewer throughput -- not API spend -- is the constraint the roadmap needs to
plan around**: either budget real reviewer hours, or find a way to sample/prioritize which
extracted rules get full review (e.g. auto-approve only `manualReview` outputs, which
carry no wrong-threshold risk, and route every specific `compare`/`incomeAtOrBelow` output
through a human unconditionally). That prioritization idea is a design suggestion coming
out of this spike, not something implemented here.

---

## 7. PolicyEngine: open questions, not resolved here

Per #4's flag and the coordinator's instruction: reasoning below, no conclusion asserted.
**Nothing from `policyengine-us` was installed into this repository** -- a throwaway venv
was used to attempt the partial-input question (see below) and nothing from it was copied
into this codebase.

**AGPL-3.0 and build-time parameter extraction.** The distinction #4 identified is the
load-bearing one: a published income threshold or formula *value* is a fact about public
policy, and facts are not copyrightable; the *code* that computes or organizes those facts
is AGPL-licensed, and AGPL's distinguishing obligation triggers on operating the covered
software as a network service or distributing/embedding it. Reading a parameter value out
of `policyengine-us` at build time, by hand or by script, to cross-check or inform a value
this project then writes into its own independently-authored `Criterion` tree, is a
materially different act from redistributing or embedding PolicyEngine's engine. That
reasoning holds up on its own terms. **It is not a legal conclusion, and this document
does not treat it as one** -- the honest position is that this needs a real legal opinion
before the project depends on it, not that this paragraph settles it. Marked open.

**Partial/unknown inputs.** This spike went one step further than #4 did and tried to
answer this empirically rather than from documentation alone: a throwaway virtual
environment was created (`pip install policyengine-us`; nothing committed to this repo)
specifically to run a household simulation with a missing input and observe what happens.
The install did not complete -- `pip` failed with `OSError: [Errno 2] No such file or
directory` while writing one of `jedi`'s bundled type-stub files
(`.../jedi/third_party/django-stubs/django-stubs/contrib/auth/management/commands/__init__.pyi`),
which is consistent with a Windows long-path limit (this spike's sandboxed environment
uses an unusually long temp-directory path, and that specific failing file sits many
directories deep inside one of PolicyEngine's transitive dependencies). This looks like an
artifact of this specific environment, not of `policyengine-us` itself, so it should not be
read as a mark against the package -- but it means **the partial-input question is not
resolved here either**, for a mundane practical reason rather than a design one. Left open,
exactly as #4 left it; a follow-up attempt from a normal (short-path) working directory
would likely get further.

**Verdict, unchanged from #4:** worth serious follow-up as a cross-check for
federal-program thresholds specifically (SNAP, WIC), never as a source for county- or
city-level programs, and not a drop-in replacement for this project's own `Criterion` trees
until both questions above have real answers.

---

## 8. Findings to hand off (not fixed here)

Two items, both surfaced by real fetches in this spike, both explicitly out of scope to fix
in a spike whose deliverable is a document and a prototype, not dataset edits:

- **`dane-eviction-prevention.ts`'s `incomeAtOrBelow('dane-ami', 80)`** has no traceable
  source span on the Tenant Resource Center homepage this record cites -- that page states
  only that its screening tool is "not an application for financial assistance" with "no
  guarantee" of a funding match, and publishes no percentage anywhere. Forwarded to the #2
  agent, who owns this record. This spike's eval set (Section 4.3, case
  `trc-no-published-ami`) uses exactly this excerpt as its sharpest abstention trap for
  exactly this reason.
- **The four broken/redirected source URLs** described in Section 5, reframed correctly as
  authoring error against an unverified baseline rather than three-day churn. Input to #2
  (the URLs themselves need fixing) and #7 (change detection needs a verified baseline to
  mean anything).
- ~~`WI_SMI_60`'s figures run below the live WHEAP table~~ -- **resolved.** This was flagged
  in an earlier draft of this document, written before issue #3 landed. #3 independently
  verified the real table; it now matches this extractor's output exactly. See Section 3's
  corroboration writeup. Left here, struck through, so the history of "flagged, then
  resolved" stays visible rather than silently disappearing.
- **DPI's school-meals page URL also moved** before this spike could re-check its
  percent-of-FPL prose directly; Tier 2's count for that source is inferred from the
  general USDA school-meals pattern (130%/185% FPL), not independently confirmed this
  round -- flagged rather than stated as verified.

---

## 9. Recommendation

0. **The LLM path is not validated yet, and no reader should come away from this document
   thinking it is.** Abstention rate -- not extraction accuracy -- is this spike's headline
   metric (Section 4.4, Section 4.3's trap-heavy eval set), and it is currently
   **unmeasured**: no `ANTHROPIC_API_KEY` was available in this sandboxed environment, so
   `scripts/llm-extraction/run-eval.ts` has never been run against a real model. Issue #23
   has been filed to run it live once a key is available. Every recommendation below about
   Tier 3 / the LLM path is conditional on #23's result, not a substitute for it.
1. **Ship a deterministic extractor for income-table refreshes -- #24 already has, and it is
   now the production path, not this spike's.** `scripts/extract-income-tables.mjs` was
   built and measured here to answer the tiering question with real code, and its 4/4
   result independently corroborates issue #3's hand-verified `FPL`/`WI_SMI_60` figures
   exactly (Section 3) -- real evidence for the deterministic-extraction thesis this whole
   document argues for. But issue #24 landed mid-spike with its own refresher
   (`scripts/refresh-income-tables/`, wired to `npm run refresh:income-tables`) covering the
   same ground for production use. **#24's tool is the one to run and maintain going
   forward; this spike's extractor stays as evidence and a corroboration cross-check (its
   test suite), not a second production path.** Don't merge the two or maintain both as
   live tooling -- see the note in Section 3. #24 doesn't change this document's Tier 1
   conclusion; it confirms it by independently choosing to build the same kind of tool this
   spike recommended.
2. **Treat Tier 4 as a human decision, not a pipeline stage.** No source-fetching or model
   call belongs in front of "this source publishes no rule" -- a human reads the page once
   and writes `manualReview`, using the mixed-leaf-inside-`allOf` pattern from
   `madison-housing-choice-voucher.ts` wherever part of the same program *is* decidable.
3. **Build Tier 3 extraction on the prototype in this spike, but run the eval set against a
   real model before trusting it (see item 0).** The design (forced schema, reused gate,
   abstention as a first-class correct output, provenance excerpt required) is sound and
   validated at the mechanism level; the model-behavior level is not yet measured. That is
   the concrete next step -- tracked as #23 -- not a re-design.
4. **Plan the roadmap around reviewer-minutes, not token cost**, once this project's scope
   grows past its current 15 programs -- Section 6.5's math says that constraint arrives
   long before the token bill becomes interesting.
5. **PolicyEngine stays a future cross-check, not a dependency**, pending real answers to
   both open questions in Section 7.

All of the above respects the hard constraint this whole design exists to serve:
extraction happens at build time, invoked by a human or CI (`npm run extract:income-tables`,
`npm run refresh:income-tables`, `npm run eval:llm-extraction`), never from the shipped app
-- confirmed directly by this spike's `npm run build`, which produces the same
dependency-free browser bundle whether or not `scripts/` exists, because nothing in `src/`
imports it.
