# What the interview has to ask next

**Status: tier 1 is part-shipped; the rest is a plan.** This is a mechanism doc —
it says what to ask, in what order, and what each item buys. The *principles*
it applies (when a fact earns a question, the two harms, abstain per condition)
live in [`standing-decisions.md`](standing-decisions.md) and are not re-argued
here. The decisions this plan settles are recorded there too, with reopen
conditions.

It exists because the corpus work changed the problem. The interview was sized
for 17 records; `research/corpus/` holds 60 more candidates, and the question is
no longer "what facts do our rules need" but "what does this audience have to be
asked before a 60-program results page is worth reading".

**Shipped so far:** the eight-band `AGE_BANDS`, the homelessness mapping, and
the `veteranConnection` question with the first three veterans records — steps
1 to 3 of "Sequencing" below.

Reproduce every figure below with:

```
node research/corpus/analysis/fact-demand.mjs      # what the corpus asks for
node research/corpus/analysis/interview-value.mjs  # what each question buys
```

---

## The number that matters

The interview's failure mode at 81 programs is not a wrong answer. It is a
results page where almost everything says **"might qualify"**.

Evaluating all 60 candidate rules against five invented households, with only
the facts the interview asks today:

| | eligible | might qualify | ruled out |
|---|--:|--:|--:|
| today's vocabulary | 2.6 | **45.6 (76%)** | 11.8 |

Three quarters of the page, undifferentiated. That is not caution — it is the
under-claim harm arrived at by way of caution
([`standing-decisions.md`](standing-decisions.md), "The two harms"), and it
hands the sorting work straight back to a person in a crisis. A 20-record
corpus hides this: with a corpus this small, a long "might" list is short in
absolute terms. At 81 it is a wall.

Every item below is priced in the same unit: **how many of the 60 candidates
stop saying "might"**.

| | eligible | might qualify | ruled out |
|---|--:|--:|--:|
| today's vocabulary | 2.6 | 45.6 (76%) | 11.8 |
| + tier 1 | 4.0 | **26.0 (43%)** | 30.0 |
| + tier 2 as well | 4.0 | 22.0 (37%) | 34.0 |
| + an asset question | 4.2 | 21.8 (36%) | 34.0 |

Tier 1 is **one new question, one new checkbox, some relabelling, and a longer
age band list.** It is where nearly all of the value is.

### How to read these numbers, and how not to

- The 60 candidate rules are **unverified**. Where a candidate is wrong about
  its program, this is wrong the same way.
- The five personas are **invented**, and no real answers exist to sample from
  — collecting them is what the privacy constraint forbids. Treat the *ratios
  between* rows as the signal, not the absolute counts.
- A fact's **demand** (how many candidates name it) and its **pruning power**
  (how many a "no" actually settles) are different numbers, and demand
  over-rates things. `isVeteran` is named by 10 candidates and settles 5 of
  them on its own. See [`standing-decisions.md`](standing-decisions.md), "The
  words".

---

## Tier 1 — ask these

Ordered by what omitting each one costs, out of the full proposed set.

### 1. A household's connection to military service — **settles 8.2**

The largest single item in the corpus by a factor of two, and it opens a
category the app has none of today: 11 candidates, the whole `veterans` group.

**Ask it as a set, not a boolean.** This is the finding that changes the
already-planned change. `isVeteran` was reserved in `facts.ts` as a plain
boolean, and the boolean is the wrong shape: 6 of the 11 veterans candidates
reach their veteran test through a *family* route — `anyOf(veteran, spouse or
dependent)` — so "no" to "is anyone here a veteran?" leaves all 6 undecided for
everyone. Measured: the boolean settles 4.2, the set settles 8.2.

So `veteranConnection` is an `enumSet` over
`veteran / spouse-or-partner / surviving-spouse / child-or-dependent /
gold-star-parent`, supplied by one `multi` question — the same shape as
`currentBenefits`. A "none of these" answer settles all five routes at once,
which is exactly where the doubling comes from.

What it does **not** carry: discharge characterisation, service dates,
war-period service, VA rating percentages. Those gate several of the same
programs and belong in tier 3 — see "What we are leaving as *might*".

### 2. A child under 18 in the household — **settles 3.6**

Rides the existing household-members checklist, so it costs **no new
question** — one more box on a screen that already renders.

Not covered by today's `hasChildUnder5` + `hasSchoolAgeChild`: those two miss a
16- or 17-year-old out of school, and W-2, Emergency Assistance, Kinship Care,
the Caretaker Supplement and the SVdP Seton program all turn on a minor in the
home rather than a school enrolment.

### 3. Homelessness and housing instability — **settles 3.2, for free**

**No new fact and no new question.** Roughly 15 candidates coin a
homelessness-status fact (`isExperiencingHomelessness` ×4,
`atRiskOfHomelessness`, `facingImpendingHomelessness`, `housingStabilityAtRisk`,
`childIsHomeless`), and every one of them maps onto an answer the interview
already collects:

| Candidate coinage | Existing answer |
|---|---|
| `isExperiencingHomelessness`, `childIsHomeless` | `housingStatus: 'unhoused-or-temporary'` |
| `atRiskOfHomelessness`, `facingImpendingHomelessness`, `housingStabilityAtRisk` | `facingLossOfHousing: true` |

This is a **record-authoring** item, not an interview one: the work is to write
the mapping into [`data-authoring.md`](data-authoring.md) so that the next
fifteen authors reach for the existing fact instead of coining a sixteenth
spelling. The cheapest 3.2 on the list.

### 4. Finer age bands — **settles up to 2.0** *(applied in this change)*

The premise under the old three-band list is now false. `facts.ts` said "every
rule that turns on age needs a boundary (0-64, 60+, 62+, 65+)"; the corpus has
16, 18, 40, 55, 60, 62, 64 and 65, and Well Woman needs a 40–64 *window* that
three bands cannot state at either end. About 14 candidates carry a boundary
the old list rounded away.

Still bands, not a number — the principle held, only the cut points were wrong.
Eight bands (`under-16`, `16-17`, `18-39`, `40-54`, `55-59`, `60-61`, `62-64`,
`65-plus`) express every boundary in the corpus except 17.5 and an exact 64,
and both of those round outward, so the program stays in "might qualify" rather
than ruling anyone out. The trade-off against a single numeric input, and the
condition for revisiting it, are in
[`standing-decisions.md`](standing-decisions.md), "AGE_BANDS".

The measured 2.0 is an upper bound: the model gives itself an exact age.

### 5. Disability or long-term health condition — **settles 1.4**

Lowest raw score in tier 1, and still worth asking, for two reasons the score
does not show.

**It opens a category, not a program.** `health-disability` is 21 of the 60
candidates — the largest group in the corpus — and plausibly the largest
under-served category for this audience. It scores 1.4 because most of those 21
gate on something *further* (§below), not because the fact is idle.

**Ask the plain boolean and expect it to be necessary, not sufficient.** Six
disability-gated candidates need a more specific fact than the boolean can
carry — a 100% or 30% VA rating, "permanent and total", "disabled *and*
employed", "disabled per the Social Security Act" for a named child, or a
functional-need disjunction. Those are tier 3. The boolean's job is to stop
showing all 21 to people for whom none of them apply.

### 6. More boxes on the benefits checklist — **settles 1.8**

Zero marginal friction on a `multi` question that already renders — the
precedent is `federal-public-housing`
([`standing-decisions.md`](standing-decisions.md), "When a fact earns a
question"). The corpus needs at least:

- **Medicare** — the Medicare Savings Programs gate on Part A/B entitlement,
  and Well Woman excludes Medicare-eligible people.
- **Family Care / Partnership / IRIS** — one candidate already writes
  `currentBenefits: ['family-care-partnership-or-iris']`, a value that does not
  exist yet, and Dane County's veteran transportation *excludes* enrollees.
- **Kinship Care, the Caretaker Supplement, FDPIR** — categorical routes into
  CSFP and the funeral-aids program.

Deliberately **not** added in this change: a checkbox nothing consults is
friction now for coverage later, so each lands with the first record that reads
it.

---

## Tier 2 — borderline, and the case is honest either way

Each is one new question. Each opens a cluster rather than a program. None is
wrong to ask; none is clearly worth its screen yet. The recommendation is to
land each **with the first record that needs it**, not ahead of it.

| Question | Settles | Unlocks | The case against |
|---|--:|---|---|
| Is anyone enrolled in, or starting, college? | 2.0 | WI Grant, Talent Incentive, GI Bill tuition remission | Three programs, all one cluster, all also gated on FAFSA/Student Aid Index figures that stay `manualReview` — so it rarely gets past "might" anyway |
| Do you have health insurance? | 1.6 | Well Woman, SVdP charitable pharmacy | Two programs. Cheap and inoffensive to ask, which is most of its case |
| Do you run, or want to start, a business? | 1.2 | The whole `small-business` category (4 candidates) | 4 of 60, and every one of them ends in underwriting or a caseworker — the question opens a category that mostly cannot be decided |

The college and business questions have a second argument for them that the
scores cannot show: both open a **category** the app is silent on, and a person
who never sees a single small-business or tuition program does not know to ask.
That is the #88 argument, and it is the reason these are "borderline" rather
than "no".

---

## What we are leaving as *might* — deliberately

These are the facts we should **not** ask, grouped by why. Naming them matters:
each is a program that stays in "might qualify", and that is the honest answer,
not a gap to be closed later.

**Nobody can answer it accurately.** A wrong answer here tells someone they
qualify when they do not — the worse harm.

- VA disability rating percentages (100% / individual unemployability / 30%),
  "permanent and total disability", discharge characterisation, war-period
  service, residency-at-entry-to-service. Seven veterans candidates.
- `qualifiesForFederalEIC`, `hasFederalQualifyingChild`, Homestead Credit's
  Schedule H "household income" (a seven-page construction), FAFSA's Student
  Aid Index. Four candidates whose rule *is* another body of law.

**It is a professional assessment, not a fact.** Asking would invite a
self-assessment we would then treat as an answer.

- Wisconsin's Long-Term Care Functional Screen — gates 3 candidates by itself,
  and Family Care, IRIS and the ADRC screen all reduce to passing it.
- A 25% developmental delay (Birth to 3), clinical diagnoses (end-stage renal
  disease, hemophilia, cystic fibrosis), "frail elder", "a long-term care
  condition expected to last 90 days".
- Credit score, debt-to-income ratio, pending legal matters, "capable of
  paying" — the nonprofit lending and homeownership candidates.

**Asking buys nothing.** This one is the surprise, and it is the clearest
"skip" on the list.

- **Asset tests.** Six-plus candidates set one ($2,500 for W-2 and Emergency
  Assistance, $9,950/$14,910 for the Medicare Savings Programs, $46,000 liquid
  for NewBridge Home Chore). Asking settles **0.0** — an intrusive question,
  about money, that for this audience essentially everyone passes, so it almost
  never rules anything out. Its only possible value is *completing* a
  confirmation, and every asset-gated candidate except the Medicare Savings
  Programs carries a `manualReview` that caps it at "might" regardless. Encode
  asset tests as `manualReview` and say so in the caveat.

**One program's private matrix.** The Funeral and Cemetery Aids Program needs
11 facts about a *deceased* person's benefit history. One program, eleven
questions, asked of the bereaved. No.

### So how much work is left with the user?

Concretely: **14 of the 60 candidates stay at "might qualify" for all five
personas even with tier 1 and tier 2 answered.**

```
access-community-health-centers-sliding-fee   svdp-madison-thrift-vouchers
habitat-dane-homeownership                    us-va-aid-attendance
keep-wisconsin-warm-cool-fund                 wi-chronic-disease-program
madison-cda-public-housing                    wi-earned-income-credit
svdp-madison-food-pantry                      wi-funeral-cemetery-aids-program
svdp-madison-microlending                     wi-homestead-credit
                                              wi-kinship-care
                                              wisconsin-sbdc
```

That is the residue, and it is mostly not a vocabulary failure:

- **4 publish no rule at all** (SVdP pantry and thrift vouchers, SBDC, the
  Access sliding fee) — there is nothing to be more precise about. "Might
  qualify, here is the phone number" is the correct and complete answer.
- **5 end in a caseworker or an underwriter** (Habitat homeownership, SVdP
  microlending, Keep Wisconsin Warm, CDA public housing, Kinship Care).
- **5 are incorporated law or a private matrix** (EIC, Homestead, the funeral
  program, the chronic disease program, VA Aid and Attendance).

**Which makes the shape of the remaining work clear, and it is not more
questions.** For 14 of 60 programs the user's next step is a phone call, and
the app's job is to make that call obvious: say *what* is unresolved and *who
resolves it*. That is issue **#95** — "the reason for the remaining uncertainty
must be shown prominently" — and this plan raises its value sharply. Tier 1
plus tier 2 cuts "might" from 46 to 22; #95 is what makes the remaining 22
actionable instead of a shrug. **Without #95, tier 1 makes the page shorter but
not more useful.**

---

## Sequencing

Facts cannot be asked before a record needs them: the three-step change in
[`data-authoring.md`](data-authoring.md) is enforced by
`tests/data/vocabulary.test.ts`, so **no question here can ship until a record
references its fact.** That is the gate, and it is the right one.

An earlier version of this section said the gate was a record *verified*. It is
not, and the difference matters for how fast this can move: a record ships with
`lastVerified: null` and an honest `manualReview` where its rule could not be
pinned down — `dane-eviction-prevention.ts` is the precedent, and
[`data-authoring.md`](data-authoring.md) says plainly that "a record with an
honest `null` is worth more than one with a date covering a threshold nobody
actually re-derived." So a question can land as soon as a record is *authored
from fetched sources*; the human pass that sets `lastVerified` follows, and the
app shows an unverified banner until it does.

1. **Shapes first.** ✅ *Shipped.* `AGE_BANDS` widened from three cut points to
   eight and the age question with it; `veteranConnection` and
   `hasChildUnder18` declared with their shapes settled. Declaring a shape
   ahead of the record is what `RESERVED_FACT_KEYS` is for, and it stops two
   authors coining two spellings of one fact.
2. **The homelessness mapping into `data-authoring.md`.** ✅ *Shipped.* No code
   and no question — 3.2 candidates' worth of precision, and it stops the
   sixteenth coinage. `wi-veterans-housing-recovery.ts` is the worked example.
3. **First veterans records + the `veteranConnection` question.** ✅ *Shipped.*
   Three records (the Subsistence Aid Grant, the Veterans Housing and Recovery
   Program, and the Dane County Veterans Service Office) and one `multi`
   question on its own `military` screen, so `flow.ts` drops it for anyone
   outside Wisconsin. `veteranConnection` has left `RESERVED_FACT_KEYS`.
4. **The rest of the veterans candidates.** 8 of the 11 are still unshipped,
   and they need no new fact — `veteranConnection` already covers them. The
   cheapest reach available right now.
5. **First record needing a minor in the home** → one more checkbox on the
   household screen, no new screen. `hasChildUnder18` is declared and waiting.
6. **First health/disability record** → `hasDisability` joins the household
   checklist or takes its own screen, depending on what the record needs.
   21 of the 60 candidates are in this category; it is the biggest unshipped
   block.
7. **Benefit checkboxes** land one at a time, each with the record that reads
   it — Medicare, Family Care / Partnership / IRIS, Kinship Care.
8. **Tier 2 reassessed** once tier 1 has shipped and "might" is down to ~26 —
   the case for a fourth and fifth question is different when the page is
   readable.

**#95 is now the binding constraint, not a nice-to-have.** Step 3 shipped a
record (`wi-veterans-subsistence-aid`) whose rule is three `manualReview`
leaves deep, and the honest thing it tells a veteran is "might qualify". What
it does not yet tell them is *which* of those three things is unresolved, or
that a county veterans service officer settles all three for free. Every
further step on this list adds more programs in that state.
