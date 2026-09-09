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

## 3. Hazards measured at real cost

Each of these was learned expensively. A design that does not have an answer for
them is not ready to be built.

### 3.1 Branch-dropping — the failure nothing solved

**A number in the source is treated as the rule, and the branch that governs it
is dropped.** The result is often a rule *narrower* than reality: it silently
tells someone not to bother applying.

*number*, *source*, *rule* and *branch* are terms of art here and are defined in
[`standing-decisions.md`](standing-decisions.md), "The words" — which also lists
the shapes a branch actually takes in a published source, drawn from the cases
below.

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

### 3.2 Retrieval failure wears safety's clothes

One run measured zero dangerous results and was reported as safety solved. It
was not: the extractor had abstained on six records it could not fetch, and
those were the hard ones. Fixing retrieval took the honest number 0 → 3.

**Therefore: never report a harm count without a yield count beside it.** A run
that abstains is not a run that succeeded.

### 3.3 A coverage metric must count decidable answers

The generalised form of the above, and the trap any replacement will fall into
on day one. If "produced output" counts an abstention as a success, the metric
rewards refusing to answer and a degenerate run scores perfectly.

Count records with **at least one decidable, non-abstaining condition.** Report
it first, because every other number is only meaningful in proportion to it.

### 3.4 Abstain per condition, never per record

The correct output for most hard cases is `allOf(cleanRule, manualReview(rest))`
— encode what maps, abstain on what does not. The retired seam could express
only a whole rule or nothing, so partial successes were discarded along with the
descriptive fields that came with them. Any replacement must be able to emit a
partial rule from the start; this is not a later refinement.

### 3.5 A small corpus will mislead you

The "~17% LLM ceiling" that drove three redesigns was an artefact of a
hand-picked excerpt set. The tiering built on it was wrong too — three sources
were classified as prose because someone read an excerpt instead of the page.
Measure against a corpus wide enough that a handful of hard cases cannot
dominate it, and re-derive any taxonomy rather than inheriting the retired one.

### 3.6 Never report a number you did not measure

A harness with no API key must report SKIPPED, never a fabricated or default
result. An entire spike once shipped with zero measurements because `.env` was
absent from an agent worktree and nothing said so.

Held-out discipline: build, freeze, run once, report. Fixing failures and
re-running measures the fix, not the design.

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
