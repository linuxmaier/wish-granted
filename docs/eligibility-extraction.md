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
  `SKIPPED` for every case without a key rather than fabricating a result. **Since measured
  live against the nine-case tuning set -- see Section 4.4 -- and since hardened by issue
  #43 with a ~~33-case set~~ 41-case set, a frozen held-out split, the enum-slug fix, and
  schema prompt caching (Section 4.6-4.7). ~~The held-out run is itself still `SKIPPED`: no key was
  available for #43 either.~~ **The held-out split has now been run live (2026-09-05):
  the enum-slug fix and caching both work -- zero gate failures across ~~19~~ 27 held-out cases,
  ~~83%~~ 85% input-cost saving -- but the run returned ~~one dangerous over-claim~~ dangerous
  over-claims and is therefore BLOCKING. The model lifts real income thresholds out of
  conditional branches (survivor-only, emergency-only, cost-tier-not-a-ceiling) and drops
  the conditions gating them; the output is schema-valid, so no gate catches it. Issue #51
  grew the held-out set with eight conditional-scope cases to make this measurable; the
  pre-fix baseline is 3 dangerous over-claims in 27 (Section 4.6). The extractor is not
  cleared for #14's eligibility path.** This is stated
  as a gap, not glossed over -- see [Section 4](#4-tier-3-the-llm-question-scoped-and-prototyped-not-yet-measured).
- **The headline cost-model number is reviewer-minutes, not tokens.** At a few hundred
  programs, the token bill stays trivially small; a one-person review queue does not. See
  [Section 6](#6-the-headline-constraint-is-reviewer-throughput-not-token-cost).
- **PolicyEngine's two open questions stay open**, per #4's own flag and the coordinator's
  instruction -- reasoning is given, no conclusion is asserted. See
  [Section 7](#7-policyengine-open-questions-not-resolved-here).
- **Issue #24 landed mid-spike with its own income-table refresher.** It's now the
  production path (`npm run refresh:income-tables`); this spike's extractor stays as
  evidence and a standing corroboration check, not a second tool to maintain. See
  [Section 3](#3-tier-1-the-deterministic-extractor-measured).

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

**Which tool is the production path, now that there are two.** Issue #24 landed on `main`
mid-spike with `scripts/refresh-income-tables/` -- a real, tested, deterministic refresher
covering the same three tables (`npm run refresh:income-tables`), independent of this
document's extractor. The two were built for different purposes and shouldn't be merged:
this spike's `scripts/extract-income-tables.mjs` exists to answer the tiering question with
real code and, as it turned out, to cross-check #3's verification -- its value now is as
standing evidence and a permanent corroboration test, not as a tool anyone should run to
actually refresh the dataset. **`scripts/refresh-income-tables/` is the one to run and
maintain going forward** -- it's the more complete tool (it patches the file directly with a
guardrail against implausible jumps, and covers `DANE_AMI` too, which this spike's script
never attempted). Nobody should end up maintaining two income-table fetchers; this is the
explicit statement of which one that is. #24's existence doesn't change this document's
Tier 1 conclusion -- it independently confirms it, by a different team choosing to build the
same category of tool this document argues Tier 1 calls for.

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
`scripts/llm-extraction/llm-extraction-eval.test.ts` asserts it agrees with the real test
suite by running it against every one of the real program records already in the dataset. A
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

> **Demoted to a narrow-skill regression check by issue #66 / epic #65.** This set measures
> one artificial task -- "given a fixed, pre-cut excerpt, emit a `Criterion` in one shot" --
> and #65 explains why the ceiling it produced (~17% Tier-3 yield) was an artefact of the
> excerpt, not a limit on capability: every one of the six dangerous over-claims was a
> context-starvation failure (the governing clause was outside the excerpt), not a
> comprehension failure. The **primary** measure is now the program-level benchmark
> (`scripts/program-benchmark/`, issue #66): *given a source URL, produce a `Program`
> record or abstain*, scored against the 16 hand-verified records. See
> `docs/program-benchmark.md`.
>
> `scripts/llm-extraction/eval-cases.ts` **stays in the tree** and is still run
> (`npm run eval:llm-extraction`). What it is good for now: a fast, cheap regression check
> on the one narrow skill of turning a clean paragraph into a `Criterion` -- the enum-slug
> mapping, the near-miss threshold traps, the "this number is not an eligibility bar"
> discriminations. It is a unit test for a sub-skill, not a measure of the pipeline. Do not
> re-derive #65's reasoning here; it is settled there.

> **Superseded by issue #43 (see [Section 4.6](#46-hardening-issue-43)).** The set is now
> ~~33 cases split into a frozen held-out partition (19)~~ **41 cases split into a frozen
> held-out partition (27, after the #51 conditional-scope expansion below)** and a tuning
> partition (14, the nine below plus five). Every excerpt is still real fetched text, and
> the nine original cases are unchanged and all live in the tuning split. The description
> below is kept for history; `eval-cases.ts` is the current source of truth.
>
> **Held-out expansion (issue #51, 2026-09-05).** The first live held-out run returned a
> dangerous over-claim in a class the tuning set had no example of -- a real threshold
> lifted out of a conditional branch with its scope silently dropped
> (`lifeline-survivor-extended`). Eight cases were added to the held-out split for this
> class: six *conditional-scope traps* (`abstain` -- a threshold gated by a heading, a
> column label, a list stem, an "extended eligibility" branch, or an undecidable
> predicate) and two *controls* (`extract` -- qualifiers that look scope-changing but are
> not, so over-caution is measurable). Built and frozen *before* the option-2 fix is
> designed, per #51's acceptance criteria. See [Section 4.6](#46-hardening-issue-43).

`scripts/llm-extraction/eval-cases.ts` -- ~~9 cases~~, every excerpt real text this spike
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

### 4.4 Measured: the live run (issue #23)

> **Not superseded, but re-scoped by issue #43.** The numbers below stand as what they
> always were: a measurement of the model against the **nine-case tuning set**, before the
> enum-slug fix. They are *not* a held-out result and were never meant to be read as one
> (the last two paragraphs of this section say so). [Section 4.6](#46-hardening-issue-43)
> is where the held-out measurement lives. The one deliberate hedge below -- "the obvious
> fix ... is deliberately not applied here" -- is the thing #43 exists to close.

**Run on 2026-08-21 against `claude-sonnet-5`, three times, with identical results each
time.** Nine cases per run, 27 case-evaluations total.

| Outcome | Per run | Across 3 runs |
|---|---|---|
| Correct abstentions (of 5 abstain cases) | **5 / 5** | 15 / 15 |
| **Dangerous over-claims** | **0** | **0 / 15** |
| Correct extractions (of 4 extract cases) | 3 / 4 | 9 / 12 |
| Gate failures | 1 (`madcap-categorical`) | 3 / 12 |

These are reported separately and deliberately never blended into an accuracy figure. A
model that is 95% right and confidently wrong the rest is worse for this product than one
that is 80% right and abstains: a wrong threshold reaches a person in financial crisis as
a stated fact, an abstention reaches a human reviewer first.

**The abstention result is the headline: 5/5, three times running.** Every trap held --
SNAP's shelter-deduction stack, the alien-status test, ABAWD work requirements, the
Tenant Resource Center's funding-contingent language, and the self-referential
`dane-eviction-prevention` case built from this project's own unsourceable 80%-AMI
finding. Zero dangerous over-claims across all three runs.

**The one failure is the gate doing its job, not the model inventing a rule.** On
`madcap-categorical` the model emitted human-readable benefit names -- `"FoodShare"`,
`"Section 8"`, `"SNAP"`, `"WIC"` -- where `currentBenefits` declares the slugs
`snap-foodshare`, `housing-choice-voucher`, and so on. Semantically correct, mechanically
wrong, and **caught before it could reach a human reviewer**, exactly as designed. JSON
Schema cannot express "this value must be one of *that specific fact's* options" (a
cross-field constraint), which is precisely why `schema-gate.ts` exists as a second check.

The obvious fix is to list each enum fact's valid values in the system prompt. It is
**deliberately not applied here**: tuning the prompt against a nine-case set and then
re-reporting the same set would be measuring the tuning, not the model. That belongs to
whoever builds the real pipeline, with a held-out set.

**How much to read into this.** Not much, honestly. Nine cases, one model, one prompt,
three runs. Perfect stability across runs is reassuring about determinism, not about
coverage. A production rollout needs a substantially larger set weighted toward Tier 3's
real shape, plus a held-out split. What this **does** establish is that the design works
end to end -- the model abstains when asked to, the gate catches what the model gets
wrong, and nothing dangerous reached the far end of the pipe.

### 4.5 What it took to make the harness actually run

The harness had never executed. Getting it to took four fixes, each a hard API constraint
the original design did not anticipate. They are recorded because anyone building on this
will hit them in the same order.

1. **`Circular reference detected in schema definitions: criterion -> criterion.`**
   `Criterion` is genuinely recursive, so the natural encoding is a `$defs.criterion` that
   `$ref`s itself. Self-referencing tool schemas are rejected outright. Fixed by inlining
   the tree to a bounded depth (3), which no real rule in the dataset exceeds.
2. **`Schema type 'oneOf' is not supported.`** Every branch became `anyOf`.
3. **`Too many optional parameters (239) ... limit: 24.`** `Criterion`'s optional `label`
   is optional on *every* node kind, and inlining multiplies it. Dropped from the
   extraction schema entirely -- which the design wanted anyway, since `docs/design.md`
   generates explanations by walking the evaluated tree precisely so they cannot go stale.
   A model-authored label would reintroduce exactly the hand-written prose that avoids.
4. **`Too many parameters with union types (54) ... limit: 16.`** Each nesting level is a
   union, and combinators embed a full copy of their child, so unions grow multiplicatively
   with depth. Only depth 1 fits under the limit -- far too shallow for real rules.

**The structural finding: a recursive expression language cannot be enforced by strict
structured output.** Constraints 3 and 4 are grammar-compilation limits of `strict: true`.
Dropping `strict` resolved both and the harness ran immediately. The schema still guides
the model; `schema-gate.ts` does the enforcing. That was always the design's real safety
net -- the strict flag was belt-and-braces, and it turns out the belt does not fit.

For the cost model: the inlined schema is **~79 KB of JSON on every request** (measured:
80,476 bytes serialized, `buildCriterionJsonSchema()` at depth 3). That is a non-trivial
input-token cost per call and Section 6 does not currently account for it. Prompt caching
is the obvious mitigation since the schema is identical across calls -- **implemented in
#43, see [Section 4.7](#47-prompt-caching-issue-43).**

**What was also measured, separately:** `scripts/llm-extraction/llm-extraction-eval.test.ts`
checks the harness itself -- every hand-authored "correct extraction" target is schema-valid
(ground truth held to the same bar as model output), every case is grounded in a real
citation, and the gate agrees with the production suite on the real dataset. (This file
moved from `tests/data/` to sit beside the code it tests; see its docblock.)

### 4.6 Hardening (issue #43)

Issue #43 closes the three gaps Section 4.4 explicitly left open: a held-out split, the
enum-slug fix, and prompt caching. The ordering mattered and was followed: **the held-out
split was built and frozen before the prompt was touched.**

**The eval set is now ~~33 cases~~ 41 cases (27 held-out after the #51 expansion),
`scripts/llm-extraction/eval-cases.ts`:**

| Split | Cases | Abstain | Extract | Tier 3 | Purpose |
|---|---|---|---|---|---|
| `tuning` | 14 | 8 | 6 | 8 | The nine #23 cases plus five; the enum-slug fix was designed against this. Fair game for iteration. |
| `heldout` | ~~19~~ **27** | ~~15~~ **21** | ~~4~~ **6** | ~~18~~ **25** | Fetched and frozen 2026-09-05, before any fix was written. Never inspected while tuning. Weighted hard toward Tier 3. The +8 are the #51 conditional-scope cases (six `abstain` traps, two `extract` controls). |

Every excerpt is real text fetched from the cited URL on the date in each case's
`fetchedOn` field, with a desktop-Chrome user agent (Section 1's finding -- WI state and
some nonprofit sites 403 a naive fetcher). Typographic punctuation is normalised to ASCII
to match the existing dataset; CFR sub-paragraph markers are de-spaced to how eCFR renders
them ("(c)(1)(i)"), and bulleted requirement lists are joined into running text with the
list stem kept; no wording is invented or paraphrased. The held-out set
leans on the genuinely hard corners: the SNAP deduction stack and ABAWD exemption tree
(7 CFR 273), WI DHS landing-page prose that names "eligibility" everywhere and a threshold
nowhere, the FoodShare public-charge paragraph, a Section 8 dollar table with no scale, a
CDA page that says residency is *not* required, and the WHEAP "Commitment to Community"
utility carve-out that no fact in `facts.ts` can decide. The #51 additions (frozen
2026-09-05, same rule, all `heldout`) target one specific failure -- a real threshold
carried out of a conditional branch with its scope dropped: Head Start's over-income
allowance (45 CFR 1302.12), Emergency Assistance's emergency gate, QMB's Medicare-entitlement
gate, the Homestead Credit's "one of the following conditions" list stem, BadgerCare Plus's
per-population FPL columns, and SeniorCare's cost-tier percentages that are not an
eligibility ceiling at all -- plus two controls (`wic-may-also-apply`,
`madcap-billholder-and-ami`) whose scope-flavoured qualifiers must *not* trigger an
abstention.

**The enum-slug fix (`scripts/llm-extraction/enum-vocab.ts`).** The system prompt now
carries a generated block listing every enum / enumSet fact and its exact slugs, each with
the display label the source is likely to use ("Section 8" -> `housing-choice-voucher`,
"food stamps"/"SNAP"/"FoodShare" -> `snap-foodshare`). Built from `FACTS` at call time so
it cannot list a stale value. The `set`/`compare` value schemas also point at that list.
The held-out split carries two `currentBenefits` extraction cases the prompt was never
tuned against -- `wic-adjunctive-eligibility` (WIC's adjunctive-eligibility program list)
and `schoolmeals-direct-certification` (DPI direct certification) -- each requiring the
model to collapse synonyms to one slug and drop programs with no slug rather than invent
one. That is where the fix has to be demonstrated, not on `madcap-categorical`.

~~**Measured result: `SKIPPED`.** No `ANTHROPIC_API_KEY` and no `ant` CLI credential were
available in the environment this issue was implemented in, exactly as in the original
spike.~~ **Superseded 2026-09-05 -- the held-out split has now been run live. See
"Measured: the held-out run" immediately below.** The harness reports `SKIPPED` rather than
fabricating a pass/fail when no key is present, and is runnable as:

```
npm run eval:llm-extraction                      # held-out split, fix + caching on
npm run eval:llm-extraction -- --split=all
npm run eval:llm-extraction -- --enum-vocab=off  # A/B the fix
npm run eval:llm-extraction -- --caching=off     # A/B caching cost
```

The four numbers -- **correct abstentions / dangerous over-claims / correct extractions /
gate failures** -- are printed per split, never blended. A single dangerous over-claim on
the held-out split trips a non-zero exit and is called out as **BLOCKING**, not reported as
a percentage.

#### Measured: the held-out run (2026-09-05)

> **Numbers superseded by the #51 re-measurement below** (larger held-out set, run
> 2026-09-05). The narrative -- one dangerous over-claim, a new failure class, the gate
> can't catch it -- stands unchanged and is what motivated #51.

Run against `claude-sonnet-5`, 19 held-out cases (15 abstain, 4 extract), enum-vocab on,
caching on. **The result is BLOCKING.**

| Metric | Held-out (19 cases) |
|---|---|
| Correct abstentions | ~~14 / 15~~ |
| **Dangerous over-claims** | ~~**1** -- BLOCKING~~ |
| Correct extractions | ~~3 / 4~~ |
| Gate failures | ~~**0**~~ |
| Over-cautious (abstained where extraction expected) | ~~1~~ |

**Two of the three things #43 set out to fix are confirmed fixed.** Gate failures went from
1-in-4 on the tuning set to **zero across 19 held-out cases**, including the two
`currentBenefits` cases (`wic-adjunctive-eligibility`, `schoolmeals-direct-certification`)
the prompt was never tuned against -- the enum-vocab block does what §4.6 claimed. Caching
saved **83% of input cost** (§4.7).

**The third thing is not fixed, and the held-out set is what caught it.** One dangerous
over-claim: `lifeline-survivor-extended`. The excerpt carries a genuine, extractable-looking
"200% of the Federal Poverty Guidelines" clause -- but that clause is *extended* eligibility
available only to survivors of domestic violence or trafficking, gated additionally on
"proof of an attempted line separation request" and "experiencing financial hardship." None
of the three gates is a fact in the vocabulary. The model emitted the income rule and
dropped the gates.

The consequence is concrete: general Lifeline eligibility is 135% FPL. A rule saying 200%
FPL, with the survivor condition silently discarded, tells someone between those thresholds
that they qualify when they do not. **This is a new failure class, not the one #23 found.**
`madcap-categorical` was a vocabulary mismatch the gate caught mechanically. This one is
semantically coherent, schema-valid, and passes every automated check -- the model correctly
read a real threshold out of a passage whose *scope* it failed to carry. No schema gate can
catch that, because nothing about the output is malformed.

**The nine-case tuning set never contained a conditional-scope trap.** Building the held-out
split found a failure the original spike's set structurally could not. That is the held-out
methodology earning its cost on the first run, and it is the strongest argument in this
document for having refused to tune against the small set. Tracked as issue #51 -- the
extractor is **not** cleared for the #14 ingestion path until it is resolved.

#### Re-measured with the #51 conditional-scope traps (2026-09-05) -- the pre-fix baseline

Issue #51 required the held-out set to grow with more conditional-scope cases **before**
any fix is designed, so the fix (option 2: a scope-carrying obligation in the output
contract) is measurable rather than anecdotal. Eight cases were added (six `abstain`
traps, two `extract` controls -- §4.3, §4.6 table above) and the held-out split was re-run
once against `claude-sonnet-5`, enum-vocab on, caching on. **No prompt change. This is the
pre-fix baseline: how often the current prompt drops conditional scope.**

| Metric | Held-out (27 cases: 21 abstain, 6 extract) |
|---|---|
| Correct abstentions | 18 / 21 |
| **Dangerous over-claims** | **3** -- BLOCKING |
| Correct extractions | 5 / 6 |
| Gate failures | **0** |
| Over-cautious (abstained where extraction expected) | 1 |

Run cost: **$0.48** total ($0.39 input + $0.09 output), **85%** saved on input by caching
(1,247,090 cache-read tokens against 11,547 fresh; the 99 KB schema re-read 27 times).

**The three dangerous over-claims:**

- `lifeline-survivor-extended` -- unchanged from the first run. The survivor-only 200%-FPL
  branch again lost its gates.
- `emergency-assistance-emergency-gate` (**new**) -- Wisconsin Emergency Assistance is
  "115% of the Federal Poverty Level" *and* "facing a setback due to an emergency"
  (homelessness, fire, disaster, domestic violence, energy crisis) *and* caring for a
  child under 18 *and* an asset test. The model emitted an `allOf` built on the income
  figure; the emergency predicate -- which no fact can decide -- was dropped. This is the
  Lifeline shape in a different program: a threshold lifted out of an
  emergency-conditioned branch.
- `seniorcare-coverage-levels-not-eligibility` (**new**) -- SeniorCare has **no income
  eligibility ceiling**. The 160% / 200% / 240% FPL figures are prescription cost-sharing
  tiers, and "Income more than 240% of the federal poverty level" is still an enrolled
  level (with a spenddown). The model read a tier boundary as an eligibility threshold and
  emitted an `allOf` -- inventing a cutoff the program does not have, and dropping the "65
  or older" gate. "A number in the source is not automatically an eligibility threshold"
  (the system prompt's own words) did not hold.

**What held.** Four of the six new traps abstained correctly:
`headstart-cfr-over-income-allowance` (did not take the 130% over-income allowance),
`qmb-fpl-gated-on-medicare` (carried the Medicare-entitlement gate),
`homestead-credit-one-of-conditions` (did not flatten the "$24,680" past its list-stem
conditions), and -- notably -- `badgercare-plus-population-columns`, where the scope lived
only in table column labels ("Pregnant people and children monthly income limit (306%
FPL)") and the model still abstained rather than emitting 306%. Both controls extracted
correctly: `wic-may-also-apply` and `madcap-billholder-and-ami` were not over-abstained on.

**Read honestly: the baseline is worse than the first run, and that is the point.**
Dangerous over-claims went from 1-in-19 to 3-in-27 -- because the set now contains cases
built to probe this failure, and two of them landed. The correct-abstention *rate* looks
similar (18/21 vs 14/15) but that number is not the headline; the count of dangerous
over-claims is, and it tripled. One case moved the other way between runs
(`schoolmeals-direct-certification`, a pre-existing case, abstained this time where it
extracted before) -- ordinary model non-determinism, not a regression, and a reminder that
single runs are noisy at this sample size. **The prompt was not iterated to improve any of
these numbers** -- doing so before the fix is designed would destroy the baseline (§4.4's
own argument). That work, and whether option 2 closes the gap without making the controls
abstain, is phase 2 of #51.

#### Phase 2 measured (2026-09-06): option 2 did not work

Option 2 -- a scope-carrying obligation requiring the model to enumerate every precondition
it saw as `encoded` / `dropped` / `undecidable`, with a dropped precondition outside a
`manualReview` treated as a gate failure -- was implemented and measured under the phase-2
discipline: tuned on the 14-case tuning split only, held-out run once, result reported as
returned. The prompt was **not** touched afterwards.

| Metric | Pre-fix baseline | Post-fix |
|---|---|---|
| Correct abstentions | 18 / 21 | 15 / 21 |
| **Dangerous over-claims** | **3** | **3** (a *different* three) |
| Correct extractions | 5 / 6 | **1 / 6** |
| Gate failures | 0 | **3** |
| Over-cautious | 1 | 4 |

**Safety unchanged, utility collapsed.** Both named controls broke, plus one malformed
output.

The three original targets *were* neutralised -- `lifeline-survivor-extended` and
`emergency-assistance-emergency-gate` abstained, and `seniorcare` / `qmb` emitted rules
whose dropped scope the model **listed**, so the gate caught them (a dangerous over-claim
converted into a gate failure is a real safety gain). Option 2 does what it promised **when
the gating clause is a prominent sentence or bullet.**

But three *new* dangerous over-claims appeared, and they share one property: the governing
scope is **implicit or structural** -- a table column header
(`badgercare-plus-population-columns`), a negation (`cda-residency-not-required`, where the
excerpt says residency is *not* required), a "notwithstanding" clause
(`snap-cfr-elderly-separate-household`). The model never perceived these as preconditions,
so they never entered the inventory, so the gate had nothing to check.

**That is the self-report hole predicted when option 2 was chosen** -- it catches
"noticed and discarded", never "never noticed" -- and with option 2 in place it becomes the
*dominant* failure mode rather than a residual one. Note also that the tuning split looked
clean (0 dangerous, 0 gate trips, 8/8 abstain across three runs) and could not have
predicted this: it contains no conditional-scope trap by design.

The implementing PR (#61) was **deliberately not merged** -- it made the extractor
measurably worse. It stays open as the record of a measured negative result. The finding
that mattered is recorded here: incremental patching of single-shot,
fixed-excerpt extraction was not converging, which is what motivated the re-approach in
issue #65 and the finding below.

#### The excerpt itself was the constraint (2026-09-06)

Every design measured in §4.4-§4.6 evaluated one task: **given a fixed, pre-cut,
prose-flattened excerpt, emit a `Criterion` in a single shot.** Re-reading the six dangerous
over-claims, every one is a **context-starvation failure**, not a comprehension failure --
SNAP's `notwithstanding paragraph (a)` where paragraph (a) was not in the excerpt;
BadgerCare's column header destroyed by flattening; SeniorCare's cost-sharing tiers
explained on the page but outside the excerpt.

A wizard-of-oz test gave four agents **only a source URL** -- no excerpt -- for exactly the
four cases that defeated every design above. **All four got them right**, refusing to encode
165% FPL as an eligibility ceiling, emitting no income criterion at all for SeniorCare,
keeping Lifeline's 200% survivor branch in `manualReview`, and reading BadgerCare's column
headers into a population-scoped rule. Every quoted span was verified verbatim against the
live pages.

**So the ~17% Tier-3 ceiling reported from these measurements is an artefact of the excerpt,
not a limit on capability.** See `docs/eligibility-extraction-framing.md` and
`docs/eligibility-extraction-tier3.md` for the two follow-on investigations, and issue #65
for the pipeline that replaced this approach.

### 4.7 Prompt caching (issue #43)

The request is assembled `tools` -> `system` -> `messages`. The ~79 KB schema tool and the
stable system prefix (base prompt + enum-vocab block, both byte-identical across calls) now
carry `cache_control: {type: "ephemeral"}`; only the per-case excerpt in `messages` varies,
after the breakpoints. `run-eval.ts` accumulates `usage.cache_creation_input_tokens` /
`cache_read_input_tokens` / `input_tokens` and prints, at the end of a run:

- the actual input-token cost with caching on, and
- the counterfactual cost if every cache-read token had been a full-price fresh input
  token (i.e. caching off),

priced at Section 6.1's dated Sonnet 5 rates ($2.00 / MTok input, $2.50 cache write, $0.20
cache read). ~~**Not measured live** (same `SKIPPED` as 4.6).~~ **Measured 2026-09-05, on
the same held-out run as §4.6:**

| | 19 calls, caching on |
|---|---|
| Fresh input tokens | 7,706 |
| Cache **write** tokens | 47,965 |
| Cache **read** tokens | 863,370 |
| Output tokens | 5,517 |
| Input cost, caching **on** | **$0.308** |
| Input cost, counterfactual **off** | $1.838 |
| **Saved** | **$1.530 (83%)** |
| Total run cost (input + output) | $0.363 |

The predicted shape held: 83% measured against the ~85% estimated. Note the schema measures
**99 KB** once the enum-vocab block is included, not the ~79 KB §4.5 recorded for the bare
schema -- the enum listing is not free, and it is on every call.

Two corrections this run makes to the numbers above and in §6:

- **Cache reads dominate everything.** 863,370 cache-read tokens against 7,706 fresh input
  is a 112:1 ratio. Effectively the entire input bill is the same schema re-read 19 times.
- **§6.4's steady-state model is now measurable rather than structural**, at least on the
  cost axis: at $0.019/case all-in, the re-extraction cost of a Tier-3 corpus is not the
  constraint at any scale this project will reach. §6.5's reviewer-throughput argument is
  unaffected and remains the real one.

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
| Tokens per page (excerpt + system prompt + schema + tool-use overhead) | ~~~3,000 input~~ **~25,000 input** / ~600 output | ~~Typical excerpt length ... plus schema/prompt overhead~~ **Corrected per #43: the inlined schema alone is ~79 KB (~23K tokens, rough); the "~3,000" figure omitted it entirely. See the caching correction below.** Still not a measured average. |
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

**Correction (#43), and why the conclusion holds anyway.** The `~3,000 input` figure above
left out the ~79 KB / ~23K-token inlined schema that rides on *every* request (Section 4.5,
4.7). At ~25K input tokens/page the honest current-scale number is closer to 7 × (25,000 ×
$2.00 + 600 × $10.00) / 1e6 × 1.3 ≈ **$0.51** non-batch (Sonnet 5), and regional-expansion
≈ **$10** -- about 6x the old estimate. Prompt caching on the schema (implemented in #43)
brings the marginal per-page schema cost back down by roughly 85% once the cache is warm,
so a warm-cache batch run lands near the original figures. The section's headline is
unchanged: even at 6x, and even uncached, initial extraction is a sub-$15 API bill at every
scale modeled here, and reviewer-minutes (Section 6.5) remain the real constraint. These
are still estimates, not `usage`-measured numbers -- #43 could not run live either.

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

0. ~~**The LLM path is measured on the tuning set, encouraging but thin; the held-out
   measurement is built and still unrun.**~~ **The held-out split has now been run, and it
   is BLOCKING (#51).** Abstention rate -- not extraction accuracy -- is
   the headline metric, and against the nine-case tuning set it is **5/5 correct
   abstentions with 0 dangerous over-claims, stable across three runs** (Section 4.4,
   issue #23). The one failure was the schema gate catching a slug-vs-display-name mismatch
   before it reached a human -- the safety net working, not a model inventing a threshold.
   Issue #43 then did what Section 4.4 said the real pipeline had to: built a ~~33-case~~
   33-case set (**41 after the #51 expansion below**)
   with a **frozen held-out split** (~~19 cases~~ **27**, Tier-3-weighted), applied the
   enum-slug fix (valid slugs now listed in the prompt), and added prompt caching on the
   ~79 KB schema (Section 4.6-4.7). ~~But #43 had no API key either, so the held-out run is
   **`SKIPPED`**.~~ **The held-out split was run live on 2026-09-05 and the answer is
   BLOCKING** (Section 4.6). Two of the three fixes landed: **zero gate failures across
   ~~19~~ 27 held-out cases** (the enum-slug fix works, demonstrated on cases the prompt
   never saw) and an **~~83%~~ 85% input-cost saving** from caching. But dangerous
   over-claims -- first `lifeline-survivor-extended`, where a real 200%-FPL threshold was
   lifted out of a survivor-only extended-eligibility branch with all three gating
   conditions dropped; then, once #51 grew the held-out set with eight conditional-scope
   cases (six `abstain` traps, two `extract` controls) built *before* any fix, **3
   dangerous over-claims in 27** -- `lifeline-survivor-extended` plus Emergency Assistance
   (income figure, emergency gate dropped) and SeniorCare (cost-sharing tier read as an
   eligibility ceiling that does not exist). That is the pre-fix baseline (Section 4.6).

   **That failure is a different class from #23's and the more troubling one.**
   `madcap-categorical` was mechanically malformed, so the gate caught it. This output is
   schema-valid and semantically coherent; the model read a real number out of a passage
   whose *scope* it failed to carry, and no schema gate can detect that. The nine-case
   tuning set contained no conditional-scope trap and structurally could not have found it
   -- the held-out methodology earned its cost on its first run.

   **Do not treat the LLM path as validated, and do not wire it into #14's eligibility
   path, until #51 is resolved.** Note also that making the harness run at all required
   dropping `strict: true` -- a recursive expression language cannot be enforced by strict
   structured output (Section 4.5).
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
