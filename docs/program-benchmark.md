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
