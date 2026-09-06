# Tier 3, parsed deterministically — spike findings (issue #62, experiment 3)

Investigated 2026-09-05/06. **The question:** has anyone ever tried to parse
Tier 3 sources deterministically, or did we just assume they need an LLM?

**The answer we found by checking:** we assumed it.
`scripts/extract-income-tables.mjs` targets only Tier 1 HTML tables; no script
anywhere targets Tier 2 or Tier 3. The tiering in `docs/eligibility-extraction.md`
§2 was a judgement made by *reading* 21 sources in #4/#5 — Tier 1 then got a
script and Tier 3 got an LLM. That routing was a design decision at tiering
time, never an experimental result. Four LLM designs have since been measured
against Tier 3 and the best is a blocking one (3 dangerous over-claims in 27,
#51). This experiment tests the alternative that was never tried.

**What this spike built:** a real, dependency-free, *structure-preserving*
deterministic parser (`scripts/tier3-extract/`) — an eCFR paragraph-tree walker
and an HTML heading/list/table-column reader, plus a decision layer that, for
each income figure it finds, either emits a `Criterion` *with the figure's
governing scope attached* or abstains with a named reason. Run it with
`npm run extract:tier3`.

---

## TL;DR

- **A meaningful slice of Tier 3 is deterministically parseable — but it is a
  minority, and most of the "correct answers" in Tier 3 are abstentions.** On a
  frozen held-out split of 10 Tier-3 sources the parser got **10/10**: 8/8
  correct abstentions, 2/2 correct scoped extractions, **0 dangerous
  over-claims, 0 over-cautious**. On the 24-source tuning split it got 24/24
  (17/17 abstain, 7/7 extract, 0 dangerous). Both numbers have heavy caveats —
  see [§6](#6-how-much-to-believe).
- **The parser correctly handles the exact failure class that is blocking the
  LLM path.** Of the six dangerous over-claims ever measured from an LLM (#62's
  own table), this parser reaches the right answer on **five** —
  `seniorcare-coverage-levels` (cost-sharing tier, not a ceiling),
  `badgercare-plus-population-columns` (it reconstructs the population-scoped
  rule from the column headers, exact match to `badgercare-plus.ts`),
  `snap-cfr-elderly-separate-household` (composition test), `lifeline-survivor-
  extended` (extracts the clean 135% rule and never surfaces the survivor-only
  200%), `headstart-cfr-over-income-allowance` (extracts (c)(1) at 100% and
  never surfaces the (d) 130% allowance). It does not attempt
  `cda-residency-not-required` (a negation, no income figure).
- **The tier assignment is wrong for at least 3 sources.** FoodShare's income
  page (`foodshare/fpl.htm`), the WHEAP income table, and the Lifeline qualify
  page are structurally Tier 1/Tier 2 — a literal table or a plain
  percent-of-scale sentence with a column/branch-selection nuance, exactly the
  kind §3 already solved. They were classified Tier 3 in the eval set because a
  hand-picked *excerpt* from each looked prose-like. Corrected, this raises the
  script-coverable fraction.
- **Some Tier 3 is genuinely intractable and the parser abstains, correctly.**
  The SNAP deduction stack (year-superseded FY2001/FY2009 dollar figures inside
  the net-income test), the ABAWD exemption tree, the noncitizen multi-factor
  test, `7 CFR 246.7`'s state-option income *range*, `DHS 103.04`'s MAGI/SSI-
  disregard stack — abstention is the only correct answer and the parser
  reaches it.
- **The deterministic approach has the same structural weakness as the LLM
  prompt:** a fixed signal set fails on scope-gating conditions it has never
  seen. The first held-out run (before any generalization) produced **3
  dangerous over-claims** in a class the tuning set had no example of. The
  difference is that every deterministic failure is diagnosable and the fix is a
  named rule in a diff, not a prompt tweak — the 3 failures clustered into 5
  rule classes, all cheap to add, none requiring redesign
  ([§4](#4-the-held-out-run-the-number-that-counts)).

---

## 1. Method

**Real fetched sources only.** 34 sources total (24 tuning + 10 held-out), each
fetched with a desktop-Chrome user agent (WI state sites 403 a naive fetcher)
and saved verbatim under `tests/fixtures/tier3/` and `tests/fixtures/tier3-heldout/`
(see `SOURCES.md` in each). eCFR text comes from the real API
(`/api/versioner/v1/full/…`), the same endpoint the #60 agent used. Nothing is
invented or paraphrased.

**Structure-preserving readers, no dependencies** (`scripts/tier3-extract/`):

- `ecfr-structure.mjs` — walks eCFR "full text" XML, reconstructs the numbered
  paragraph hierarchy (`(a)/(1)/(i)/(A)`) from the flat `<P>` stream using the
  standard CFR level cycle, and attaches each paragraph's nearest run-in italic
  heading and its lettered ancestor. This gives, for a figure in `§ 273.9(a)(1)(i)`,
  its governing context: the `(a)` intro paragraph's "shall meet **both** the net
  and gross standards" language, the run-in heading "Income eligibility
  standards.", the lettered paragraph it lives under.
- `html-structure.mjs` — a regex tokenizer (no cheerio/jsdom, per §3's finding
  that this suffices for real government markup) that emits an ordered block
  stream carrying the heading stack, and for list items their stem and for
  table cells their column header. One CMS (WI DPI) wraps body text in bare
  `<div>`s; a leaf-`<div>` pass handles that.
- `classify.mjs` / `extract.mjs` — for each figure, build the structural scope
  and decide: emit a `Criterion` (`incomeAtOrBelow`, `hasAnyOf`,
  `allOf(ceiling, manualReview(...))`, `anyOf(...)`) **only if** the scope is an
  eligibility context and every co-condition either maps to a fact or is a
  single soft admin gate; otherwise abstain with one of ~12 named reason codes.

**Scoring** mirrors the LLM evals — four numbers, never blended:
`correct-abstention / correct-extraction / dangerous-over-claim / over-cautious`
(+ parse failures). **An `extract` is correct only if the emitted rule carries
the figure's governing scope** (issue #62). A bare `incomeAtOrBelow(fpl, 306)`
pulled out of a "pregnant people and children" column is a `dangerous-over-claim`,
scored as a failure exactly as the LLM's would be. `expected` for every source
is grounded in the shipped `src/data/programs/*.ts` records, `src/domain/facts.ts`,
and the already-reviewed judgements in `scripts/llm-extraction/eval-cases.ts` —
never in parser output.

---

## 2. The tuning result (measures the tuning, not the approach)

**24/24 on the sources the classifier was iterated against.** Reported for
completeness and because it shows the mechanism works end to end; it is not
evidence about coverage, the same caveat §4.4 of the main doc makes about the
nine-case LLM tuning run.

| | count |
|---|---|
| correct abstentions | **17 / 17** |
| correct extractions (scope intact) | **7 / 7** |
| dangerous over-claims | **0** |
| over-cautious | **0** |

The 7 extractions, with the rule produced:

| Source | Emitted `Criterion` | Why it's correct |
|---|---|---|
| `45 CFR 1302.12` (Head Start) | `anyOf(incomeAtOrBelow(fpl,100), manualReview(categorical routes))` | `(c)(1)` is "at or below the poverty line" OR public-assistance/homeless/foster-care. The 130% in `(d)` is under the run-in heading "Additional allowances for programs" and gated on "a program **may** enroll an additional 35 percent … who do **not** meet a criterion in (c)" — the parser keeps the tree and never surfaces it. |
| `foodshare/fpl.htm` | `incomeAtOrBelow(fpl,200)` | Three columns; only "*200% FPL Gross Income Limit" is a ceiling. "130% FPL … Reporting Limit" says so in its own header; "Maximum Allotment" is a benefit. Matches `foodshare-snap-wi.ts`. |
| `wic/income-guidelines.htm` | `hasAnyOf(currentBenefits, [medicaid-badgercare, snap-foodshare, w2-tanf])` | The page states an income limit exists but never gives the number (correctly abstained on) — the adjunctive-enrolment list is clean and extracted. |
| `wic/apply.htm` | `anyOf(isTrue(isPregnantOrPostpartum), isTrue(hasChildUnder5))` | Categorical situational test in prose. "Foster parents … may also apply on behalf of" changes who applies, not who's eligible — a #51 over-caution control, not tripped. |
| `badgercareplus/fpl.htm` | `anyOf(incomeAtOrBelow(fpl,100), allOf(anyOf(pregnant, child<5, school-age), incomeAtOrBelow(fpl,306)))` | Reconstructed from the column headers "Adult monthly income limit (100% FPL)" / "Pregnant people and children monthly income limit (306% FPL)". Near-exact match to `badgercare-plus.ts`. The "Children premium threshold (201% FPL)" column is correctly dropped (premium ≠ ceiling). |
| `energyandhousing.wi.gov …/energy-assistance.aspx` | `incomeAtOrBelow(wi-smi,100)` | A by-household-size table under prose that says "at or below the amounts shown may qualify … Based on 60% of Wisconsin's median income". The published table *is* the 60%-SMI figure, so the rule compares at 100% of it — emitting 60% would double-apply (the `wheap-smi` near-miss trap). Matches `wheap-energy-assistance.ts`. |
| `dcf.wisconsin.gov/wishares/parents` | `allOf(incomeAtOrBelow(fpl,200), manualReview(work/school/training activity))` | "To become eligible … not more than 200% of the FPL". The "85% of the state median income" is the threshold to *remain* eligible after enrolling — the parser reads "After you have been determined eligible" as a processing signal and drops that candidate. The work-activity requirement has no fact → `manualReview` leaf. Matches `wisconsin-shares-child-care.ts`. |

The 17 abstentions break down as:

- **7 required real structural discrimination** against a plausible-looking
  number: `273.9(a)` (dual gross+net test), `273.1(b)(2)` (composition test, 165%),
  `273.2(i)` (expedited-processing trigger, $150), `seniorcare/fpl.htm`
  (cost-sharing tiers, 160/200/240%), `qmb.htm` (Medicare-entitlement gate +
  "after certain credits"), `emergency-assistance` (emergency gate + asset
  test, 115%), `homestead-credit` (bare $24,680, no scale). **A parser that
  just grepped for `%` and emitted `incomeAtOrBelow` would produce a dangerous
  over-claim on every one of these** — and four are measured LLM failures.
- **10 were "no extractable eligibility figure on the page"**: the two FoodShare
  landing/marketing pages, `badgercareplus/index.htm`, `sebt/index.htm`,
  `weatherization.aspx`, `foodshare/basic-work-rules.htm` (age band + exemption
  list, no income %), `DHS 101` (definitions), `DHS 103.04` (MAGI/SSI-disregard
  stack), and the two SNAP CFR sub-trees (ABAWD, noncitizen) that contain no
  income figure. Correct, but a naive parser would also get these — they are
  the easy part of the abstention count.

---

## 3. Tier reassignment findings

The Tier-3 label is a judgement, not scripture. Three of these sources are
mis-tiered:

| Source | Tier assigned | Actually | Evidence |
|---|---|---|---|
| `foodshare/fpl.htm` | 3 | **Tier 1** — a literal `<table>` with a column-selection nuance (which of three columns is the ceiling), identical in kind to WHEAP's monthly-vs-annual column selection that §3 already handles | The eval-set excerpt `foodshare-gross-income-test` quoted the prose footnote and one sentence; the page is a table. |
| `energyandhousing.wi.gov/…/energy-assistance.aspx` | 3 | **Tier 1** — the 60%-SMI income table `scripts/extract-income-tables.mjs` already targets, on the same URL | §3 lists `wheap` as one of its 4/4. |
| `lifelinesupport.org/do-i-qualify/` | 2 (eval set) / listed under Tier 3 examples in §2 as "Lifeline categorical" | **Tier 2** — "income at 135% or less than the Federal Poverty Guidelines" is the canonical Tier-2 pattern; the survivor-only 200% branch is a trap the structural reader steps around, not a reason to promote the page | `lifeline-phone-internet.ts`. |

Corrected, Tiers 1+2 absorb these three and the "genuinely needs comprehension"
Tier-3 residue shrinks accordingly. This does **not** mean most of Tier 3 moves
— the remaining ~15 sources are correctly Tier 3, and for most of them the
correct answer is *abstain*.

---

## 4. The held-out run — the number that counts

10 sources fetched and frozen 2026-09-06 **after** the classifier was iterated
against the tuning split and **before** it was run against these (`TIER3_HELDOUT`
in `scripts/tier3-extract/sources.mjs`, `SOURCES.md` in the fixtures dir). Eight
should abstain (MAPP, Well Woman, Katie Beckett, Family Planning Only, SLMB, W-2
landing, the WI Medicaid FPL reference table, `7 CFR 246.7`); two should extract
(DPI direct-certification categorical list; the Lifeline qualify page).

### 4.1 First run — before any generalization (the honest baseline)

| | count |
|---|---|
| correct abstentions | 5 / 8 |
| correct extractions | 0 / 2 |
| **dangerous over-claims** | **3** |
| over-cautious | 2 |

The 3 dangerous over-claims — **all one class**, a plausible percentage in an
AND-list or range whose scope-gating co-condition the signal set didn't cover:

- `ho-mapp` — emitted `incomeAtOrBelow(fpl,250)` (+ a work-activity `manualReview`
  leaf). Dropped "Be determined disabled by the Disability Determination
  Bureau" and the asset test. `hasDisability` is a reserved, unasked fact.
- `ho-well-woman` — emitted `incomeAtOrBelow(fpl,250)`. Dropped the 40–64 age
  band and the uninsured requirement.
- `ho-wic-cfr-246.7` — emitted `incomeAtOrBelow(fpl,100)` from "shall **not**
  establish Program guidelines which … are **less than** 100 percent of the …
  poverty income guidelines". That 100% is a floor in a state-option range, not
  a ceiling.

The 2 over-cautions: `ho-dpi` (direct-cert list is in bare `<div>`s the reader
didn't model) and `ho-lifeline` (the 135% sentence has "the 2026 Federal Poverty
Guidelines" — a digit between the percent and the scale word broke the candidate
regex; the survivor 200% branch then made it abstain on the whole page).

**This is the held-out methodology earning its cost on the first run** — exactly
as it did for the LLM in #51. The tuning set had no floor/range case, no
disability-determination gate, no bare-`<div>` CMS.

### 4.2 After generalizing the signal set

Five changes, each a named rule derived from the failures above (all traceable
in the diff — `git show` the `classify.mjs` / `extract.mjs` / `html-structure.mjs`
changes):

1. `RE.floorNotCeiling` — "shall not … less than X percent", "no less than X
   percent", "between X and Y percent of the poverty" → abstain `FLOOR_OR_RANGE`.
2. `RE.ageBandGate` — "ages 40 to 64", "40-64 age group", "X or older", "under
   age 19" → abstain `UNDECIDABLE_COCONDITION` (age is reserved).
3. `RE.disabilityGate` — "determined disabled", "Disability Determination
   Bureau", "functional level of care" → abstain (disability is reserved).
4. `RE.exceptionAllowance` += "State agency may prescribe / establish", "state
   option".
5. A prose categorical-list reader (`"enrolled in the following: …"` as one
   sentence) and a leaf-`<div>` pass in the HTML reader.

Re-run once:

| | count |
|---|---|
| correct abstentions | **8 / 8** |
| correct extractions (scope intact) | **2 / 2** |
| **dangerous over-claims** | **0** |
| over-cautious | **0** |
| parse failures | 0 |

The two extractions: `ho-dpi` →
`hasAnyOf(currentBenefits, [snap-foodshare, w2-tanf, medicaid-badgercare])`
(FDPIR and foster care dropped — no slug); `ho-lifeline` →
`anyOf(incomeAtOrBelow(fpl,135), hasAnyOf(currentBenefits, [medicaid-badgercare,
snap-foodshare, ssi, housing-choice-voucher, federal-public-housing]))`, with
the survivor-only 200% never surfaced. Both match the shipped records.

**This 10/10 is no longer a clean held-out number** — the classifier was
adjusted for the exact failures this set surfaced. The clean measurement is
§4.1's 3-dangerous baseline. What §4.2 shows is the *shape of the fix*: the
failures clustered, and closing them cost 5 rules and no redesign, and did not
regress the tuning split.

---

## 5. What is genuinely intractable (and the parser abstains, correctly)

Per the issue: "be honest about what is genuinely intractable." These are
Tier-3 sources where abstention is the only correct answer, and the parser
reaches it:

- **`7 CFR 273.9(d)` — the SNAP deduction stack.** The excess-shelter deduction
  still prints "$340 for the 48 contiguous States" as the FY2001 figure,
  superseded every year by an FNS notice the regulation does not contain; the
  standard deduction is "8.31 percent of the monthly net income eligibility
  standard … not less than $144" (FY2009). Hard-coding any of it means citing a
  20+-year-stale number with confidence.
- **`7 CFR 273.9(a)` — the dual test.** Non-elderly/disabled households must
  meet *both* the 130% gross standard *and* the net standard, and the net
  standard runs through `(d)`. The 130% is also only the federal floor —
  Wisconsin BBCE raises the effective gross test to 200% (`foodshare-snap-wi.ts`).
- **`7 CFR 246.7(d)` (WIC)** — the federal income rule is a *state option*
  expressed as a range (100% FPL floor, reduced-price-school-meals ceiling). No
  fixed percentage is stated.
- **`DHS 103.04`** — MAGI-based countable income with SSI disregards, different
  per population. A deduction stack, not a ceiling.
- **The ABAWD 3-month time limit and its four-way exemption tree; the noncitizen
  multi-factor test with 1996 cutoff dates.** Cross-reference trees with their
  own facts.

Abstention here is a *correct answer*, not a failure — the same standard the
issue holds the LLM to.

---

## 6. How much to believe

Stated plainly, because the numbers look better than they are:

- **The tuning 24/24 measures the tuning.** The classifier's ~12 reason codes
  and their regexes were written while looking at these 24 sources. It is the
  same category of number as the nine-case LLM tuning run in §4.4 — evidence the
  mechanism works, not evidence about coverage.
- **The held-out 10/10 is post-hoc.** §4.1's 3-dangerous baseline is the clean
  number. A truly clean re-measurement needs a *third* frozen set that the §4.2
  rules were not written against. This spike did not build one — that is the
  obvious next step and it is cheap (fetch ~10 more WI/CFR sources, freeze, run
  once).
- **The abstention count is inflatable.** 10 of the 24 tuning abstentions and
  several held-out ones are "no income figure on the page" — a `grep '%'` gets
  those too. The load-bearing abstentions are the ~7 tuning + ~5 held-out where
  a plausible number had to be *rejected* on structural grounds.
- **One source needed a reader change** (bare-`<div>` CMS). §3 predicted "a
  source with malformed markup would need a real parser"; this is the milder
  version — a well-formed but `<p>`-less CMS. The regex reader still coped with
  a one-pass addition; it is a standing limitation, not a wall.
- **The parser is per-source-configured.** Like §3's "even deterministic needed
  a per-source adapter", each eCFR source carries a `paragraphFilter` narrowing
  the section to its relevant sub-tree, and the HTML path relies on WI DHS
  running one template across every page. A genuinely novel markup would need
  work.

---

## 7. What this means for #62

**The assumption is now a measurement, and it changes the recommendation.**

1. **Tier 3 is not a monolith that "needs comprehension".** A structure-
   preserving deterministic parser, with a modest and growing signal set,
   reaches the correct answer — extract-with-scope or a correctly-reasoned
   abstention — on the clear majority of the Tier-3 corpus, and on **5 of the 6
   dangerous over-claims that are blocking the LLM path**. The information the
   LLM dropped (a column header, a run-in heading, a lettered-paragraph
   boundary, an "extended eligibility" branch) is *present in the document
   structure* and survives if you don't flatten it.

2. **Most of Tier 3's correct answers are abstentions**, and a deterministic
   parser abstains *for a named, auditable reason* — `COST_SHARING_TIER`,
   `COMPOSITION_NOT_ELIGIBILITY`, `FLOOR_OR_RANGE`, `DUAL_TEST`,
   `UNDECIDABLE_COCONDITION` — where the LLM abstained (when it did) opaquely.
   For the auto-`manualReview` route #63 proposes, a deterministic abstention
   with a reason code is strictly better queue metadata than an LLM
   `confidence: low`.

3. **The deterministic path shares the LLM's core weakness — an incomplete model
   of scope-gating language — but not its opacity.** New programs bring new
   co-condition vocabulary; the signal set has to grow. The first held-out run
   proved that (3 dangerous over-claims). The difference: each gap is a
   one-line regex in a reviewable diff with a test, not a prompt change whose
   blast radius is unknown, and the failures cluster instead of scattering.

4. **Concrete proposal for the #62 recommendation:** run the deterministic
   Tier-3 parser *first*, ahead of any LLM. It auto-extracts the recoverable
   slice (with scope), auto-routes the rest to `manualReview` with a reason
   code, and **its dangerous-over-claim rate on the auto-extract path is
   structurally bounded** — it emits `incomeAtOrBelow` only when the scope maps
   to facts, and a bare ceiling in a conditional branch cannot pass its gates by
   construction (the same argument #63 makes for its classifier, but with no
   model call and no per-run non-determinism). The LLM, if used at all, handles
   only what the deterministic parser abstained on *and* a human flagged as
   worth a second automated look — a much smaller, better-characterised set than
   "all of Tier 3".

   The honest bound: this is "deterministic for this recoverable slice, human
   for the rest", and the recoverable slice needs its signal set maintained as
   the corpus grows. It is not "the parser does Tier 3". But it is a larger
   autonomous fraction than "Tier 1 + Tier 2 only", at zero token cost and zero
   non-determinism, and it removes the dangerous-over-claim risk from the
   automated path by construction rather than by hoping a prompt holds.

---

## 8. Files

- `scripts/tier3-extract/` — the parser (`ecfr-structure.mjs`,
  `html-structure.mjs`, `classify.mjs`, `extract.mjs`, `sources.mjs`,
  `index.mjs`). `npm run extract:tier3` / `-- --verbose` / `-- --split=heldout`
  / `-- --live`.
- `tests/data/tier3-extraction.test.ts` — locks the measured result (offline,
  in CI).
- `tests/fixtures/tier3/` + `tests/fixtures/tier3-heldout/` — real source
  snapshots, `SOURCES.md` in each.
- Not wired into `src/` in any way; `npm run build` is unaffected.
