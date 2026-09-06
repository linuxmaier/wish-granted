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
