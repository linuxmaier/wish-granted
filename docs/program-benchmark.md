# Program-level extraction benchmark (issue #66)

The foundational measuring stick for epic #65. Every other part of that epic --
the deterministic path, triage (#68), agentic extraction (#67) -- is scored by
this harness. It lives in `scripts/program-benchmark/`.

**The unit of work is a program, not an excerpt.** Given a source URL, an
extractor produces a `Program` record or abstains. The ground truth is the 16
hand-verified records in `src/data/programs/` (#2, #40) -- authored by people who
read those pages. The 27-/41-case excerpt set (`scripts/llm-extraction/eval-cases.ts`)
is demoted to a narrow-skill regression check; see
`docs/eligibility-extraction.md` Section 4.3 and #65 for why.

**This harness never calls a model.** Live runs cost tokens and are performed
separately by the coordinator. Without an `ANTHROPIC_API_KEY` every case that
needs the model reports `SKIPPED`, never a fabricated result -- the same
convention as `scripts/llm-extraction/run-eval.ts` (#5 §4.3, #63). The scoring
logic is unit-tested offline against hand-written fixture pairs
(`scripts/program-benchmark/lib/__tests__/`), so it can be trusted before a
single token is spent.

---

## How equivalence is judged -- and where it is wrong

This is the load-bearing design decision. Getting `phone` wrong is a nuisance;
getting `eligibility` wrong tells a family in crisis they do not qualify when
they do. So the benchmark has to decide, for a candidate `Criterion` tree,
whether it **means the same rule** as the verified one -- and equivalence here is
*semantic*, not structural. `allOf(a, b)` equals `allOf(b, a)`; a rule has many
faithful encodings; a naive structural diff would mark a working extractor
broken.

The check has two layers, tried in order (`lib/criterion-equivalence.ts`).

### Layer 1: normalise, then compare (`lib/criterion-normalize.ts`)

Both trees are canonicalised and their canonical forms compared byte-for-byte.
Canonicalisation:

1. **Drops `label`.** Cosmetic; the engine regenerates explanations by walking
   the evaluated tree. Extraction never emits one.
2. **Negation normal form.** `not` is pushed to the leaves by three-valued
   De Morgan: `not(allOf(a,b)) -> anyOf(not a, not b)`, `not(not(x)) -> x`. This
   is sound under Kleene logic, not just two-valued -- `not` swaps true/false and
   fixes unknown, and min/max distribute over that.
3. **Folds `not` into a leaf operator** where an exact dual exists:
   `not(compare eq) <-> compare neq`, `lt <-> gte`, `lte <-> gt`,
   `set in <-> set notIn`, `set includesAny <-> set excludes`.
   `set includesAll` has no single-operator dual and keeps its `not` wrapper.
4. **Flattens** nested same-kind combinators: `allOf(a, allOf(b,c)) -> allOf(a,b,c)`.
5. **Drops identity elements.** `always` in `allOf` is removed; `always` in
   `anyOf` collapses the whole node to `always`.
6. **Sorts and de-dupes** the operands of `allOf`/`anyOf` by a stable key.
7. **Unwraps singletons:** `allOf(x) -> x`.
8. **Canonicalises leaves.** `set` values are sorted and de-duped; a boolean
   `compare(fact, neq, false)` becomes `compare(fact, eq, true)`, using the
   fact's declared type from `FACTS`.

This layer is total and never wrong in the "said equivalent when they weren't"
direction. Geography shorthands (`livesIn.daneCounty` is
`allOf(is('state','WI'), is('county','dane'))`) fall out for free -- they are
just nested `allOf`s that flatten.

### Layer 2: bounded three-valued model check

When canonical forms differ, the two trees are evaluated under Kleene (strong
three-valued) logic -- the same true / false / unknown the real rules engine
uses (`docs/design.md`, "Three-valued logic") -- over **every** combination of
leaf truth values. If they agree on all of them, they are equivalent.

This catches equivalences canonicalisation misses: absorption
(`anyOf(a, allOf(a,b)) == a`), distribution
(`allOf(a, anyOf(b,c)) == anyOf(allOf(a,b), allOf(a,c))`), and a rule
re-expressed with a different combinator shape.

Leaf abstraction:

- each distinct non-income leaf becomes a variable over {true, false, unknown};
- each `incomeAtOrBelow` **scale** becomes one ordered variable capturing where
  the household's income sits relative to that scale's thresholds, plus an
  "unknown" state -- so `incomeAtOrBelow(s, 100)` and `incomeAtOrBelow(s, 200)`
  are correctly linked (income at or below 100% is also at or below 200%);
- `manualReview` is constant unknown; `always` is constant true.

The enumeration is skipped -- verdict **`undecided`**, reported honestly, never
silently treated as a match or a mismatch -- when the state space exceeds 50,000,
or when a leaf cannot be modelled (a numeric `compare` against a fact that also
appears with a different operator or bound; we do not build an interval solver).

### Where the equivalence check produces a FALSE MISMATCH

Stated plainly, because discovering these later is worse:

- **Absorption / distribution behind an un-modellable leaf.** Layer 2 is what
  recovers these; when it goes `undecided` (a multi-bound numeric `compare`, or a
  state space blow-up) the pair falls back to canonical-form equality only, and a
  faithful re-encoding is scored `divergent`.
- **Threshold arithmetic.** `compare(age, gte, 60)` and `compare(age, gt, 59)`
  are equal over integers. Canonicalisation keeps them distinct and Layer 2
  treats them as one variable each (they never appear together in the dataset).
- **Cross-scale identities.** `incomeAtOrBelow('wi-smi', 60)` against a table
  that is *already* 60%-of-SMI is, for this dataset, the same household set as
  `incomeAtOrBelow('wi-smi', 100)` (this is the real `wheap-smi` trap). The
  harness cannot know that and calls it a mismatch. Two `incomeAtOrBelow` nodes
  on *different* scales are independent variables even when a real-world identity
  links them.
- **`oneOf` vs `hasAnyOf` on the same values.** `set in` (a scalar-enum
  membership test) and `set includesAny` (a multi-select overlap test) get
  different leaf keys. For a fact where the two happen to coincide, that is a
  false mismatch -- but they are genuinely different predicates, so this is a
  deliberate call.
- **`manualReview` note text.** Dropped from the comparison key. Two abstention
  leaves with different prose are "the same" structurally; the accuracy of the
  note is not scored.
- **Soundness caveat on Layer 2.** The model check proves equivalence over the
  *abstracted* variables. If the abstraction lost a real constraint between
  leaves, a "proven equivalent" could in principle be wrong. The abstraction
  only loses constraints for numeric `compare` on a shared fact -- exactly the
  case already forced to `undecided` -- so in practice this does not bite, but it
  is the reason `undecided` exists rather than a guess.

---

## Five scores, never one

A `Program` record's fields have wildly different stakes, so the benchmark
**never emits a single blended score.** `lib/score.ts` produces five, separately:

### 1. Coverage

What fraction of programs produced any usable output at all -- a schema-gate-valid
record, or an honest whole-record abstention (which is a correct answer, not a
failure). Gate failures and extractor errors do not count.

### 2. Eligibility correctness

`equivalent` / `divergent` / `undecided` per the equivalence check above, plus a
count of how the verdict was reached (`canonical-form` vs `model-check`) so a
reader can see how much work the semantic layer is doing.

### 3. Dangerous wrongness -- reported on its own, never averaged into anything

A candidate rule is **dangerous** when it is *narrower than reality*: it rules
out an applicant the verified record accepts or leaves open. The asymmetry that
governs this whole project (#5 §4.4): wrongly excluding someone is far worse than
wrongly including them, because an over-inclusive result sends a person to check
with the agency, while an under-inclusive one silently tells them not to bother.

Three detectors (`lib/dangerous.ts`), each reported with its source:

- **`model-check`** -- Layer 2 found a concrete applicant profile the candidate
  rules out (`F`) and the verified rule accepts (`T`) or flags for review (`U`).
  Strongest evidence. Only available when the leaves are modellable.
- **`abstention-replaced`** -- the verified record carries a `manualReview` (a
  human who read the page could not state that part of the rule) and the
  candidate replaced it with a concrete threshold. This is the
  `dane-eviction-prevention` / invented-AMI-% failure class
  (`docs/eligibility-extraction.md` §8). Asserting a bound the source does not
  support is dangerous even without a named victim.
- **`threshold-tightened`** -- structural fallback for when the model check is
  `undecided`: the candidate's most generous income ceiling for a scale is
  stricter than the verified record's.

What it does **not** catch: a threshold that is wrong but *looser* than reality
(over-inclusive -- still a data error, but not dangerous); a dangerous narrowing
hidden behind distribution when a leaf is un-modellable; anything requiring
knowledge of the source page the harness cannot see.

On a **live** run, a single dangerous finding is **BLOCKING** -- a result, not a
percentage -- exactly as in `run-eval.ts`.

### 4. Correct abstention

Did the candidate emit `manualReview` where the verified record does?
`madison-housing-choice-voucher.ts` and `wisconsin-shares-child-care.ts` carry a
`manualReview` as one leaf inside a larger `allOf`; partial abstention is correct
and common, so this is scored by **count**, not all-or-nothing:
`correct` / `partial` / `missing` / `spurious` (abstained where a rule was
decidable -- over-cautious, not dangerous) / `not-applicable`. Counts are taken
on the raw tree, because canonicalisation de-dupes two `manualReview` conjuncts
into one.

Matching is by count plus a whole-rule-vs-leaf flag; it does not check that the
abstention sits beside the *same* sibling criteria. Doing that well without
over-fitting to one encoding is hard, and a miscounted position is a much
smaller error than a missed abstention.

### 5. Descriptive accuracy

`name`, `administeredBy`, `howToApply.phone` / `.url`, `summary`, `benefit`,
`requiredDocuments`. Lower stakes and genuinely automatable (#14). Per field
type (`lib/descriptive.ts`), each reports `match` / `near` / `miss` /
`not-scored`:

- **phone** -- reduce to digits, drop a leading US country code, exact compare.
- **url** -- drop scheme / `www.` / trailing slash / fragment; `match` if equal,
  `near` if same host.
- **name, administeredBy** -- punctuation/case-insensitive equality for `match`;
  token Dice >= 0.6 for `near`.
- **summary, benefit** -- token Dice: >= 0.7 `match`, >= 0.4 `near`. This is a
  *similarity* proxy, not a correctness check: a fluent paraphrase scores
  match/near, and a subtly wrong benefit amount inside otherwise-correct prose
  can still score `match`. Acceptable because these fields are low-stakes and a
  human reviews every record anyway.
- **requiredDocuments** -- normalised set overlap (Jaccard).

---

## Ground truth handling

- A record is **verified** when `source.lastVerified` is a date, read from the
  record -- not a hard-coded list. When #45 gives `dane-eviction-prevention` a
  real date the scored set grows by one automatically.
- `dane-eviction-prevention` (`lastVerified: null`, #45) is **excluded from
  correctness scoring**. Its verified *state* is itself a `manualReview`, so it
  is kept as an **abstention-only** case: scored only on "does the candidate also
  abstain?", never in a correctness denominator.
- An unverified record with a *concrete* eligibility rule would be **excluded
  entirely** (there are none today).

Current partition: **16 scored, 1 abstention-only, 0 excluded.**

---

## Architecture: pipeline-agnostic

The benchmark takes an `Extractor` as an argument
(`lib/extractor.ts`):

```
type Extractor = (context: ExtractionContext) => Promise<CandidateRecord | Abstention>
```

`ExtractionContext` carries the program id, source URL, source name, and a
`hasApiKey` flag. An extractor that needs the API **must** check `hasApiKey` and
throw `MissingApiKeyError` when it is false; the runner records the case as
`skipped-no-key` and the report says SKIPPED.

#67 (agentic), #68 (triage), and the deterministic path each implement this and
are scored by the same harness. Nothing is wired to a specific implementation.

### Diagnostic extractors (no model, no network)

- **`not-wired`** (default) -- there is no real extractor in this repo yet. With
  no key it is SKIPPED; with a key it reports `NOT WIRED` and scores nothing.
- **`verified-echo`** -- returns the ground-truth record. The scorer's own
  identity test: it *must* produce 16/16 equivalent, 0 dangerous, full coverage,
  all-`match` descriptive. Asserted in `--self-test` and the unit suite.
- **`abstain-all`** -- always abstains. The floor: 0 dangerous, 0 correct
  extractions, full coverage. A baseline to eyeball before spending tokens.

---

## Running it

```
npm run eval:program-extraction                          # default: not-wired -> SKIPPED / NOT WIRED
npm run eval:program-extraction -- --extractor=abstain-all
npm run eval:program-extraction -- --extractor=verified-echo   # scorer identity check
npm run eval:program-extraction -- --report-file=out.txt
npm run eval:program-extraction:self-test                # loads the dataset, runs the scorer offline, exits 0

npm run test:program-benchmark                           # the offline unit suite (fixture pairs)
npm run typecheck:program-benchmark
```

All four are wired into CI alongside the existing script gates (#48, #55).

Exit codes: `0` normal / SKIPPED / nothing-wired; `1` a live run produced a
dangerous finding (BLOCKING), or the self-test failed.

---

## Divergent is not wrong: the #74 analysis (2026-09-07)

The agentic extractor's verified run (#72, `pipeline/67-agentic-extraction`,
post-fix, $6.51) scored **0 / 16 eligibility-equivalent, 10 divergent, 0
dangerous, 0 undecided**, with **9 spurious abstentions** and **6 whole-record
abstentions**. #74 asked whether 0/16 is the real utility ceiling or an artefact
of tree shape.

### The candidate trees were not persisted

The run's report records only `eligibility=divergent` per case. The equivalence
detail and `divergenceWitnesses` are computed by `lib/criterion-equivalence.ts`
but `lib/report.ts` never renders them, and no candidate `Criterion` is written
anywhere. PR #72's comments quote abstention reasons and the two *pre-fix*
dangerous witnesses, but not one post-fix divergent candidate tree. #74 forbids a
fresh model call. **So a literal side-by-side of the 10 actual candidate trees
cannot be produced from existing artefacts.**

Two things were done instead:

1. **`npm run extract:agentic -- --dump=run.json`** was added (read-only; it does
   not touch scoring). It writes, per case, the verified `Criterion`, the
   candidate `Criterion` (or the abstention reason), the full `EquivalenceResult`
   with its divergence/dangerous witnesses, the abstention score, and the agent
   trace. The next marginal-cost live run should pass it; #74's per-case
   classification then needs **zero** further tokens.
2. The structural analysis below, from the verified records + the #72
   reserved-fact gate + the scorer's own semantics + the two numbers the report
   *does* expose (spurious = 9, dangerous = 0, undecided = 0).

### The 10 divergent cases (by elimination)

17 records; `dane-eviction-prevention` is abstention-only; 16 scored. The 6
whole-record abstentions (#72's comment: `wi-211` by policy; `wheap-energy`,
`wheap-crisis`, `wisconsin-weatherization` on `energyandhousing.wi.gov` fetch
failure; `foodshare-snap-wi`, `school-meals-wi` missing-page) leave exactly these
10 divergent:

| # | program | verified `eligibility` (real) | reserved / undecidable condition the verified record keeps in prose | most likely divergence class |
|---|---|---|---|---|
| 1 | `badgercare-plus` | `allOf(WI, anyOf(inc≤100 FPL, allOf(anyOf(pregnant, childU5, schoolAge), inc≤306 FPL)))` | "Covers ages 0–64 only"; immigration status — **caveat prose, not in the tree** | **4** (candidate forced to a `manualReview` leaf), leans **5** — see below |
| 2 | `madison-housing-choice-voucher` | `allOf(WI, housingStatus∈{renting,unhoused-or-temporary,living-with-others}, inc≤50 dane-ami, manualReview(waitlist closed))` | citizenship (the *pre-fix* dangerous witness here); waitlist already a leaf | concrete-leaf divergence (AMI %, housingStatus set, or an added citizenship leaf); not dangerous |
| 3 | `madison-water-bill-assistance` | `allOf(livesIn.madison, anyOf(inc≤50 dane-ami, currentBenefits⊇any{snap-foodshare,housing-choice-voucher,wic}))` | — | concrete-leaf divergence (city-vs-county scope, benefit-list membership, AMI %) — **3** or **1**, direction unknown |
| 4 | `second-harvest-southern-wi` | `livesIn.daneCounty` | 16-county service area is in the caveat, not the tree | **3** broader (candidate likely `WI` or a wider geo) or **4** |
| 5 | `sun-bucks-wi` | `allOf(WI, hasSchoolAgeChild, anyOf(inc≤185 FPL, currentBenefits⊇any{snap-foodshare,medicaid-badgercare,w2-tanf}))` | NSLP-school attendance caveat | likely **4** (spurious `manualReview` for the school-participation caveat) |
| 6 | `the-river-food-pantry` | `livesIn.daneCounty` | TEFAP 200% FPL self-attestation is **deliberately** left in the caveat (see the record's own comment) | **4** (added `manualReview`) or **3** (broadened to `WI`). Not a positive income test — that would have tripped a dangerous witness, and dangerous = 0 |
| 7 | `wic-wisconsin` | `allOf(WI, anyOf(pregnant, childU5), anyOf(inc≤185 FPL, currentBenefits⊇any{...}))` | nutritional-need check caveat | likely **4** (spurious `manualReview` for the clinic nutrition assessment) |
| 8 | `wisconsin-shares-child-care` | `allOf(WI, anyOf(childU5, schoolAge), inc≤200 FPL, manualReview(work/school activity))` | work-activity already a leaf | concrete-leaf divergence (200% FPL scale/percent, or the child-age set); abstention likely `correct`, not spurious |
| 9 | `lifeline-phone-internet` | `anyOf(inc≤135 FPL, currentBenefits⊇any{snap-foodshare,medicaid-badgercare,ssi,housing-choice-voucher,federal-public-housing})` — **no residency leaf** | AK/HI FPL differ from the `state` fact (the WOZ run noticed this) | concrete-leaf divergence (benefit-list membership, an added residency leaf, or a `manualReview` for AK/HI) |
| 10 | `dane-joining-forces-for-families` | `livesIn.daneCounty` | referral service, no real test | **3** / **4** (candidate likely `always` or `WI`) |

### What the numbers that *are* exposed tell us

- **spurious abstentions = 9**, of which 3 are whole-record (`foodshare`,
  `school-meals`, `wi-211`). That leaves **6 scored divergent records where the
  candidate added a `manualReview` leaf the verified record does not have** —
  i.e. 6 of the 10 are the reserved-fact / caveat-prose collapse, scored
  `divergent` purely because `allOf(rule, manualReview)` evaluates to `unknown`
  wherever the verified rule evaluates `true`. Under #74's taxonomy that is
  **category 4** almost by definition ("a condition the verified record put in
  `eligibilityCaveats` prose that the candidate encoded as a `manualReview`
  leaf").
- The remaining **~4** diverge on concrete leaves (income scale/percent,
  set membership, geographic scope). With **dangerous = 0** none of these is
  narrower-in-a-modellable-way; they are over-inclusive (**category 3**) or a
  genuine but non-dangerous misread (**category 1**). Direction unresolved
  without the trees.

### Is there a category-2 (narrower, undetected) scorer gap? No — not on this run.

A candidate that is narrower via *any* modellable leaf — a tighter
`incomeAtOrBelow`, a dropped `anyOf` branch, an extra askable `compare` in an
`allOf` — produces a state where `verified = T` and `candidate = F`, which
`criterionEquivalence` records as a dangerous witness. `dangerous = 0` **and**
`undecided = 0` together mean the model check ran on every one of the 10 and
found no such state. The two latent escape routes documented above —
`undecided` + a multi-bound numeric `compare` on a shared fact, and the
`abstention-replaced` net-leaf-count edge — both require `undecided > 0` or a
verified `manualReview`; neither fired. A candidate `manualReview` always
evaluates `unknown`, never `false`, so routing a population to review is never
flagged dangerous — but that is **correct by design** (unknown = "might qualify"
= the safe direction), not a gap.

**Conclusion: the 0-dangerous result is trustworthy, and #74's most-feared
finding is absent.**

### `badgercare-plus` — the verified record is arguably the weaker one (category 5)

The verified tree omits the 0–64 age bound entirely; it lives only in
`eligibilityCaveats`. `src/engine/match.ts` does **not** consult
`eligibilityCaveats` when it buckets a program, so a 66-year-old childless WI
resident at 90% FPL is shown **eligible** for BadgerCare Plus, with the "covers
ages 0–64 only" text as an aside. `facts.ts` says these programs are meant to
"stay in 'might qualify'" — the current encoding does not achieve that. The
`manualReview` leaf the #72 gate now *forces* the extractor to emit would keep
that population in `maybe`, which is more honest. The same applies wherever a
reserved-fact gate is real and the verified record dropped it rather than
abstaining on it.

### Plain answer

**0 / 16 is substantially an artefact of tree shape, not a measurement of
comprehension.** ~6 of the 10 divergences are the reserved-fact / caveat-prose
collapse that #72's author pre-registered as a prediction ("for programs that are
mostly reserved-fact gated the rule collapses toward 'always manual review' —
safe, but not informative… the benchmark should expect that rather than score it
as a miss"). **That prediction is confirmed.** A benchmark that credited the
defensible-variant shape would show this run at roughly **6 defensible-variant +
0 equivalent + ~4 genuine divergent**, not a flat 0/16.

This does **not** mean the extractor is good. It means the *equivalence* number
is the wrong place to read its quality off. The real, separate problems stand
undiminished: **6 / 16 whole-record retrieval failures**, poor descriptive
accuracy, and — for the ~4 concrete-leaf divergences — an unquantified rate of
genuine misreads. #72's "the bottleneck is retrieval, not comprehension" is
consistent with everything here.

### Recommendation: a distinct `defensible-variant` outcome

Fold neither into `equivalent` (the candidate genuinely lost information — the
user gets "check with the agency" instead of an answer) nor leave in `divergent`
(it is not *wrong*, and it currently drowns the number that should mean "the
extractor built a rule that disagrees with the source"). Add a fourth
`EligibilityVerdict`, assigned mechanically when **all** hold:

1. Not dangerous — no dangerous witnesses, no `abstention-replaced`, no
   `threshold-tightened`.
2. Every divergence witness has `candidate = unknown` (never `T`/`F` opposite the
   verified value). The candidate is only ever *less* decisive, never differently
   decisive.
3. `countManualReview(candidate) > countManualReview(verified)` — the added
   imprecision is attributable to abstention leaves.

That is exactly "the candidate abstained where the verified record committed, and
disagreed nowhere else." Report it on its own line — `equivalent` /
`defensible-variant` / `divergent` / `undecided` — and **never sum it with
`equivalent`**. The `spurious` abstention count already measures the utility lost
this way and should keep doing so beside it. Risk: it can flatter an extractor
that abstains on half of every rule; mitigations are the no-summing rule and
keeping it visually distinct in the report. Implementation is a follow-up (#74 is
analysis only).
