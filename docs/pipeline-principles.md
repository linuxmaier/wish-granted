# Pipeline principles

**There is no pipeline.** The one built through 2026 was unwound on 2026-09-08
(#97). This document is what the next attempt inherits: what it would be for,
what it may not do, what has already been measured at real cost, and what is
genuinely still open.

**It deliberately does not describe an architecture.** Four were designed
against 17 records and a scoreboard that could not see half the harm, and the
corpus expansion now underway exists precisely because nobody yet knows the real
distribution of rule shapes we are up against. Designing a fifth before that
evidence lands would repeat the error this document is the residue of.

This file carries mechanism and open questions. The *argument* for any principle
below lives in [`standing-decisions.md`](standing-decisions.md) — see
[`AGENTS.md`](../AGENTS.md) for the routing rule.

---

## 1. What a pipeline here is for

Not "automate record authoring." The goal is **reach**: a person in crisis
opening this app should find the programs they could actually get, and adding 
more records makes more matches. A pipeline is one possible means to that end, and it
competes with simply authoring more records by hand, which is the current approach.

The unit of work is **a program, not an excerpt**: given a source, produce a
record that could be added to our set, or say honestly that you cannot. Anything that
measures a narrower task measures something nobody wants performed.

A pipeline earns its place when it makes a reviewer faster than they would be
starting from a blank record. That is the bar. It is not "is the extraction
good" — it is "does this save a person time they would otherwise spend reading
the page themselves."

## 2. Non-negotiables inherited from the product

These are not pipeline decisions and are not open here. See
[`CONTRIBUTING.md`](../CONTRIBUTING.md).

- **No answers ever leave the browser.** Whatever a pipeline does happens at
  build time, never at runtime. It may not introduce a runtime network call, a
  runtime dependency, or a per-user request.
- **Never invent data.** Every figure, phone number, URL and rule comes from a
  source that was actually fetched.
- **`lastVerified` means a person read the source on that date.** A machine
  cannot set it. This is the single hardest constraint on any automation, and it
  is deliberate.
- **A pipeline proposes; a human disposes.** Never auto-merge an eligibility
  change, at any measured quality level.
- **When a rule is genuinely uncertain, leave it `unknown`.** It lands in "might
  qualify", which is the honest answer.

## 3. Hazards

Each of these cost real time or money to learn. **They are split into what was
measured and what someone inferred from it**, because this project's most
expensive recurring mistake is reading the two as one block — a list headed
"not up for re-litigation" that mixes a measurement with somebody's reasonable
call, and so stops the next reader considering an option that would have helped
(`AGENTS.md`, "How work goes wrong here").

Disagree with an inference freely: it is a reading, not a result, and the
measurement underneath it stands on its own. Where an inference would rule a
direction out, it carries a condition for reopening it — a judgment without one
is not finished being written.

### 3.1 Branch-dropping

**A number in the source is treated as the rule, and the branch that governs it
is dropped.**

*number*, *source*, *rule* and *branch* are terms of art here and are defined in
[`standing-decisions.md`](standing-decisions.md), "The words" — which also lists
the shapes a branch actually takes in a published source, drawn from the cases
below.

**Measured** — six cases, across four designs:

| Case | Number taken | What it actually was |
|---|---|---|
| `seniorcare-coverage-levels` | 160% FPL | a cost-sharing tier; there is no income ceiling |
| `badgercare-plus-population-columns` | 201/306% FPL | scoped by a table column header |
| `snap-cfr-elderly-separate-household` | 165% FPL | a household-composition test |
| `lifeline-survivor-extended` | 200% FPL | a survivor-only extended branch |
| `headstart-cfr-over-income-allowance` | 130% poverty | a capped discretionary allowance |
| `foodshare-snap-wi` | an income ceiling | SSI/W-2 recipients are eligible **regardless of income** |

`foodshare-snap-wi` is the fully characterised one and the best test case: the
verified rule is `allOf(livesIn.wisconsin, anyOf(incomeAtOrBelow('fpl', 200),
hasAnyOf('currentBenefits', ['ssi','w2-tanf'])))`. Every failing design emitted
the income ceiling alone, which rules out someone on SSI above 200% FPL whom the
program accepts.

**Inferred** — that these six are one failure class rather than six unrelated
bugs, and that the resulting rule tends to come out *narrower* than reality.

*Reopen if:* a wider corpus turns up numbers lifted out of their scope in the
looser direction about as often. The shared shape would still hold, but
"narrower" would stop being the useful half of the description.

**Deliberately not asserted: why it happens.** Explanations were offered at the
time and are preserved in #97 and the archived research. None was tested against
an alternative, so none is recorded here as a cause — and a plausible diagnosis
written into this document would function as a prohibition on the directions it
seems to rule out. Whatever is tried next should be judged on what it does to
the six cases above, not on whether it resembles something that failed before.

### 3.2 An abstention can look like a safe answer

**Measured.** One run reported zero dangerous results. The extractor had
abstained on six records it could not fetch. After retrieval was fixed, the same
measurement returned three, on three of those same records.

**Inferred** — that the zero was produced by the retrieval failure rather than
by any property of the design.

**The reporting rule this earns**, which holds either way: never report a harm
count without a yield count beside it. A run that abstained has not been
measured.

### 3.3 A coverage metric must count decidable answers

**Not a measurement — a property of the metric.** If "produced output" counts an
abstention as a success, refusing to answer scores perfectly and the number stops
meaning anything.

Count records carrying at least one decidable, non-abstaining condition, and
report that before any harm count, since harm counts are only meaningful in
proportion to it. (*decidable*, *coverage* and *yield* are defined in
[`standing-decisions.md`](standing-decisions.md), "The words".)

**Judgment: where the floor sits.** The retired benchmark used 25%, picked as
"low enough that falling below it means something is broken" rather than as a
quality target. Any new floor is a fresh judgment — re-derive it rather than
inheriting that number.

### 3.4 Abstain per condition, never per record

**Measured.** Hand-authored records already take the shape
`allOf(cleanRule, manualReview(rest))` — `madison-housing-choice-voucher.ts` and
`wisconsin-shares-child-care.ts`. The retired seam could express only a whole
rule or nothing, so a partial success was discarded along with the descriptive
fields that came with it.

**Inferred** — that this shape is common enough that a replacement should be
able to emit it early rather than bolt it on later.

*Reopen if:* the wider corpus shows partial rules are rarer than the current
records suggest. Twenty-one records establish that the shape occurs, not how
often.

### 3.5 A small corpus will mislead you

**Measured.** The "~17% ceiling" did not reproduce when the same cases were
worked with access to the whole page. Three sources were reclassified as
structured once someone read the page rather than the excerpt they had been
handed.

**Inferred** — that the ceiling was an artefact of the excerpt rather than a
limit on capability.

**The practice this earns:** re-derive any taxonomy against the corpus in front
of you. The retired tiering percentages were computed from the excerpt reading
and are not carried forward.

### 3.6 Never report a number you did not measure

**Measured.** A spike shipped with zero measurements because `.env` is
gitignored and therefore absent from an agent worktree, and nothing said so.

**The rules this earns.** A harness with no API key reports SKIPPED, never a
fabricated or default result. Held-out discipline: build, freeze, run once,
report — fixing failures and re-running measures the fix, not the design.

## 4. What survived, and what it does not imply

[`scripts/lib-source/`](../scripts/lib-source/README.md) holds the source-access
tools: fetch, robots, browser render, form-shell recovery, structure-preserving
HTML, PDF reading, site-scoped search, URL recovery, text normalisation, the
Anthropic client. They are kept because reaching a source is a capability any
approach needs — including a human researching records by hand, which is their
present use.

**Their existence is not an architectural commitment.** Tools that encoded a
design bet were deleted deliberately: the agent loop, the tool definitions, the
provenance-span gate, and `askable-facts.ts`, which constrained extraction to
the interview's current vocabulary — the circular reasoning #88 rejected.

## 5. Open questions the corpus work should answer

Not rhetorical. These are the things we do not know, and the reason no
architecture is specified here.

1. **What shapes do real eligibility rules actually take?** Across a sufficiently 
   broad corpus, how often is a rule a clean threshold, a
   disjunction of categorical routes, a table scoped by a column, a
   cross-reference, or prose that no engine can encode?
2. **Does the fact vocabulary need to change?** `isVeteran` and `hasDisability`
   are reserved on reasoning that #88 already discredited elsewhere. The corpus
   work is the moment to settle it with evidence.
3. **Is deterministic parsing worth rebuilding?** It was cheap and honest, but
   its premise was a tiering we no longer trust. If a large share of new sources
   publish clean structured tables, that answer changes.
4. **Is there any mechanism that catches branch-dropping?** 
5. **What does a reviewer actually need?** Nothing ever produced a
   reviewer-facing artefact — candidate rule, provenance, the diff against the
   existing record — so the throughput assumption underneath the whole
   programme was never tested against a real reviewer.
6. **Does a stronger model change the failure?** The characterised failure is
   *misunderstanding what a number governs* — reasoning, not retrieval — and
   cost is not the constraint. No stronger model was ever measured.

## 6. Before building anything

Read [`standing-decisions.md`](standing-decisions.md) first, and #97 for what
was tried. Then propose the smallest thing that answers one of the questions
above — not a pipeline.

A judgment recorded here without a named condition for reopening it is not
finished being written; that rule applies to this document too.

**This document has not been ratified.** It is a first pass, and #98 is the
review that settles it. Treat anything here as provisional until that closes.
