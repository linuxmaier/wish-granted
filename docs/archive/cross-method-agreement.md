> **ARCHIVED — research record, 2026-09-08.**
>
> The eligibility-extraction programme this document belongs to was unwound on
> 2026-09-08 (#97). **Its measurements stand; its architecture does not.** Nothing
> here is a constraint, a requirement, or an established fact about what is
> possible. It is kept because re-deriving the measurements would be expensive,
> and marked because four designs' worth of reasoning around them no longer
> applies.
>
> The words are used in the older sense throughout: **`dangerous` and
> "over-claim" here usually mean a rule *narrower* than reality**, which current
> documents call an *under-claim*. Read directions carefully, and do not rewrite
> them here.
>
> Current reasoning lives in [`../standing-decisions.md`](../standing-decisions.md)
> and [`../pipeline-principles.md`](../pipeline-principles.md).

# Cross-method agreement (issue #84)

The one failure four extraction designs never solved: **a number in the source
is treated as the rule, and a branch that governs or parallels it is dropped.**
Every measured over-claim (baseline #60, option 2 #61, classify-first #63/#64,
agentic #72) is that shape, and every one is *narrower than reality* -- the
direction that silently tells someone not to apply.

The common thread: **each design asked the extracting model to police itself.**
Self-policing fails on exactly the cases where the model's reading is
confidently incomplete -- it cannot flag a branch it never noticed.

This component stops doing that. It lives in `scripts/cross-check/` and calls no
model of its own; the two methods it compares are run elsewhere.

---

## Path A -- cross-method agreement

Run the deterministic Tier-3 parser (`scripts/tier3-extract`, no model) and the
agentic extractor (`scripts/agentic-extract`, an LLM with source access) on the
same source. The referee is `criterionEquivalence`
(`scripts/program-benchmark/lib/criterion-equivalence.ts`), **used unchanged** --
it is validated (identity test 16/16), and changing it would invalidate
comparison against the three prior benchmark runs.

### Scope the comparison to the dimension the parser speaks to

The two methods do **not** emit comparable units. The parser emits a narrow
*fragment* -- "the income (or categorical) rule at this source is X". The agentic
extractor emits a *full record* -- a geography envelope (`livesIn.wisconsin`),
program gates (`paysHeatingCost`), `manualReview` leaves. A **correct** agentic
record is therefore legitimately narrower than a bare income fragment, because it
adds real conjuncts the parser never looks for. Feeding both whole trees to the
referee reports the agentic side as "rules out profiles the parser accepts"
almost every time -- for the wrong reason (it added `state = WI`, not because a
branch was dropped).

So Path A first **projects both trees onto the parser fragment's dimension**
(`scripts/cross-check/lib/scoped-agreement.ts`): read the facts and income scales
the fragment actually constrains, then prune every leaf the parser is silent on,
collapsing the combinators through their identities (a dropped `allOf` conjunct
is vacuously true; a dropped `anyOf` alternative is a path the parser cannot
see). Geography, gates and `manualReview` are gone before the referee runs. What
survives a dangerous witness is a true positive: the parser admits an income
level the agentic tree rules out, or offers a categorical path the agentic tree
lacks.

`criterionEquivalence(a, b)` is asymmetric: it reports when `b` rules out a
profile `a` accepts or flags for review, by three-valued model checking with no
model call. #84 wants the dangerous direction caught *either way*, so we run it
**both ways on the projections** and treat a dangerous witness in either
direction as the dangerous outcome. We never need to know which method is wrong.

| Referee verdict on the projections (both directions) | Route |
|---|---|
| equivalent on the parser's dimension | **high confidence** -- two independent methods, neither failure mode fired |
| a dangerous witness either way | **human, high priority** -- one method dropped a branch the other has |
| undecided (un-modellable leaf / state space too large) | human, low priority -- not provably safe |
| no shared dimension (agentic rule mentions none of the parser's facts) | human, low priority -- methods examined different things |
| divergent only around unknowns | human, low priority |

Both methods abstaining is itself an agreement: **high confidence**, the
abstention is corroborated.

## Path B -- the exclusion probe

Where the parser abstains, Path A has nothing to compare. For those, a **fresh**
model call -- no memory of the extraction -- is given the source text and the
emitted rule and asked one narrow question:

> Name someone the source says is eligible whom this rule would exclude.

Three things separate this from option 2's failed verifier, and
`scripts/cross-check/lib/exclusion-probe.ts` preserves all three:

1. It targets **only the dangerous direction**, not correctness in general.
2. It is a **fresh call**, not self-report -- a second reader is not bound by
   the first reader's blind spot.
3. It asks for a **concrete person and a verbatim span**, and the span is then
   checked **mechanically** against the source text (`spanIsInSource`). An answer
   whose span is not in the source is discarded -- the model cannot route a case
   by inventing a quote.

If it names someone and the span checks out -> human, high priority. If it names
nobody -> high confidence (single method, but survived an independent adversarial
check). No probe available (offline / no key) -> human, low priority; a
single-method extraction is never auto-trusted.

## The degenerate outcome this must expose, not hide

If Path A routes nearly everything to a human because the two methods rarely
agree, that is **classify-first again in new clothing** -- a 0-dangerous number
bought by never committing. `summariseRouting` reports the **agreement rate**
(equivalent / comparable) explicitly, and the report prints a
`DEGENERATE-OUTCOME WARNING` when the high-confidence bucket falls below 20%.

## What the offline analysis already shows

`npm run extract:cross-check` (model-free) maps the 16 verified program records
to Tier-3 fixtures: **10 have a fixture at (9) or near (1) their source URL** --
coverage is real, not marginal. Of those 10, the parser abstains on 4 (-> Path
B) and extracts on 6. On those 6, comparing the parser's fragment to the
**verified** record *on the dimension the parser speaks to* (both projected):

- **5** agree on the parser's dimension (`lifeline-phone-internet`, both WHEAP
  records, `wisconsin-shares-child-care`, `wic-wisconsin`);
- **1** diverges: `school-meals-wi`, where the parser lists `medicaid-badgercare`
  as a direct-certification category and the verified record does not. That is a
  real categorical divergence a reviewer should see -- a genuine finding, not an
  artefact.

**Pre-measurement prediction for the live run:** against the verified record as a
proxy for a correct agentic extraction, the scoped agreement rate is **5 of 6
(~83%)**. The live agentic extractor will not match the verified record
perfectly, so expect the *measured* rate to land somewhat below this -- call it
**roughly 3 in 5 to 4 in 5** of comparable cases -- but the mechanical inflation
is gone. Stated before the coordinator runs it.

### The fragment-vs-record limitation: diagnosed and fixed

An earlier draft of this doc predicted a **1-in-6** agreement rate and concluded
that Path A would "mainly contribute a divergence flag, not agreement", with the
design leaning on Path B. That was **wrong -- and, usefully, wrong before we
spent ~$8 measuring it.** The 1-in-6 figure was an artefact of feeding a narrow
parser fragment and a full agentic record to a whole-tree comparison: the referee
scored an added `state = WI` leaf (a leaf the parser never looks at) as a
dangerous-direction divergence on *every* full record. Path A had become a
false-positive machine -- it flagged correctness as danger.

The fix is to compare only the dimension the parser has an opinion about (see
"Scope the comparison" above). Projecting both trees onto the parser fragment's
constrained facts removes the artefact without touching the referee: `state = WI`,
`paysHeatingCost` and `manualReview` are pruned before `criterionEquivalence`
runs, so they can no longer masquerade as dropped branches. A divergence that
*survives* projection -- like `school-meals-wi`'s extra `medicaid-badgercare` --
is a real disagreement between the two methods on the parser's own dimension.

This is **not** classify-first: every route still carries a concrete,
mechanically-derived reason (which profile is excluded, which span), and the
high-confidence bucket is non-empty only where two independent methods actually
converge on the dimension they can both see. If the *measured* rate still comes
back poor, that is now a real finding -- the two methods genuinely disagree --
rather than a measurement artefact, and the two are worth telling apart.

## Running it

```
npm run extract:cross-check            # model-free analysis + SKIPPED live run
npm run extract:cross-check:self-test  # offline: both paths, corpus, SKIPPED wiring
npm run test:cross-check               # unit + scenario suite (node --test)
```

A live run needs `ANTHROPIC_API_KEY`; it is a marginal cost performed by the
coordinator, not by CI.
