# Standing decisions

The single home for design principles: what is settled fact, what is a judgment,
and when a judgment should be reopened. Read this before proposing — or refusing
to propose — a change to how program data is found, authored, or shipped.

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
| **This file** | Every design principle and judgment: the statement, the reason, the reopen condition, the glossary of terms of art, and the record of what changed. | Mechanism. How something is implemented. |
| Mechanism docs (`design.md`, `data-authoring.md`, `pipeline-principles.md`, …) | How a thing works, and how to use it. | The *argument* for a principle. State it in a line and link here. |
| Code and tests | The rule, in one line, with a link here. | Justification, history, or a retelling of why the rule exists. |
| Git history and issues | What changed, when, and the full argument at the time. | — |
| Issues labelled `superseded`, and `docs/archive/` | A dated record of the retired extraction programme. | **Anything current.** See below. |

**A principle is stated once, here. Everywhere else links.** If you find
yourself explaining *why* a rule exists in a code comment, the explanation
belongs in this file and the comment belongs at one line.

**On `superseded` issues and `docs/archive/`.** The eligibility-extraction
programme was unwound on 2026-09-08 (#97). Its issues and research documents are
kept because they contain real measurements, and are marked because they also
contain four architectures' worth of reasoning that no longer applies. They are
history. Nothing in them is a constraint or an established fact about what is
possible; everything from them that survived is in this file or in
[`pipeline-principles.md`](pipeline-principles.md).

---

## The words

Terms of art, defined once. Most of these name a thing in a **source** and a
different thing in **our encoding of it**, and conflating the two is how the
repo lost months to a single ambiguous word before ("over-claim", below).

When you introduce a new term of art, add it here in the same change.

### The chain: source → rule → branch → number

| Term | Means | Not |
|---|---|---|
| **program** | The real-world benefit a person can apply for. FoodShare is a program. | A `Program` object |
| **record** | *Our* encoding of a program — a `Program` in `src/data/programs/`, with its rule, descriptive fields and `source`. | The program itself. A record can be wrong about a program |
| **source** | The published page, PDF or regulation a record cites. Also the name of the record field carrying its URL, name and `lastVerified`. | Where the *money* comes from — say "administering agency" for that |
| **rule** | Who qualifies. Used for both what a source publishes (prose, tables) and what we encode (a `Criterion` tree). **Say which** when the difference matters: *"the published rule"* vs *"the encoded rule"* | A single condition — that is a criterion or a leaf |
| **branch** | **One alternative path through a published rule.** A rule can often be satisfied more than one way, or a figure can apply only under stated conditions; each such path or carve-out is a branch. | A git branch. Also not an `anyOf` node — that is the *encoding* a branch usually maps to |
| **number** / **figure** | A quantity stated in a source — a threshold, a percentage, a dollar amount. It may or may not be the rule; that is the whole problem in "branch-dropping". | A verified threshold |
| **scope** | The conditions that decide when a number applies: a table column header, a preceding "if you are…", a population named a paragraph earlier. | The project's scope |
| **excerpt** | A pre-cut fragment of a source, handed to something that never sees the whole page. Named because measuring against excerpts produced a ceiling that did not exist. | A quote or provenance span |

**How branches actually appear in sources** — these are the measured cases, and
they are the reason the term needs a definition at all:

| Shape | Case |
|---|---|
| Alternative qualifying routes ("or") | `foodshare-snap-wi` — an income test **or** categorical SSI/W-2 receipt |
| A table column or row scoping a figure to a population | `badgercare-plus-population-columns` — 201% vs 306% by column header |
| A named tier that is not an eligibility gate at all | `seniorcare-coverage-levels` — cost-sharing levels, not an income ceiling |
| A bare FPL % that reads as a ceiling but triggers cost-sharing | `seniorcare-wi`, `wi-chronic-disease-program` — the corpus survey found this recurring, both WI DHS health programs; a plain "300% FPL" with no *named* tier, still not a gate (`research/corpus/FINDINGS.md` §4) |
| A conditional carve-out | `lifeline-survivor-extended` — a survivor-only extended threshold |
| A capped discretionary allowance | `headstart-cfr-over-income-allowance` |
| A composition test rather than an income test | `snap-cfr-elderly-separate-household` |
| A person-scoped income concept, not a household aggregate | `wi-family-planning-only-services` ("only your own income counts"), `katie-beckett-medicaid` (the child's own income) — from the corpus survey |

**Branch-dropping** is then sayable in one line: *taking a number as the whole
rule and discarding the branch that governs it.* See
[`pipeline-principles.md`](pipeline-principles.md) §3.1.

**Direction of the error.** The corpus survey (`research/corpus/FINDINGS.md` §4)
counts branch-drop risks as *narrower* (rules out people the program takes — the
measured failure), *looser* (invents a limit the program lacks), or *either* (a
term-trap or person-scope confusion that mis-decides both ways). Narrower still
dominated (24 of 34), but *looser* was reproducible (3 cases) and *either* was
newly significant (7).

### Encoding and outcome

| Term | Means |
|---|---|
| **fact** | A key in the interview's vocabulary that exactly one question writes (`src/domain/facts.ts`) |
| **criterion** | A node in the encoded rule — `allOf`, `anyOf`, `not`, a comparison, a set test, `manualReview`, `always` (`src/domain/criteria.ts`) |
| **leaf** | A criterion with no children: the atoms a rule is built from |
| **decidable** | A condition the engine can resolve to true or false from the answers given. `manualReview` is never decidable; an unanswered question is not yet decidable |
| **abstain** | To decline to state part or all of a rule. The act |
| **`manualReview`** | The encoding of an abstention: a leaf that always evaluates `unknown`. Sits *inside* a rule beside real criteria — see "Abstain per condition" |
| **bucket** | Which of the three answers a person gets for a program: eligible, might qualify, ruled out |
| **coverage** | What fraction of attempts produced usable output at all |
| **yield** | Of those, what fraction stated an actual rule rather than abstaining. **Coverage and yield are different numbers** and a run that confuses them can look successful while answering nothing |

### The harm directions

**over-claim** and **under-claim** are defined under
["The two harms"](#the-two-harms), the next section, and that definition governs.
In short:
over-claim tells someone they qualify when they do not; under-claim rules out
someone who qualifies.

Two traps worth knowing:

- **Say the direction in the sentence.** *"Tells someone they qualify when they
  do not"* costs six words and cannot be misread. A bare "over-claim" can.
- **Issues labelled `superseded` and documents under `docs/archive/` use the
  opposite sense** — there, `dangerous` and "over-claim" usually mean a rule
  *narrower* than reality, which is an under-claim here. They are not to be
  rewritten; they are to be read carefully, or not read.

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
any rule — a corpus that abstains on everything has zero over-claims and is
worth nothing to anybody.

**Most of the apparent dilemma is not real.** The app has a third bucket. "Might
qualify" is not a wrong answer in either direction, so the ranking only binds
when choosing between `eligible` and `ruledOut` — a much narrower set of
decisions than it is usually invoked for. In particular it does **not** bind on
whether a program belongs in the corpus at all: a record that abstains cannot
tell anyone they qualify, so caution about *including* a program buys no safety
and costs reach.

**Say the direction in the sentence.** Write *"tells someone they qualify when
they do not"* rather than a bare "over-claim"; it costs six words and removes the
ambiguity that kept this confused for months. See ["The words"](#the-words) for
the rest of the vocabulary, including why `superseded` issues use these two terms
in the opposite sense.

Nothing measures these automatically today. Both directions are checked by the
person authoring or reviewing a record; see
[`data-authoring.md`](data-authoring.md).

## Abstain per condition, never per record

When part of a program's eligibility cannot be mapped into the interview's fact
vocabulary, **encode everything that can be mapped and abstain only on the part
that cannot.** A `manualReview` leaf sits inside the rule alongside real
criteria; it does not replace them.

A record whose income test is clean but whose work requirement is not should
still rule people in and out on income. Collapsing it to "geography, plus a
shrug" throws away information we have and pushes a program into "might qualify"
for everyone — which is the under-claim harm, arrived at by way of caution.

The engine already works this way: `manualReview` always evaluates `unknown`, so
a partial rule can `fail` on a mapped criterion (ruled out, correctly) or sit at
`unknown` (might qualify), but can never `pass` while an abstention is live.
`madison-housing-choice-voucher.ts` and `wisconsin-shares-child-care.ts` are the
worked examples, and this is a hand-authoring rule today — nothing generates
records.

**The reason for the remaining uncertainty must be shown prominently** where the
program appears, not buried in a disclosure. A person looking at "might qualify"
needs to know what would settle it. Not built yet: #95.

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
re-run them without a specific reason to think they have changed. These survived
the unwind because they are facts about the world, not about the retired design.

| Fact | Source |
|---|---|
| Grants.gov indexes discretionary grants **to organizations**, not benefits to individuals. Wrong corpus. | #4 |
| Open Referral / HSDS has no eligibility entity — its core objects are `organization`, `service`, `location`, `service_at_location`. It is directory data. | #4 |
| No government or directory source surveyed publishes eligibility as structured data. PolicyEngine US is the one adjacent exception, and covers federal programs only. | #4 |
| WI state sites return 403 to naive fetchers while their `robots.txt` is permissive. Use a normal browser user-agent; a 403 is not a crawl prohibition. | #5 §1 |
| `strict: true` cannot be used for `Criterion` extraction — a recursive expression language exceeds the grammar-compilation limits. Dropping it is required, not preferred. | #5 §4.5 |
| A schema gate catches malformed output. It cannot catch a well-formed, semantically wrong rule. | #51 |
| Token cost is negligible against reviewer time — 27 cases at $0.25, a 152-call agentic run at $8.39. **Cost is not the constraint on any design in this repo.** | #5 §6, #64, #67 |
| Three change-detection signals were measured and rejected. | #5 §5 |

Deliberately **not** kept: the Tier 1/2/3/4 percentages of the surveyed corpus.
They were derived by reading hand-picked excerpts rather than pages, and three
sources were later reclassified once that error was found. Any future tiering
must be re-measured against a wider corpus.

---

## Standing decisions — reopen when the named condition holds

| Decision | Why | **Reopen when** |
|---|---|---|
| **There is no extraction pipeline. Program records are hand-authored.** | The programme built through 2026 was unwound on 2026-09-08 (#97): four architectures were designed against a corpus of 17 records and a scoreboard that could not see over-claims. This supersedes the earlier "`eligibility` extraction is worth automating" position. | After the corpus is materially wider and its real variety of rule shapes is known. Any new attempt starts from [`pipeline-principles.md`](pipeline-principles.md), not from the retired design. Do not propose a fifth architecture against the current 21 records. |
| **Never auto-merge an eligibility change.** A pipeline proposes; a human disposes. | A wrong threshold reaches a person in crisis as a stated fact. | Not on current evidence, and not while there is no pipeline. Any future proposal must clear a frozen held-out run showing zero over-claims **and** zero under-claims **and** a usable yield — all three, never two of three bought by abstaining. |
| **Both harm directions block, and over-claim ranks worse.** See "The two harms". | Stated above. | The ranking is the product owner's and is stable. |
| **A measure of correctness must count decidable answers, not the presence of a field.** A run, or a corpus, that abstains its way to zero harms has not been measured — it has declined to answer. | This is the generalised form of the yield floor the retired benchmark carried, and of the degenerate-outcome guards its stages carried. It is the trap any replacement will fall into on day one. | Stable. Applies to any future metric, not just an extraction one. |
| **Abstention is per condition, not per record.** See "Abstain per condition". | Stated above. | Stable as a principle. Its one piece of open support is #95 — the reason for the uncertainty is not shown to the user. |
| **`src/data/reference/income-tables.ts` is hand-maintained.** Its generator was deleted in the unwind. | The FPL/SMI tables are the scales every income rule evaluates against. The committed values remain correct until they expire; the current FPL table is effective to **30 September 2026**. | **Before that date.** Someone must refresh the tables by hand, or a replacement refresher must exist. This is a dated correctness obligation, not a nice-to-have. |
| **Source change detection is a known gap.** Nothing notices when a source page moves or rewrites its rules. | Its implementation was deleted in the unwind (#7, #82 — both `superseded`). | When the corpus is wide enough that manual re-verification stops being feasible. The three rejected signals in the Facts table stay rejected; a replacement needs a different approach. |
| **`citizenshipStatus` stays unasked**, and immigration status is never encoded as a rule. Affected programs carry a plain-language caveat and stay in "might qualify". | It genuinely affects federal food benefits, but the rules are dense with exceptions — children frequently qualify when adults do not — and a rules engine that got them slightly wrong would tell a family they are ineligible when they are not. This is the "coverage argument can lose" case: applied honestly per fact, here it loses. | This argues against **exclusionary** rules on that fact, not against the fact itself. Reopen the moment a program is found that the fact would let us *include* someone in — refugee- and immigrant-specific assistance is exactly the under-served case. Asking it and only ever using it to widen a match has never been evaluated. |
| **`employmentStatus` stays unasked.** | The friction of asking is not yet bought back by the coverage it would unlock. | Same test as any other fact — see "When a fact earns a question". Nobody has re-run it since #9. |
| **`isVeteran` and `hasDisability` stay reserved.** | Their categories were deferred in the original brief. | Now. The deferral was circular in the way #88 rejected. Run the #88 coverage test: does asking unlock programs worth including? Health/disability is plausibly the largest under-served category for this audience, and the corpus expansion is the moment to settle it. |
| **211 Wisconsin and findhelp.org are not fetched.** | robots.txt (findhelp); no confirmed access path (211). | The robots.txt finding stands. The reasoning about 211 partly rested on HSDS carrying no eligibility data — no longer disqualifying, since a directory entry still yields a real record. Reopen the access-path question on those terms. |
| **PolicyEngine US is a future cross-check, not a dependency.** | Open questions: AGPL implications, and whether it scores partial inputs. | Now. Both are answerable in an afternoon and neither has been attempted. Consulting parameter values at build time differs materially from redistributing or embedding. |
| **Ship the whole corpus to every client.** | The privacy property: what the client requests must not depend on the user's answers. | At roughly 1,000 programs (~460 KB gzipped). Split by content type first, by state second; never by county, never by an answer. |

---

## Decisions that changed

Kept short and here, so no other file has to carry it.

- **2026-09-08 — the eligibility-extraction programme was unwound.** Ten script
  suites, their tests, CI jobs and research docs were deleted or archived, and
  26 issues were marked `superseded`. Not because one component failed: the
  corpus was too small to generalise (17 records, 4 of them reconstructed), the
  scoreboard could not see over-claims until the day it closed, the extractor
  seam could not express the partial rule that most hard cases actually need,
  the stages were never composed and their contracts contradicted each other,
  and the benchmark's ground truth was the entire corpus. The route to reach is
  now a wider hand-authored corpus first. Findings that stand: #97. Constraints
  any future attempt inherits: [`pipeline-principles.md`](pipeline-principles.md).
- **2026-09-08 — the harm ranking was inverted, and half of it was unmeasured.**
  `dangerous.ts` defined "dangerous" as a rule *narrower* than reality and stated
  that a looser rule was "not dangerous by definition", so the benchmark could
  not see an over-claim at all. `CONTRIBUTING.md` asserted both orderings in
  adjacent constraints. Four extraction architectures were designed against that
  scoreboard. The governing definitions are now the ones under "The two harms";
  the legacy sense survives only in `superseded` issues.
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
