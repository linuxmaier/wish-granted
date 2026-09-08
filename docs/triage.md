# Triage (issue #68)

The routing step between deterministic parsing and the agentic extractor. It
answers one question per source:

> **Does this source state eligibility at all, and if so is it worth an
> extraction attempt?**

Three outcomes:

| route | meaning | cost |
|---|---|---|
| `deterministic` | the Tier-3 parser (`scripts/tier3-extract`) already produced a scoped rule | zero tokens |
| `agentic` | a rule is published but the deterministic path cannot reach it — a subpage, a linked PDF, a table-column scope, a cross-reference | one agentic run |
| `no-rule-published` | the source itself declines to state a rule (Tier 4 of [`eligibility-extraction.md`](eligibility-extraction.md) §2) | zero tokens, `manualReview` |

It lives in `scripts/triage/` and **calls no model** to produce the routing
table. An optional live classifier exists (below) and is used only to
second-guess one route.

---

## The failure mode this must not become

Classification is the one thing the model has been reliably good at across this
programme — #64 measured 21/21 correct abstentions, 0 dangerous over-claims. But
#63 reached 0 dangerous by routing **27/27** to `manualReview`: safe, useless,
expensive to discover late. **A triage layer that sends everything to
`no-rule-published` is that failure in new clothing.**

So the routing distribution is reported explicitly (`npm run extract:triage`)
and `lib/report.ts` raises a **degenerate-outcome warning** when
`no-rule-published` takes more than half the corpus — the same guard
`scripts/cross-check` uses for its agreement rate. The surveyed corpus is ~24%
Tier 4 (§2); anything near 50% means the router is dropping sources that publish
a rule.

## The asymmetry that drives the design

**A false `no-rule-published` is a silent loss** — the program is never
extracted, no human sees it, nothing signals the miss. **A false `agentic`
costs a few cents and produces a visible abstention.**

So when the evidence is mixed, triage routes to `agentic` and marks the decision
`uncertain: true` (reported, so the bias is visible). The bar for
`no-rule-published` is deliberately high: the parser found nothing usable **and**
a no-rule signal fired **and** no rule-present signal competes with it.

---

## How a route is decided (model-free)

1. **Parser extracted** → `deterministic`.
2. **Parser abstained with a "rule is present" code** — `COST_SHARING_TIER`,
   `UNDECIDABLE_COCONDITION`, `EXCEPTION_ALLOWANCE_BRANCH`, `DEDUCTION_STACK`,
   `MULTI_POPULATION_TABLE`, `CROSS_REFERENCE_TREE`, … (from
   `scripts/tier3-extract/classify.mjs`). The parser located an eligibility
   figure it could not cleanly scope, so a rule is definitely published →
   `agentic`.
3. **Parser found nothing** (`NO_RULE_STATED` / `NO_ELIGIBILITY_CONTEXT`, or not
   run). `lib/signals.ts` scans the source's meaningful text
   (`scripts/check-sources/lib/normalize`) for two signal kinds, each quoting the
   governing span the way `classify-role.ts`'s scope-signal detection does (#64):
   - **rule-present**: a quantified income limit, a categorical enrolment route,
     "you must be…", "to qualify…", an age band, "low-income families".
   - **no-rule**: "not an application", "no guarantee", "no income test", "no
     documentation required", "open to anyone", "referral service", "no
     eligibility requirements".
   - A no-rule hit and **no** rule-present hit → `no-rule-published`.
   - Otherwise → `agentic`, `uncertain: true`.

`"the only way to know is to apply"` is **not** a no-rule signal — BadgerCare
Plus says exactly that and publishes an income + age rule. Treating it as Tier 4
is the silent-loss error.

## "Unextractable" vs "unextractable *with the current vocabulary*"

When the parser abstains on a co-condition it cannot represent
(`UNDECIDABLE_COCONDITION`), `lib/vocabulary.ts` checks whether that condition is
on a **reserved** fact — `RESERVED_FACT_KEYS` in `src/domain/facts.ts`, read at
module load, never hardcoded (this is what let #89 move `age` out cleanly: a
source gated only on age is now extractable, not a gap). A reserved-fact gate is
recorded as a `vocabularyGap` naming the fact. The source still routes to
`agentic` (extract the income branch, `manualReview` the reserved gate), but per
[`data-authoring.md`](data-authoring.md) ("When a fact earns a question") this is
a **candidate question**, not a dead end: a fact earns a question when it unlocks
programs worth including.

The offline corpus currently produces **no** vocabulary gaps — no source is
blocked purely by a fact the interview cannot ask.

---

## The optional live classifier

`lib/classify-source.ts` — a single fresh model call, one tool, one turn,
extending `classify-role.ts`'s scope-signal idea. It answers "does this page
state an eligibility rule, or decline to state one?" with a numeric
`confidenceScore` (0–100). **The categorical `confidence: 'low'` form that
`classify-role` shipped was measured miscalibrated and is not reintroduced.**

It is consulted **only** when the model-free evidence already points at
`no-rule-published` — the one route with a silent-loss failure mode — and it can
only ever move a source **to** `agentic` (rescue it), never the reverse. With no
`ANTHROPIC_API_KEY` it throws `MissingApiKeyError` and the entrypoint reports
**SKIPPED** — never a fabricated result.

## Is the model needed for triage at all?

**Largely not.** The deterministic parser's outcome plus the signal scan resolve
every source in the offline corpus with no model call. The parser's abstention
reason codes do most of the work — they already distinguish "found a figure it
can't scope" (→ `agentic`) from "found nothing" (→ signal scan). The model's only
job is a veto on the `no-rule-published` route, and even there its influence is
one-directional. If the live run confirms the offline table, the cheapest route
is the default and the LLM is essentially out of triage.

---

## Running it

```
npm run extract:triage                 # model-free routing distribution + SKIPPED live
npm run extract:triage -- --verbose     # + per-record evidence quotes
npm run extract:triage:self-test        # offline: all three routes + the degenerate guard
```

### Offline corpus

- **10 records** cite a source with a committed, real, dated Tier-3 capture
  (reused from `scripts/cross-check/lib/corpus.ts`). The real parser runs against
  them.
- **4 community-org records** (Tenant Resource Center, Dane JFF, 211, Second
  Harvest) get a **reconstructed** Tier-4 fixture built from the program record's
  verbatim `source` note — see `scripts/triage/lib/__tests__/fixtures/SOURCES.md`.
  Not a live capture; the live run is what confirms them.
- **3 records** (The River, MadCAP, Section 8) have neither — their route is
  predicted, not measured.

The plug into `scripts/program-benchmark` (#66) is the shared `Extractor` seam,
same as the deterministic and agentic paths: a triage-aware extractor dispatches
on the route.
