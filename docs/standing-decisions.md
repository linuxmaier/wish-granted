# Standing decisions

The single home for design principles: what is settled fact, what is a judgment,
and when a judgment should be reopened. Read this before proposing — or refusing
to propose — a change to how program data is found, extracted, or shipped.

## Where authority lives

Principles were previously argued in six or seven places at once — a docblock
here, a doc section there, an issue comment somewhere else — each with its own
partial retelling. That is how the project ended up asserting two different
"worst failures" in the same repo, and how a judgment about which harm matters
came to be enforced in code that nobody read as a policy statement.

One rule fixes it:

| Where | Carries | Never carries |
|---|---|---|
| [`AGENTS.md`](../AGENTS.md) (aliased `CLAUDE.md`) | The entry point: the two grounding principles, and this routing table. | Detail of any kind. |
| [`CONTRIBUTING.md`](../CONTRIBUTING.md) | The product's promises, and how to work here. | Anything with a revisit condition. |
| **This file** | Every design principle and judgment: the statement, the reason, the reopen condition, and the record of what changed. | Mechanism. How something is implemented. |
| Mechanism docs (`design.md`, `program-benchmark.md`, `data-authoring.md`, `triage.md`, …) | How a thing works, and how to use it. | The *argument* for a principle. State it in a line and link here. |
| Code and tests | The rule, in one line, with a link here. | Justification, history, or a retelling of why the rule exists. |
| Git history and issues | What changed, when, and the full argument at the time. | — |

**A principle is stated once, here. Everywhere else links.** If you find
yourself explaining *why* a rule exists in a code comment, the explanation
belongs in this file and the comment belongs at one line.

---

## The two harms

**A wrong eligibility rule reaches a real person in one of two directions, and
they are not the same harm.**

| | What the person is told | What it costs them |
|---|---|---|
| **Over-claim** | "You qualify" when they do not | A morning, a bus fare, a stack of documents, a rejection at the counter — and their trust in this tool, which is what pays for every *later* suggestion it makes |
| **Under-claim** | "You are ruled out" when they qualify | Help they never hear about |

**Over-claim is worse.** The wasted trip is paid immediately and the lost trust
compounds; a missed program is at least still reachable through 211 and the other
fallbacks the app ships.

**"Worse" is not "infinitely worse."** The ranking breaks ties in a genuine
trade-off. It is not a licence to drive over-claim to zero by refusing to state
any rule — a pipeline that abstains on everything has zero over-claims and is
worth nothing to anybody.

**Most of the apparent dilemma is not real.** The app has a third bucket. "Might
qualify" is not a wrong answer in either direction, so the ranking only binds
when choosing between `eligible` and `ruledOut` — a much narrower set of
decisions than it is usually invoked for. In particular it does **not** bind on
whether a program belongs in the corpus at all: a record that abstains cannot
tell anyone they qualify, so caution about *including* a program buys no safety
and costs reach.

Measured by `scripts/program-benchmark/` — see
[`program-benchmark.md`](program-benchmark.md) for how.

### The words, because they have meant three different things

"Over-claim" and "under-claim" are used in this repo with three distinct senses,
which is most of why the harm ranking stayed confused for so long. **The
definitions above are the ones that govern.** The others are legacy and appear
in text that should not be rewritten:

| Where | "Over-claim" there means | Note |
|---|---|---|
| **Here, and `scripts/program-benchmark/`** | The rule says "eligible" where the truth is not | **Authoritative.** |
| #51, #61, #63, #92, and the extraction docs | The extractor claimed a rule it could not support — which usually, but not always, produced a rule *narrower* than reality | Dated measurement records. Read `dangerous` there as **under-claim**; do not rewrite them. |
| The eval system prompt (`scripts/llm-extraction/run-eval.ts`) | Asserting any rule rather than abstaining | Coherent on its own terms and consistent with the position above. **Frozen** — changing it would invalidate the #43/#51 baselines. |

When writing something new, say which direction you mean in the same sentence:
*"tells someone they qualify when they do not"* is unambiguous and costs six
extra words.

## Abstain per condition, never per record

When part of a program's eligibility cannot be mapped into the interview's fact
vocabulary, **encode everything that can be mapped and abstain only on the part
that cannot.** A `manualReview` leaf sits inside the rule alongside real
criteria; it does not replace them.

A record whose income test is clean but whose work requirement is not should
still rule people in and out on income. Collapsing it to "geography, plus a
shrug" throws away information we have and pushes a program into "might qualify"
for everyone — which is the under-claim harm, arrived at by way of caution.

Two consequences:

- The engine already works this way: `manualReview` always evaluates `unknown`,
  so a partial rule can `fail` on a mapped criterion (ruled out, correctly) or
  sit at `unknown` (might qualify), but can never `pass` while an abstention is
  live. `madison-housing-choice-voucher.ts` and `wisconsin-shares-child-care.ts`
  are the worked examples.
- **The reason for the remaining uncertainty must be shown prominently** where
  the program appears, not buried in a disclosure. A person looking at "might
  qualify" needs to know what would settle it.

Neither is built yet: the `Extractor` seam cannot express a partial result
(#94), and the note is currently buried in a disclosure (#95).

## When a fact earns a question

**A fact is worth asking when it unlocks programs worth including.** The test is
coverage, not whether a rule already in the dataset happens to reference it.

The rule this replaced (#88) was the opposite — *"no current rule needs this, so
asking is pure friction"* — and it is circular: a fact stays unasked because no
rule needs it, and no rule can need a fact the interview never supplies. Held
that way the vocabulary can never grow and the dataset caps itself at whatever
facts it started with. `age` sat unasked under that reasoning while SeniorCare,
the Medicare Savings Programs and Homestead Credit waited behind it, and
`badgercare-plus` carried its 0–64 bound as caveat prose the engine never
evaluated.

Friction is still a real cost, weighed per fact:

- **A question is expensive.** It is a screen for someone who may be in a
  crisis. Prefer extending an existing question; keep a new one on its own
  screen so `flow.ts` can drop it when nothing undecided needs it.
- **Ask for the least the rules need.** `age` is a band, not a number: every
  age-gated rule needs a boundary, and a band reads as a life-stage question
  rather than an ID check.
- **Marginal cost, not raw frequency, is the test.** A fact that gates only one
  program but rides inside an existing checklist costs nothing extra to ask.
  Demoting it to a caveat would not shorten anyone's interview — it would only
  cost the engine the ability to resolve that program either way. Issue #9
  worked the corpus counts through and reached this conclusion; the numbers are
  in [`design.md`](design.md).
- **The coverage argument can lose.** See `citizenshipStatus` in the table below.

Mechanically, adding a fact is a three-step change enforced by
`tests/data/vocabulary.test.ts`; the procedure is in
[`data-authoring.md`](data-authoring.md).

---

## Facts — settled, do not re-derive

Measurements, or hard properties of an API or a data source. Cite them; do not
re-run them without a specific reason to think they have changed.

| Fact | Source |
|---|---|
| `strict: true` cannot be used for `Criterion` extraction — a recursive expression language exceeds the grammar-compilation limits. Dropping it is required, not preferred. | #5 §4.5 |
| Grants.gov indexes discretionary grants **to organizations**, not benefits to individuals. Wrong corpus. | #4 |
| Open Referral / HSDS has no eligibility entity — its core objects are `organization`, `service`, `location`, `service_at_location`. It is directory data. | #4 |
| WI state sites return 403 to naive fetchers while their `robots.txt` is permissive. Use a normal browser user-agent; a 403 is not a crawl prohibition. | #5 §1 |
| Token cost is negligible against reviewer time — 27 cases at $0.25, a 152-call agentic run at $8.39. **Cost is not the constraint on any design in this repo.** | #5 §6, #64, #67 |
| Three change-detection signals were measured and rejected. | #5 §5 |
| The schema gate catches malformed output. It cannot catch a well-formed, semantically wrong rule. | #51 |
| Of the surveyed corpus: ~43% Tier 1+2 (script-coverable), ~33% Tier 3 prose, ~24% Tier 4 (no rule published). | #5 §2 |
| No government or directory source surveyed publishes eligibility as structured data. PolicyEngine US is the one adjacent exception, and covers federal programs only. | #4 |
| Routing at the excerpt level is all-or-nothing: any scope signal sends the *whole* excerpt to `manualReview`, so the current pipeline structurally cannot produce the partial `allOf(cleanRule, manualReview(rest))` shape that real records need. | #62 spike, "The ceiling, characterised" |

---

## Standing decisions — reopen when the named condition holds

| Decision | Why | **Reopen when** |
|---|---|---|
| **Never auto-merge an eligibility change.** A pipeline proposes; a human disposes. | A wrong threshold reaches a person in crisis as a stated fact. | Not on current evidence. Revisit only after ≥3 independent held-out runs show zero over-claims *at a yield above the floor* — never on a run that bought its safety by abstaining. |
| **Both harm directions block, and over-claim ranks worse.** See "The two harms". | Stated above. | The ranking is the product owner's and is stable. What should move is the yield floor (`MIN_USABLE_RULE_RATE`) — raise it as the pipeline improves. Never lower it to make a run pass. |
| **Abstention is per condition, not per record.** See "Abstain per condition". | Stated above. | Stable as a principle. The support is open work: #94 (seam cannot express a partial result), #95 (the reason is not shown), and excerpt-level routing cannot produce one (see Facts). |
| **`eligibility` extraction is worth automating.** | Epic #65. | Supersedes the older "should stay hand-authored for the foreseeable future" position. If #92/#93 conclude the automated path cannot clear the yield floor without over-claiming, this flips back and the epic closes — say so plainly rather than iterating a fifth architecture. |
| **`citizenshipStatus` stays unasked**, and immigration status is never encoded as a rule. Affected programs carry a plain-language caveat and stay in "might qualify". | It genuinely affects federal food benefits, but the rules are dense with exceptions — children frequently qualify when adults do not — and a rules engine that got them slightly wrong would tell a family they are ineligible when they are not. This is the "coverage argument can lose" case: applied honestly per fact, here it loses. | This argues against **exclusionary** rules on that fact, not against the fact itself. Reopen the moment a program is found that the fact would let us *include* someone in — refugee- and immigrant-specific assistance is exactly the under-served case. Asking it and only ever using it to widen a match has never been evaluated. |
| **`employmentStatus` stays unasked.** | The friction of asking is not yet bought back by the coverage it would unlock. | Same test as any other fact — see "When a fact earns a question". Nobody has re-run it since #9. |
| **`isVeteran` and `hasDisability` stay reserved.** | Their categories were deferred in the original brief. | Now. The deferral was circular in the way #88 rejected. Run the #88 coverage test: does asking unlock programs worth including? Health/disability is plausibly the largest under-served category for this audience. |
| **211 Wisconsin and findhelp.org are not fetched.** | robots.txt (findhelp); no confirmed access path (211). | The robots.txt finding stands. The reasoning about 211 partly rested on HSDS carrying no eligibility data — no longer disqualifying, since a directory entry still yields a real record. Reopen the access-path question on those terms. |
| **PolicyEngine US is a future cross-check, not a dependency.** | Open questions: AGPL implications, and whether it scores partial inputs. | Now. Both are answerable in an afternoon and neither has been attempted. [`eligibility-extraction.md`](eligibility-extraction.md) §7 already notes that consulting parameter values at build time differs materially from redistributing or embedding. |
| **`claude-sonnet-5` is the extraction model.** | Continuity with the eval baseline that priced the cost model. | Now. The characterised failure class is *misunderstanding what a number governs* — reasoning, not retrieval — and cost is not the constraint (see Facts). No stronger model has been measured. Do that before designing a fifth architecture around this one's limits. |
| **The excerpt benchmark is retired as the primary measure.** | It measures a task nobody wants performed. | Stable. Kept as a narrow-skill regression check. |
| **Ship the whole corpus to every client.** | The privacy property: what the client requests must not depend on the user's answers. | At roughly 1,000 programs (~460 KB gzipped). Split by content type first, by state second; never by county, never by an answer. See #1. |

---

## Decisions that changed

Kept short and here, so no other file has to carry it.

- **2026-09-08 — the harm ranking was inverted, and half of it was unmeasured.**
  `dangerous.ts` defined "dangerous" as a rule *narrower* than reality and stated
  that a looser rule was "not dangerous by definition", so the benchmark could
  not see an over-claim at all. `CONTRIBUTING.md` asserted both orderings in
  adjacent constraints. Four extraction architectures were designed against that
  scoreboard. Now: both directions measured, both blocking, over-claim ranked
  worse, plus a yield floor so a run cannot pass by abstaining. The `dangerous`
  identifier is retained in code for continuity with #51/#61/#63/#92 and means
  **under-claim** wherever it appears.
- **2026-09-08 — `V1_CATEGORIES` deleted.** It named housing and food as the only
  in-scope categories, was read by no code, and was the stated reason
  `isVeteran` / `hasDisability` stayed unaskable — a category deferred because
  it is v1, and facts reserved because the category is deferred.
- **2026-09-07 (#88) — a fact earns a question by coverage, not by whether a rule
  already needs it.** The old rule was circular and had kept `age` unaskable
  while a whole class of senior programs waited behind it.

---

## How to reopen one

The precedent is #88, and it is worth copying because it worked.

1. **Show what the constraint costs**, concretely — name the programs or people
   blocked behind it, not the principle you disagree with.
2. **Say which harm it was protecting against**, and whether that protection is
   still needed or can be bought more cheaply. #88 kept the protection and paid
   less for it: age is asked as a band, not a number.
3. **Propose the narrowest change that unblocks the cost.** One fact, one
   question, one screen — not "ask everything".
4. **Update the row here, in the same change.** A decision reopened and not
   rewritten will be re-frozen by the next reader.

A constraint that survives this is stronger for having been tested. One that
cannot survive it was never load-bearing.

## What this file is not

Not a licence to relitigate the hard constraints in
[`CONTRIBUTING.md`](../CONTRIBUTING.md). Those are the product's promises —
answers never leave the browser, never invent data, `lastVerified` means a person
checked the source — not standing decisions about how to build it.
