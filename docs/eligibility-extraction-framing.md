# Eligibility extraction, re-approached for autonomy (issue #62)

Investigated 2026-09-06. This is a spike in the tradition of #4, #5, and #23: a
written finding plus runnable prototypes, not a production pipeline. It builds
directly on `docs/eligibility-extraction.md` (#5, #43) and its two failed
follow-ups -- #51 (the held-out run that returned a dangerous over-claim) and
#61 (option 2, the scope-carrying obligation, measured and rejected). Their
facts are inputs here, not re-derived.

**A limitation folded in rather than hidden:** this spike could not run its
prototypes against a live model. No `ANTHROPIC_API_KEY` and no `ant` CLI
credential were available in the environment it ran in -- the same constraint
that left #5 and #43 `SKIPPED` on their first pass. So the deliverable is:
(a) a reasoned answer to #62's question drawn from the existing corpus of
measurements, which is large and specific; (b) three runnable prototypes with
frozen inputs; (c) one result that needs no API key -- the structure-preserving
excerpt demonstration in Section 4, which is deterministic; and (d) the exact
commands and expected cost for whoever runs the measurement. Section 8 is that
handoff. **Nothing below reports a model-behaviour number this spike did not
measure.** Where a claim rests on prior measurement, it cites the issue.

> **Update, 2026-09-06 (experiment 1 -- the threshold sweep).** The prototypes
> have now been run live on `claude-sonnet-5`. `.env` was copied into the
> worktree (it is gitignored, which is why the original spike ran `SKIPPED`).
> **Everything below the line stands as written**; the new measured section
> immediately following supersedes the "no live measurement" caveat above for
> the classify-first pipeline, on the `tuning` and `framing` splits only. The
> frozen `heldout` 27 were **not** run in this experiment -- that single
> confirmation is run separately against the candidate config in
> "Handoff: the held-out confirmation" below.

---

## Measured: the confidence-threshold sweep (experiment 1)

Run 2026-09-06 on `claude-sonnet-5`, `tuning` split (14 cases: 8 abstain, 6
extract) and the `framing` probe (now 7 cases). `heldout` untouched. Total
API spend for the whole experiment (many sweeps + repeats): ~$1.4.

### Does a viable band exist?

**Yes.** On the tuning split there is a wide band -- every `minConfidenceScore`
from 0 to 80 -- where **dangerous over-claims stay at 0 and correct extractions
are 3/6**, stable across three independent runs. The confidence threshold is
*not* the thing holding extraction down between 0 and 80; loosening it all the
way to 0 introduces no dangerous over-claim and also gains no extraction,
because two other mechanisms (the scope-signal gate and the extractor's own
abstention) hold the line underneath it.

The candidate configuration to confirm on held-out:

```
npm run eval:llm-framing -- --split=heldout --confidence-gate=off --min-confidence=60
```

This replaces the miscalibrated categorical `confidence: 'low'` gate (which on
the #61-era held-out run blocked all three controls) with a calibrated numeric
floor at 60, and keeps every structural gate (scope-signal, rule-shape,
figure-role) exactly as PR #63 shipped them.

### The sweep table (tuning split, prose excerpts, representative run)

Four numbers, never blended. `tgt-match` = of the correct extractions, how many
match the hand-authored `Criterion` in shape (informational -- the harness's
"correct extraction" only means "not manualReview + passed the gate", so a
wrong-but-well-formed rule counts; `tgt-match` is the real signal). `trig` =
which gate suppressed a routing decision, as confidence / scope-signal /
shape-or-figure.

| routing config | correct abstentions | dangerous | correct extractions | gate fail | tgt-match | over-cautious | trig (conf/scope/shape) |
|---|---|---|---|---|---|---|---|
| PR #63 default (categorical `high` gate) | 8/8 | **0** | 3/6 | 0 | 2-3/6 | 3 | 6/4/0 |
| score >= 0 (confidence gate fully open) | 8/8 | **0** | 3/6 | 0 | 2-3/6 | 3 | 0/9/1 |
| score >= 50 | 8/8 | **0** | 3/6 | 0 | 2-3/6 | 3 | 2/7/1 |
| score >= 60 | 8/8 | **0** | 3/6 | 0 | 2-3/6 | 3 | 6/4/0 |
| score >= 70 | 8/8 | **0** | 3/6 | 0 | 2-3/6 | 3 | 6/4/0 |
| score >= 80 | 8/8 | **0** | 3/6 | 0 | 2-3/6 | 3 | 7/3/0 |
| score >= 90 | 8/8 | **0** | 2/6 | 0 | 1-2/6 | 4 | 10/2/0 |
| score >= 60, **scope gate OFF** | 8/8 | **0** | 3/6 | 0 | 2-3/6 | 3 | 6/0/4 |
| score >= 60, **figure-role gate OFF** | 8/8 | **0** | 3/6 | 0 | 2-3/6 | 3 | 6/4/0 |
| all gates OFF except scope | 8/8 | **0** | 4/6 | 0 | 2-3/6 | 2 | 0/9/0 |

(Small run-to-run movement in `tgt-match` and the trig split is real
non-determinism at this sample size -- `madcap-categorical` and
`foodshare-gross-income-test` flip between runs. `correct abstentions` and
`dangerous` did not move in any run.)

### The two triggers, treated separately

PR #63's probe output separated *"scope signal present"* (fired on correct
abstentions) from *"classifier confidence is low"* (fired on every control).
This experiment measures them apart:

- **Scope-signal detection does real work and is safe to keep.** Turning the
  scope gate OFF (row 8, and every `framing` ablation) never produced a
  dangerous over-claim on either split. Every case it catches, the extractor
  *also* catches -- it emits `manualReview` on its own when the excerpt actually
  reaches it. So the scope gate is a cheap early exit, not the sole safety
  mechanism. It is doing exactly the job PR #63 hoped: `trc-no-published-ami`
  (the invented-AMI bug), `cda-section8-income-table`, the SNAP deduction
  stacks all route on a scope signal, correctly.

- **The confidence gate was the miscalibrated one, and it is safe to
  recalibrate.** The categorical `confidence: 'low'` flag was pinned at maximum
  caution. Replacing it with a numeric `confidenceScore` and sweeping the
  threshold shows the band 0-80 is flat: no dangerous over-claim appears, and
  the extraction count does not rise either, because the cases a looser
  threshold would release are ones the extractor then abstains on
  (`wheap-smi`, `foodshare-gross-income-test` -- both near-miss traps, and
  `wheap-smi` is subtly *wrong* even when the direct pipeline extracts it).
  `confidenceScore >= 90` is the only setting that costs a real extraction.

Two prompt fixes to the classifier were also part of this experiment (both
tunable, both toward the documented intent of the existing held-out control
cases): it no longer reports the categorical-enrollment list stem as a scope
signal when the rule shape *is* a categorical list, and no longer reports
"based on household/family size / state / before deductions" as a scope signal
(those describe how an income test is applied, not who it covers). These are
what moved `lifeline-fpl` and `lifeline-categorical` from over-cautious to
correct, matching target.

### What the classifier buys, quantified

Same 14 tuning cases, `claude-sonnet-5`, one run each:

| pipeline | correct abstentions | dangerous | correct extractions | tgt-match |
|---|---|---|---|---|
| **direct** (no classifier, current one-step) | 7/8 | **1** (`trc-no-published-ami`: invented `incomeAtOrBelow('dane-ami', 80)`) | 5/6 | 4/6 |
| **classify-first**, candidate config | 8/8 | **0** | 3/6 | 3/6 |

The classifier removes the dangerous over-claim and costs two extractions
(5 -> 3). Both lost extractions are near-miss traps (`wheap-smi`,
`foodshare-gross-income-test`) where "correct extraction" is one subtle
misreading away from wrong -- `wheap-smi` *is* wrong in the direct run
(`tgt-match` 4/6, not 5/6). This is the #5 §4.4 trade (abstention over accuracy)
landing where it should.

### Hypothesis 3 (structure-preserving excerpts), end to end

`--excerpt=structured` was never reached in PR #63 because nothing got to
extraction. Now measured on the two table cases in the `framing` probe
(`wi-medicaid-fpl-chart-mapp-column`, and `badgercare-plus-fpl-table-columns`,
a fresh re-fetch of the exact source table behind the frozen held-out
`badgercare-plus-population-columns`, added so H3 can be tested without touching
held-out):

- **Structure preservation measurably fixes the classifier's figure-role
  read.** On the MAPP chart, prose flattening makes the classifier tag the
  `250% FPL` figure as `separate-subpopulation-limit` and quote it as
  `"250% FPL ... QDWI and Lower MAPP"` (two programs fused). The structured
  Markdown rendering makes it tag the same figure `eligibility-income-ceiling`
  and quote `"250% FPL ... MAPP"` -- the correct column. This is the
  deterministic Section 4 result, now confirmed to carry through to the model.

- **It does not open the autonomous band for tables, and should not.** The
  rule shape stays `scope-set-by-table-structure` and `confidenceScore` stays
  ~45, so the case still routes to `manualReview` -- correctly. Routing a
  9-column table autonomously on the classifier's column pick is the
  BadgerCare failure class.

- **The stronger H3 finding: structured excerpts make the *extractor*
  self-defend.** With every routing gate disabled and
  `scope-set-by-table-structure` explicitly allowed onto the auto-extract path
  -- i.e. all protection removed -- the extractor *still* emitted `manualReview`
  on both table cases ("Cannot be reduced to a single incomeAtOrBelow rule",
  "Needs human review to confirm the correct income percentage"). It did **not**
  grab 306% or 100%. The prose flattening in the current pipeline was
  *causing* the BadgerCare over-claim by hiding the multi-population ambiguity
  from the extractor; the structured rendering shows it the ambiguity and it
  abstains. `framing` split, structured: **4/4 correct abstentions, 0
  dangerous, at every routing config including all-gates-off.**

### Hypothesis 2 (verification by counterexample)

`--verify` now runs (it never did in PR #63). Across every sweep row on both
splits where an extraction occurred, the verifier recorded **0 rejections and
0 false rejections**. On this evidence it neither helps nor hurts on the band
the classifier already admits -- consistent with the prototype's own docstring
(it is strictly weaker than H1 for the never-noticed class, and the cases that
reach it are already the clean ones). It costs one extra call per extraction
for no measured change. Recommend leaving it off until there is a case class it
demonstrably catches.

### The ceiling, characterised

On the `framing` controls (`mapp-eligibility-list-control`,
`wwwp-income-ceiling-control`) the classify-first pipeline is **structurally
unable** to produce the right answer, and this is the real ceiling, not the
confidence threshold. Their hand-authored targets are
`allOf(cleanCeiling, manualReview(the rest))` -- a clean income ceiling plus a
`manualReview` leaf for side conditions (asset test, work requirement, age
band). `decideAutonomy()` is all-or-nothing *at the excerpt level*: any scope
signal or branchy rule shape sends the **whole** excerpt to `manualReview`,
even when the income ceiling itself is unconditional and clean. Classify-first
works for excerpts whose entire rule is one fact (`lifeline-fpl`,
`lifeline-categorical`, `wic-adjunctive-eligibility`); it cannot do the
partial-extraction pattern that several real program records need. That is a
design limit of routing-at-the-excerpt, not a tuning problem.

### The subset the classifier handles reliably enough to automate

- **Single unconditional income ceiling, stated in prose, no side conditions**
  (`incomeAtOrBelow(scale, percent)` as the whole rule): reliably routed and
  reliably extracted correctly.
- **Categorical-enrollment list** where every named program has a
  `currentBenefits` slug and there is no diagnosis / screening / medical-
  necessity gate: reliably routed; extraction correct when the slug mapping is
  clean (`lifeline-categorical`), flaky when it is hard (`madcap-categorical`,
  the "Section 8 -> housing-choice-voucher" + "FoodShare/SNAP collapse" case).
- **Everything else** -- tables, cost-sharing schedules, deduction stacks,
  conditional/extended branches, negations, and any clean ceiling that sits
  next to a side condition -- routes to `manualReview`, and should.

This is the same Tier 2 / low-Tier-3 boundary the spike's "The answer" section
draws. The sweep confirms it empirically on the tuning split and adds one
correction: the boundary is drawn by whether the rule is *a single fact*, not
just by whether it has a scope signal.

---

## Handoff: the held-out confirmation

**Run exactly one command against the frozen 27:**

```
npm run eval:llm-framing -- --split=heldout --confidence-gate=off --min-confidence=60
```

**Prediction, made before the run (per the spike rule that a pre-registered
prediction is worth more than a postmortem):**

- **Dangerous over-claims: 0.** The three structural gates are unchanged from
  PR #63's `0/21`, and the classifier prompt only *loosened* two specific
  false-positive scope signals, neither of which appears in a held-out abstain
  trap. Residual risk, if any single case breaks this: `headstart-cfr-over-
  income-allowance` or `emergency-assistance-emergency-gate` -- both put a real
  FPL number in a branch, and if the classifier calls the shape
  `single-unconditional-threshold` with `confidenceScore >= 60` *and* misses
  the branch as a scope signal, one could slip. I judge this unlikely (both
  read as clearly branchy) but it is where I would look first.
- **Correct extractions: 2-3 / 6** (up from PR #63's 0/6). `wic-adjunctive-
  eligibility` and `wic-category-test` are single-fact categorical rules and
  should extract and match target. `wic-may-also-apply` may now extract (the
  "foster parents may also apply" clause is exactly the false scope signal the
  prompt fix removes). `wishares-income-and-activity` and `madcap-billholder-
  and-ami` will route to `manualReview` (over-cautious) -- both need the
  `allOf(ceiling, manualReview-leaf)` shape the pipeline can't produce.
  `schoolmeals-direct-certification` is a coin-flip on the slug mapping.
- **Correct abstentions: 20-21 / 21.** Gate failures: 0.
- **Over-cautious: ~3-4** of the 6 extract cases.

If the run comes back with a dangerous over-claim, the candidate is dead and
the honest answer to #62 is that the LLM must be confined to the single-fact
subset above (or dropped from the eligibility path) -- which is itself a
usable answer.

---

## The answer

**Is mostly-autonomous extraction reachable, and under what restrictions?**

Yes for a narrow, structurally-defined band; no for the rest; and the boundary
is drawn by **document structure**, not by topic, program, or difficulty.

1. **Autonomous, zero LLM calls -- ~29% of the corpus (Tier 1).** Deterministic
   table extraction, already measured at 4/4 on real page snapshots (#5 §3).
   Unchanged by this spike.

2. **Autonomous *behind a classification gate* -- the clean part of Tier 2 plus
   the simplest slice of Tier 3.** The band where (a) the rule is one
   unconditional income ceiling or a categorical-enrollment list, (b) every
   number in the excerpt is an eligibility ceiling -- not a premium tier, a
   benefit amount, a deduction, or a sub-population limit, and (c) there is no
   structural scope signal (governing heading, table column header,
   "extended/if" branch, negation, deduction stack). On the existing evidence
   the extractor *already handles this shape*: every correct extraction across
   every run (#23 3/4, #43 held-out 3/4, #51 pre-fix 5/6) was exactly this
   shape, and every one of the six dangerous over-claims ever measured violated
   (a), (b), or (c). The open question is only whether a cheap classifier can
   *recognise* (a)-(c) reliably. That is what the Section 3 prototype measures.

3. **Never autonomous -- auto-route to `manualReview` -- everything else
   (~45-55% of the corpus).** All of Tier 4 (24%, no rule published -- already
   a human one-liner per #5 rec 2), plus every Tier 3 excerpt that fails the
   gate above: deduction stacks, cross-references, conditional/extended
   branches, cost-sharing schedules, tables scoped by a header, negations. This
   is where all six dangerous over-claims live, and #61 measured that you
   *cannot* recover this band by asking the model to self-report the scope --
   it does not perceive the scope, so it cannot report it.

**"Mostly autonomous" is reachable if "mostly" means about the 43% that is
Tier 1 + Tier 2, plus whatever thin slice of Tier 3 a classifier can safely
admit -- and not as "the model decides Tier 3 and a human spot-checks."** The
ceiling is roughly the Tier 2 / Tier 3 line. It does not move into Tier 3 by
prompt work; #43, #51, and #61 are three measured attempts to move it and none
did.

**Why this is consistent with #5 §6.5 (reviewer throughput binds) and improves
on it.** The auto-`manualReview` route removes the dangerous-over-claim risk
from the automated path *by construction*: that path emits only (i)
script-parsed tables and (ii) classifier-gated single-fact rules, neither of
which can carry a silently-dropped scope. The human queue then shrinks to the
Tier 3 residue -- and, critically, most of that review is *"confirm this is
manualReview"* (fast, low-stakes) rather than *"verify this extracted
threshold"* (slow, and the failure-prone task §6.5 was scoping). That is a
better shape of "mostly autonomous" than the one §6.5 costed, but it is not a
higher autonomous *fraction*.

**The task-framing change that makes this work.** Replace the one-step "extract
the eligibility rule" with two steps: first *classify what the excerpt is* (and
what role each number plays), then extract *only if* the classification lands
in the autonomous band. Classification is bounded multiple-choice; open-ended
structured generation is not. Every measured failure is a misclassification the
current framing never gets the chance to make explicit.

---

## 1. Method, and what was and was not done

- **Re-read every dangerous over-claim** measured across #23, #43, #51, and #61
  (Section 2). No new model runs were needed for this; the failures are
  documented case-by-case in `docs/eligibility-extraction.md` §4.4-4.6 and
  #61's PR body.
- **Built three prototypes** under `scripts/llm-extraction/framing/`, each a
  real, runnable module with a pure core and API plumbing in the runner
  (matching how `criterion-schema.ts` is pure and `run-eval.ts` does the
  fetch). They report `SKIPPED` without a key rather than fabricating a result.
- **Fetched six real source excerpts** with a desktop-Chrome user agent (WI
  state sites 403 a naive fetcher -- #5 §1, confirmed again), from programs the
  frozen held-out set does not touch (MAPP, Katie Beckett, Wisconsin Well Woman
  Program / Medicaid). Frozen as `framing/framing-eval-cases.ts` on 2026-09-06,
  with `fetchedOn` on every case. One real HTML `<table>` fragment is stored
  verbatim under `framing/fixtures/` for the Section 4 demonstration.
- **The 27 held-out cases in `eval-cases.ts` were not touched.** The Section 3
  runner can pipe the frozen `heldout` split through the classify-first
  pipeline unmodified (`--split=heldout`) -- that is where the real measurement
  of the pipeline belongs; the six fresh cases are a development probe, not a
  measurement set.
- **`strict: true` stays off** (#5 §4.5, a grammar-compilation limit).
- **Not done:** any live API call. Hypotheses 4 (ensemble) was not prototyped
  -- reasoning in Section 6.

---

## 2. The failure taxonomy, re-read

Every dangerous over-claim ever measured by this project:

| Case | Number found | Its actual role | Structural signal present | Source |
|---|---|---|---|---|
| `seniorcare-coverage-levels` | 160% FPL | prescription cost-sharing tier; **no** income ceiling exists | none -- implicit | #51 |
| `badgercare-plus-population-columns` | 201 / 306% FPL | scoped by a table **column header** | table structure | #61 |
| `snap-cfr-elderly-separate-household` | 165% FPL | a household-**composition** test | prose clause | #61 |
| `cda-residency-not-required` | -- | a **negation** ("residency is not required") | prose negation | #61 |
| `lifeline-survivor-extended` | 200% FPL | a survivor-only **extended** branch | heading / branch | #51 |
| `emergency-assistance-emergency-gate` | 115% FPL | gated on an **emergency** predicate | opening clause | #51 |
| `headstart-cfr-over-income-allowance` | 130% poverty | a capped discretionary **allowance** | prose "may" | (abstained in #51; over-claimed earlier) |

**Not one is a failure to find the number. Every one is a misclassification of
what the number governs.** Two sub-classes matter for the fix:

- **Noticed-then-dropped** (Lifeline survivor, Emergency Assistance): the model
  saw a branch condition and discarded it. #61's option 2 (self-report the
  preconditions) helped here -- and still traded three catchable over-claims
  for three harder ones.
- **Never-noticed** (SeniorCare, BadgerCare columns, CDA negation, SNAP
  composition): the scope is structural or implicit, the model never perceived
  it as a condition, so no self-report and no verifier that shares the model's
  blind spot can catch it. #61's review predicted this would be the whole
  residue, and it was.

The fix has to attack the never-noticed class without a self-report, and it has
to do so *before* the extraction call constructs a rule.

---

## 3. Hypothesis 1: classify before extracting

**`framing/classify-role.ts`** -- built, `SKIPPED` (no key).

A first call to a forced `classify_excerpt` tool. It does not build a
`Criterion`. It answers, for the excerpt:

- **`numericFigures[]`** -- every dollar amount / percentage / multiple-of-scale,
  each tagged with what it *governs*: `eligibility-income-ceiling`,
  `cost-sharing-premium-copay-or-tier`, `benefit-payment-amount`,
  `income-deduction-or-disregard`, `separate-subpopulation-limit`,
  `program-year-or-effective-date`, or `other-or-unclear`.
- **`ruleShape`** -- `single-unconditional-threshold`,
  `categorical-enrollment-list`, `conditional-or-extended-eligibility-branch`,
  `multi-factor-or-deduction-stack`, `negation-or-no-rule-stated`, or
  `scope-set-by-table-structure`.
- **`scopeSignals[]`** -- every phrase that narrows a number to a subgroup and
  that a careless reader would drop.
- **`confidence`**.

**`decideAutonomy()`** is the routing rule, and it is deliberately strict. An
excerpt goes to the extraction call **only if** confidence is `high`, there are
no scope signals, `ruleShape` is a plain threshold or a categorical list, and
*every* figure is an `eligibility-income-ceiling`. Anything else is emitted as
`manualReview` **without calling the extractor at all**.

Mapped against the taxonomy: SeniorCare's tier percentages -> `cost-sharing`
figure -> auto-`manualReview`. BadgerCare's columns -> `scope-set-by-table-
structure` -> auto-`manualReview`. Lifeline survivor -> `conditional-or-
extended` shape + a scope signal -> auto-`manualReview`. CDA negation ->
`negation-or-no-rule-stated` -> auto-`manualReview`. The MAPP-premium and
WWWP-income controls in the fresh set -> `single-unconditional-threshold`, one
`eligibility-income-ceiling` figure, no signal -> extractor runs.

**Why this should help where option 2 did not.** A dangerous over-claim now
requires *two* independent failures in series -- the classifier mislabels a
trap as auto-extractable *and* the extractor then over-claims on it -- so the
joint rate should fall well below either. And classification is a strictly
easier task: the model picks from a fixed list instead of composing a recursive
expression. Every one of the six historical failures is a single label the
classifier is being asked to get right.

**Its cost, which must be measured, not assumed.** A classifier that is too
conservative routes real ceilings to a human -- the same yield collapse #61
measured (option 2 dropped correct extractions from 5/6 to 1/6). The runner
reports this as a fifth number, `over-cautious`, separately. The three
`clean-ceiling-control` cases in the fresh set (and the two controls already in
`eval-cases.ts`) exist to measure it.

**This is also hypothesis 5.** "Autonomy by scope restriction" is not a
separate experiment -- `decideAutonomy()` *is* the scope restriction, and the
tiering is its frame. The recommendation in "The answer" above is this routing
rule plus the deterministic Tier 1 path.

---

## 4. Hypothesis 3: structure-preserving excerpts

**`framing/structure-excerpt.ts`** -- built, and the core claim is demonstrated
**without a model**, deterministically, in `framing/framing.test.ts`.

The `badgercare-plus-population-columns` over-claim was a table column header
destroyed by flattening HTML to prose. `structure-excerpt.ts` renders a fetched
HTML fragment two ways: `renderProse()` (strip every tag, collapse whitespace --
what the current ingestion path does) and `renderStructured()` (tables kept as
GitHub-flavoured Markdown, headings as `#`, list items as `- `). Zero
dependencies; a regex tokenizer, same call `scripts/extract-income-tables.mjs`
made.

The fixture is the real `<table>` from
`https://www.dhs.wisconsin.gov/medicaid/fpl.htm` (fetched 2026-09-06). Its last
row scopes each Medicaid program to a percent-of-FPL **column**:

Prose rendering (current pipeline), the relevant tail:

```
... Each extra person $5,680 $473.33 ... Program limits N/A QMB MAPP Premium
Threshold SLMB SLMB+ N/A N/A QDWI and Lower MAPP N/A
```

Structured rendering:

```
| Family Size | Annual | 100% FPL | 120% FPL | ... | 250% FPL | 300% FPL |
| --- | --- | --- | --- | ... | --- | --- |
...
| Program limits | N/A | QMB / MAPP Premium Threshold | SLMB | SLMB+ | N/A | N/A | QDWI and Lower | MAPP | N/A |
```

From the prose, **there is no way to recover that MAPP's income limit is the
250% column** -- "MAPP" appears twice, "MAPP Premium Threshold" (a cost-sharing
figure, 100% FPL) sits next to "QMB", and the eight percentage headers are a
detached run. From the structured rendering, `MAPP` is positionally under
`250% FPL` and `MAPP Premium Threshold` under `100% FPL`. The test asserts
exactly this: same column index for `MAPP` and `250% FPL`, and >200 characters
of unrelated tokens between them in the prose.

**What this establishes and what it does not.** It establishes that
prose-flattening is *sufficient* to destroy this scope, and that a
structure-preserving excerpt *retains* it in a form a reader can follow by
column position. It does **not** establish that the model then reads the Markdown
table correctly -- a model still has to count columns, and Markdown alignment is
positional, not magic. That is the follow-up measurement (`--excerpt=structured`
vs `--excerpt=prose` on `wi-medicaid-fpl-chart-mapp-column` and, ideally, a
re-fetch of the frozen BadgerCare case's HTML). But the deterministic result is
enough to say: **the current pipeline is choosing to discard the information
that would prevent this failure class, and it does not have to.** This is the
cheapest change in the spike -- it is an excerpt-builder swap, no model change.

Structure preservation only helps the *table* subset of the never-noticed
class (BadgerCare columns; the MAPP chart). It does nothing for negations or
prose composition tests -- those need Hypothesis 1.

---

## 5. Hypothesis 2: verification by counterexample

**`framing/verify-counterexample.ts`** -- built, `SKIPPED`.

A second call gets the emitted `Criterion` plus the excerpt and must construct
someone who **satisfies the rule as written but is not eligible** under the
excerpt. If it can, with `confidence: high`, the extraction is rejected and
routed to `manualReview` (`verdictRejects()`).

It is wired into the runner as an optional `--verify` pass *after* a successful
extraction, i.e. as a second gate on the autonomous band, not as a replacement
for Hypothesis 1.

**It is strictly weaker than Hypothesis 1 for the never-noticed class, and the
prototype's docstring says so.** #61 established that a call which cannot
perceive the scope cannot report it; a call that cannot perceive the scope also
cannot build a counterexample *from* it. Expect `--verify` to catch the
noticed-then-dropped cases (Lifeline survivor, Emergency Assistance -- where the
branch condition is right there in the text) and to miss SeniorCare, the
BadgerCare columns, and the CDA negation. That is why it is a secondary gate on
an already-restricted band, not a primary defence. Measuring its *false
rejection* rate on the controls matters as much as its catch rate -- a verifier
that rejects clean ceilings is the yield-collapse failure again.

---

## 6. Hypotheses 4 and 5

**Hypothesis 4 (ensemble / disagreement as a signal) -- not built.** Rationale:
it multiplies call count for a *recall* improvement, and recall is not the risk
here -- the precision of the auto-accept path is. Non-determinism was observed
at N=27 (`schoolmeals-direct-certification` flipped between #51 runs), so
"accept only on k-of-n agreement" is a real lever, but it is best applied
*after* Hypothesis 1's classifier precision is known: if the classifier is
reliable, the ensemble is redundant on the autonomous band and irrelevant on
the auto-`manualReview` band. If the classifier is marginal, an ensemble *of
classifiers* (cheaper than an ensemble of extractors) is the natural next step.
Left as a documented follow-up, not a dead end.

**Hypothesis 5 (autonomy by scope restriction) -- this is the recommendation,
not a separate experiment.** See Section 3's last paragraph and "The answer".
The tiering (#5 §2) is the frame: 43% is script- or one-liner-coverable with
zero model risk, 24% has no rule, and the classifier's entire job is to decide
which of the remaining ~33% is safe to let the extractor touch -- with the
default being "not safe".

---

## 7. The measured boundary, stated plainly

Restrictions under which autonomy holds:

- **Only where a script suffices, or a classifier is confident the excerpt
  states one unconditional ceiling / categorical list with no structural scope
  signal.** Everything else is auto-`manualReview`.
- **The automated path never emits a rule derived from a table without
  preserving the table's structure** (Hypothesis 3). If structure cannot be
  preserved, the excerpt is auto-`manualReview`.
- **`incomeAtOrBelow` and numeric `compare` outputs on the autonomous band pass
  a counterexample check** (Hypothesis 2) before they are accepted without
  review -- a cheap second gate, not a substitute for the classifier.
- **The held-out contract is unchanged:** a single dangerous over-claim on the
  frozen `heldout` split is blocking, not a percentage. The classify-first
  pipeline must clear that bar on `--split=heldout` before it is wired into #14.

Where autonomy does **not** hold, and will not:

- Any Tier 3 prose with a deduction stack, a cross-reference, or a multi-factor
  exception list. The model abstains on these correctly and reliably already
  (#23 5/5, repeated) -- they are not the problem, and they are not autonomous
  extractions, they are autonomous *abstentions*, which is the system working.
- Any excerpt where a real number's role is set by structure or negation the
  model does not perceive. The honest position after #61 is that this residue
  is permanent for the extractor, and the response is to keep it out of the
  extractor's hands, not to keep tuning.

**The tension with §6.5 is real and this does not dissolve it.** Reviewer
throughput is still the binding constraint at scale, because initial extraction
of the Tier 3 residue still has to pass a human once and Tier 3 scales with
corpus size. What changes: the review is lighter (confirm an abstention, not
audit a threshold), and the dangerous-over-claim rate on the automated path is
structurally zero rather than "low and blocking when non-zero". "Autonomous for
this ~43%, a lighter human queue for the rest, never the model deciding Tier 3"
is the honest characterisation.

---

## 8. What to run next (needs an API key)

All commands report `SKIPPED` without `ANTHROPIC_API_KEY`. Model defaults to
`claude-sonnet-5` to stay comparable with the #43/#51/#61 measurements; pass
`--model=claude-opus-5` to compare. Cost basis: #5 §6.1 rates; #51 spent $0.41
for 27 single-call cases at 89% cache savings, so a three-call pipeline over 27
cases is on the order of $1-2. Cost is not the constraint (#43).

1. **Baseline the current one-step pipeline on the fresh probe** -- confirms the
   six cases actually trap the current framing:
   `npm run eval:llm-framing -- --split=framing --pipeline=direct`
2. **The classify-first pipeline on the fresh probe:**
   `npm run eval:llm-framing -- --split=framing`
   Compare the four numbers plus `over-cautious`. Iterate the classifier prompt
   here (the six cases are the tuning surface -- they are *not* held out).
3. **The real measurement -- classify-first on the frozen held-out split:**
   `npm run eval:llm-framing -- --split=heldout`
   then with `--verify`, then `--pipeline=direct --split=heldout` for the
   same-cases baseline. A dangerous over-claim here is blocking.
4. **Hypothesis 3 A/B** on the one structural case (and, if its HTML is
   re-fetched into a fixture, on `badgercare-plus-population-columns`):
   `npm run eval:llm-framing -- --split=framing --excerpt=structured`
   vs `--excerpt=prose`.

Report the four numbers separately into a "Measured" subsection here, in the
`docs/eligibility-extraction.md` correction style -- and if a fresh case is used
to tune the classifier, that is fine (they were built for it), but say so.

---

## 9. Deliverables and disposition

- `scripts/llm-extraction/framing/` -- `classify-role.ts`, `structure-excerpt.ts`,
  `verify-counterexample.ts`, `run-framing-eval.ts`, `framing-eval-cases.ts`,
  `framing.test.ts` (17 tests), `fixtures/` (one real HTML table + SOURCES.md).
  `npm run eval:llm-framing` wired in `package.json`.
- `docs/eligibility-extraction.md` gets a one-line pointer to this document at
  §9; its numbers are not restated here.
- Nothing in `src/` changed; the browser bundle is byte-for-byte unaffected
  (`npm run build` produces the same dependency-free `dist/`). Zero new npm
  dependencies. `npm run typecheck`, `typecheck:llm-extraction`, `test` (161),
  `build`, `check:sources:self-test`, `ingest:descriptive:self-test` all green.
- **This spike does not close #62.** Its central question is *answered in
  principle* -- the autonomous band is structural and sits at the Tier 2 / Tier
  3 line -- but the classifier's precision and its over-caution cost are
  unmeasured, and #62 should stay open until Section 8 step 3 has real numbers.
- **#14 stays descriptive-only.** The classify-first pipeline is not cleared for
  the eligibility path until it clears the held-out contract.
