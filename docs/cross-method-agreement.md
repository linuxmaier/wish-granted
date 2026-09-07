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
same source. Feed both `Criterion` trees to `criterionEquivalence`
(`scripts/program-benchmark/lib/criterion-equivalence.ts`), **used unchanged** --
it is the referee, it is validated (identity test 16/16), and changing it would
invalidate comparison against the three prior benchmark runs.

`criterionEquivalence(a, b)` is asymmetric: it reports when `b` rules out a
profile `a` accepts or flags for review, by three-valued model checking with no
model call. #84 wants the dangerous direction caught *either way*, so we run it
**both ways** and treat a dangerous witness in either direction as the dangerous
outcome. We never need to know which method is wrong.

| Referee verdict (both directions) | Route |
|---|---|
| equivalent | **high confidence** -- two independent methods, neither failure mode fired |
| a dangerous witness either way | **human, high priority** -- one method dropped a branch |
| undecided (un-modellable leaf / state space too large) | human, low priority -- not provably safe |
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
B) and extracts on 6. On those 6, comparing the parser's rule to the
**verified** record:

- **1** (`lifeline-phone-internet`) is equivalent;
- **5** diverge, all in the dangerous direction.

The 5 diverge because the parser emits a narrow income/categorical *fragment*
while a correct agentic extraction emits a *full record* -- geography envelope,
program gates, `manualReview` branches. The referee treats an added `state = WI`
leaf as a real dangerous-direction divergence, and it is right to.

**Prediction for the live run:** Path A's "agree" rate will be roughly **1 in
6** comparable cases. Path A's main contribution is the divergence *flag*, not
agreement; the design leans on Path B for the abstention-heavy majority of
Tier-3. This is a real limitation of comparing a deliberately-narrow parser
against a full extractor -- stated here rather than discovered after a
measurement run. It is **not** classify-first: every route carries a concrete,
mechanically-derived reason (which profile is excluded, which span), and the
high-confidence bucket is non-empty by construction only where two methods
actually converge.

## Running it

```
npm run extract:cross-check            # model-free analysis + SKIPPED live run
npm run extract:cross-check:self-test  # offline: both paths, corpus, SKIPPED wiring
npm run test:cross-check               # unit + scenario suite (node --test)
```

A live run needs `ANTHROPIC_API_KEY`; it is a marginal cost performed by the
coordinator, not by CI.
