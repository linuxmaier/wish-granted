# Corpus findings — 60 candidates

**What this is.** The analysis issue #102 asks for: an aggregation across all
60 research candidates (the #101 pilot's 20, migrated to the §6 schema, plus 40
gathered for #102), answering four questions with counts, and naming what the
survey could not reach. It draws **no architectural conclusions** —
`docs/pipeline-principles.md` §5 stays a list of open questions; this is
evidence for them.

**The corpus.** 60 `.json5` files in `research/corpus/`. Deliberately picked for
variety (pilot) then representativeness (batch 2), not sampled from a frame — so
the counts describe *this set*, not "Wisconsin benefit programs" in general. All
figures were read off fetched primary sources; none is verified (`lastVerified`
is `null` for every candidate — a machine gathered them).

Composition:

| | |
|---|---|
| Jurisdiction | state 29, county 22, federal 6, city 3 |
| Provider | government 41, nonprofit 19 |
| Category (multi-label) | health-disability 21, housing-utilities 16, food-basic-needs 13, veterans 11, childcare-education 9, small-business 4 |
| No category fits | 1 (`wi-earned-income-credit`); a further ~6 fit only loosely (tax credits, kinship support, cross-cutting referral) — the six-`CATEGORIES` gap the pilot named is real but small |
| Status | open 47, waitlist 9, closed 3, seasonal 1 — **13 of 60 (22%) are not simply "open"** |

Numbers below are reproducible: `grep -c` the schema fields, or run the
scratchpad `aggregate.mjs`.

---

## 1. What shapes do real eligibility rules take?

**A rule usually carries more than one shape at once.** These are counts of how
many of the 60 candidates exhibit each shape, not a partition.

| Shape | Count | Notes |
|---|--:|---|
| **A disjunction of alternative qualifying routes** (a load-bearing `anyOf`) | **28 / 60** | The single most common structural feature. Routes are categorical ("60+, OR Native American 55+"), condition-based (renal / hemophilia / CF), tier-based (four MSP FPL bands), or status-based (veteran / surviving spouse). |
| **A clean threshold or small `allOf`** expressible with today's vocabulary | **16 / 60** (`expressibility: full`) | Geography + income + a status flag. Mostly nonprofit basic-needs (SVdP pantry, NewBridge Food Bridge), a few state programs (CSFP, FSET, DNR voucher). |
| **A `manualReview` node sits inside the encoded rule** | **36 / 60 (60%)** | The `allOf(cleanRule, manualReview(rest))` shape `pipeline-principles.md` §3.4 predicted is not rare — it is the majority. Only **one** candidate (`wisconsin-sbdc`) is *nothing but* `manualReview`. |
| **The rule is mostly professional assessment, discretion, or incorporated law** | **15 / 60** (`expressibility: manual-review-dominant`) | Katie Beckett, Family Care, IRIS, Birth to 3, Kinship Care, the ADRC LTC screen — a **cluster of Wisconsin long-term-care and children's programs all reduce to "pass an off-page instrument"** (the Long-Term Care Functional Screen alone gates 3 candidates). Plus underwriting (`wwbic`), a "capable of paying" determination (`wi-veterans-health-care-aid-grant`), and a third-party nomination (`wi-talent-incentive-program-grant`). |
| **A figure incorporated from another body of law / cross-referenced** | **23 / 60** carry at least one `incorporated-law` unencodable | The federal EIC test (`wi-earned-income-credit`), "household income" as a 7-page Schedule H construction (`wi-homestead-credit`), MAGI income counting (`wi-family-planning-only-services`), FAFSA / Student Aid Index (`wi-grant-higher-education`, `wi-talent-incentive-program-grant`), Chapter DCF 58 / VA 2 / 45 CFR 1302.12, the DCF 101.095 coparent-income rule (`wisconsin-works-w2`). |
| **A figure scoped by a table column or row** | **~6** (`separation: column-header`, 5 entries + `wi-funeral-cemetery-aids-program`) | `madison-cda-public-housing` (public housing vs Section 8), `wi-earned-income-credit` (% by child count), `wi-medicare-savings-programs` (four FPL bands as columns), `head-start-dane` (100% / 130%), `wi-grant-higher-education` (WG vs WG-PNP matrix). |
| **A prominent figure that is not an eligibility gate at all** | **4** | `seniorcare-wi` and `wi-chronic-disease-program` (cost-share tiers — the pilot's "Wisconsin DHS house style", confirmed at 2 of 60), `access-community-health-centers-sliding-fee` (a fee schedule with no floor or ceiling), `wi-veterans-property-tax-credit` (no income test — the absence is the trap). |
| **No eligibility rule published** | **10 / 60** (`format: none-published`) plus `tenant-resource-center-eviction-diversion` (partner rules off-page) | Not a small-nonprofit phenomenon: a county housing authority running federal Section 8 (`dane-county-housing-authority-hcv`), the state's three veterans homes (`wisconsin-veterans-homes`), a state small-business service (`wisconsin-sbdc`), and a statutory county veterans office (`dane-county-veterans-service-office`) all publish none. |

**Format of the source** (the substrate a parser would work on):

| `format` token | Files |
|---|--:|
| `html-prose` | 48 |
| `html-table` | 10 |
| `none-published` | 9 |
| `pdf` | 4 |
| `wi-admin-code` | 4 |
| `ecfr` | 1 |

**80% of sources (48/60) are prose.** A structured table appears in only
**10**; a regulation (`ecfr` / `wi-admin-code`) in **5**; a PDF in **4**.

---

## 2. What does the fact vocabulary need?

**`factsNeeded` is dense.** 50 of 60 candidates name at least one fact the
interview cannot ask; **163 entries, 141 distinct keys**. 10 candidates need
nothing new (the clean-threshold nonprofits, plus `seniorcare-wi` whose whole
difficulty is elsewhere).

The 141 keys are fragmented because each candidate coined its own — but they
cluster:

### 2a. `isVeteran` — settles now. Unlocks 11 candidates.

`isVeteran` is referenced by **10 files directly** and is the category key for
an 11th (`wi-dnr-returning-service-members-voucher` via age+war-period). Programs
it unlocks:

`wi-gi-bill-tuition-remission`, `wi-veterans-assistance-grant`,
`wi-veterans-health-care-aid-grant`, `wi-veterans-property-tax-credit`,
`wi-veterans-housing-recovery-program`, `wisconsin-veterans-homes`,
`us-va-veterans-pension`, `us-va-aid-attendance`,
`dane-county-veterans-service-office`, `dane-county-veteran-transportation`,
`wi-dnr-returning-service-members-voucher`.

That is a whole category (`veterans`) currently unreachable. **The reopen
condition in `docs/standing-decisions.md` for `isVeteran` has said "now" for
some time; 11 candidates is the evidence.** The boolean is *sufficient* for the
umbrella/referral programs (`dane-county-veterans-service-office`) and the
categorical ones (`wi-dnr-...-voucher`); the benefit-grant programs additionally
need surviving-spouse / dependent facts and a discharge-character fact, and the
disability-rated ones need a specific VA rating (§2b).

### 2b. `hasDisability` — un-reserve it, but it is necessary, not sufficient.

`hasDisability` (plain boolean) is referenced by **4 files**
(`dane-county-adrc-disability-benefit-specialists`,
`dane-county-adrc-long-term-care-functional-screen`, `wi-family-care`,
`wi-iris`), plus `wi-homestead-credit` uses an equivalent `isDisabled` as a full
qualifying route. So the plain boolean unlocks **~5 candidates** and opens the
`health-disability` category the same way `isVeteran` opens `veterans`.

**But 6 further disability-gated candidates need a *more specific* fact than the
boolean:**

| Candidate | Fact it actually needs |
|---|---|
| `katie-beckett-medicaid` | "disabled per the Social Security Act", scoped to a specific child |
| `wi-veterans-property-tax-credit` | a **100%** service-connected rating or individual unemployability |
| `wi-gi-bill-tuition-remission` (spouse/child route) | a **30%** service-connected rating |
| `us-va-veterans-pension` | "permanent and total disability" (a distinct standard) |
| `us-va-aid-attendance` | a functional-need disjunction (ADL help / bedridden / 5/200 vision / housebound) |
| `wi-medicare-savings-programs` (QDWI) | "disabled **and** employed" |

**Finding: un-reserving `hasDisability` unlocks the category and ~5 programs
outright; it does not carry the rule for the programs that turn on a rating
percentage or a functional standard.** Those need either their own facts or a
`manualReview`.

### 2c. `AGE_BANDS` (under-60 / 60-64 / 65-plus) is broken by ~a quarter of the corpus.

Age boundaries the three bands **cannot** express, each from a real candidate:

| Boundary | Candidates |
|---|---|
| 40 and 64 | `wi-well-woman-program` |
| 62 | `wi-homestead-credit` |
| 55 (Native Americans) | `wi-senior-farmers-market-nutrition` |
| 18–59 | `dane-county-adrc-disability-benefit-specialists` |
| 17½ | `dane-county-adrc-long-term-care-functional-screen` |
| 16 | `wi-foodshare-employment-training` |
| under-19 | `katie-beckett-medicaid` |
| under-18 (child in home) | `wisconsin-works-w2`, `wi-emergency-assistance`, `wi-kinship-care` |
| under-6 / under-3 | `head-start-dane`, `wi-birth-to-3` |
| "is an adult" (18+) | 5 candidates (`isAdult`) |

**~14 candidates carry an age condition the current model rounds away or
cannot state.** `age` as a band was the right call for the original 21 records;
the wider corpus needs either finer bands or a numeric age with per-rule
boundaries (`standing-decisions.md`, "When a fact earns a question", already
anticipates this).

### 2d. Recurring fact *families* the vocabulary has no shape for

| Family | ~Count | Examples |
|---|--:|---|
| **Homelessness / housing-instability status** (broader than `housingStatus`) | ~15 | `isExperiencingHomelessness` (×4), `atRiskOfHomelessness`, `facingImpendingHomelessness`, `isHomeboundOrLimitedMobility`, `childIsHomeless`, `housingCostOver30PercentOfIncome` |
| **Person-scoped income** (not a household aggregate) | ~6 | `ownMonthlyIncome` (FPOS), `childOwnIncomeAboveInstitutionalLimit` (Katie Beckett), `grossAnnualHouseholdIncomeOver15000` (an income **floor** — Habitat repairs), the WFCAP per-decedent-category FPL sub-limits |
| **Asset tests** with specific thresholds | 6+ | `$2,500` (W-2, EA), `$46,000` liquid (NewBridge Home Chore), `$9,950 / $14,910` (MSP), net worth incl. spouse's (VA pension), home value ≤ `$397k` (Project Home) |
| **"Enrolled in another program"** — often as an **exclusion** | ~10 | `receivesWisconsinSSIPayment`, `getsCommonCarrierMedicalAssistanceTransport`, `family-care / partnership / IRIS` (Vets Helping Vets excludes them), FDPIR / Low-Income-Subsidy / Medicare-Savings (CSFP categorical routes not in `BENEFIT_ENROLLMENTS`) |
| **"Incorporated body of law" single booleans** the interview can never truly ask | 4 | `qualifiesForFederalEIC`, `hasFederalQualifyingChild`, `potentiallyEligibleForPublicAssistance`, `meetsWiGiBillServiceQualification` |
| **Categorical identity** | ~10 | `isWoman`, `isNativeAmerican`, `isOfReproductiveAge`, `isMaleIdentified`, `isGoldStarParent`, `isRelativeCaregiverOfChildInHome`, `isSingleCustodialAdultOfMinorChild` |
| **Insurance / Medicare status** | ~7 | `hasHealthInsurance` (×2), `insuranceCoversScreenings`, `eligibleForMedicare`, `entitledToMedicarePartAOrBID` |
| **Credit / legal standing** (nonprofit homeownership & lending) | ~5 | `creditScoreAtLeast620`, `meetsHabitatRepairsDebtStanding`, `hasPendingLegalMatters`, `debtToIncomeRatioUnder47` |
| **Business** | ~8 | `businessOperatesInWisconsin`, `businessHas5OrFewerEmployees`, `completedApprovedBusinessTraining` |
| **Education enrolment** | ~8 | `enrolledAtParticipatingWisconsinInstitution` (×2), `enrolledAtLeastHalfTime`, `isFirstTimeFreshman` |

The evidence `docs/standing-decisions.md` "When a fact earns a question" asks
for is here for `isVeteran` (clear) and `hasDisability` (clear for the category,
qualified for the hard cases). The rest — a homelessness-status fact, a
person-scoped income concept, a generic asset flag — each unlocks a cluster, and
each is a fresh judgment against friction cost, not settled here.

---

## 3. Is deterministic parsing worth rebuilding?

The retired programme assumed a large share of sources publish clean structured
tables with the governing scope beside the figure. **The corpus does not support
that assumption.**

- **48 / 60 sources are prose.** `html-table` appears in **10**; of those, the
  figure's scope is an attached **column-header** in only **5** `scopeSeparation`
  entries — and in 2 of those 5 (`madison-cda-public-housing`,
  `wi-earned-income-credit`) the pilot noted the column would be **lost by a
  flattening read**, i.e. the structure only helps if preserved.
- **9 / 60 publish no rule at all** — nothing to parse.
- **5 / 60** put the rule in a regulation (`ecfr` / `wi-admin-code`); **4** in a
  PDF booklet.
- The clean structured-table case that deterministic parsing was good at
  (`wi-csfp-senior-food`) exists but is **rare** — perhaps 5–8 of 60.

**What did survive:** `html-structure.ts`'s `renderStructured()` — which keeps
column headers and heading paths attached — *prevented* the column-scope drop on
`madison-cda-public-housing`, `wi-earned-income-credit`, and
`wi-medicare-savings-programs`. Structure **preservation** earned its place; a
structure-**dependent parser** would idle on 80% of this corpus.

---

## 4. How often is a figure's governing scope separated from the figure?

This is the branch-dropping signal (`pipeline-principles.md` §3.1) — the failure
class four architectures never solved. First measurement across 60 sources:

**77 `scopeSeparation` entries across the 60 files:**

| `separation` | Entries |
|---|--:|
| `colocated` | 29 |
| `other-document` | 12 |
| `n/a — no governing figure` | 12 |
| `same-page-elsewhere` | 10 |
| `cross-reference` | 9 |
| `column-header` | 5 |

Of the 65 entries that name an actual figure/term (excluding the 12 `n/a`):
**36 are separated from their scope, 29 are colocated — 55%.**

**Per candidate: 32 of 60 (53%) carry at least one figure whose scope is
separated from it.** 10 of 60 publish no governing figure at all (`n/a`
throughout).

### The direction of the error (`branchDropRisk`)

34 `branchDropRisk` entries across 30 candidates:

| `direction` | Count | Meaning |
|---|--:|---|
| `narrower` | 24 | Encoding the figure alone **rules out people the program accepts** — the measured failure class |
| `either` | 7 | A term-trap or person-scope confusion that mis-decides **both ways** |
| `looser` | 3 | The risk is **inventing** a limit the program does not have |

The three `looser` cases: `habitat-dane-home-repairs` (income must be *greater*
than $15,000 — the corpus's only true income **floor**), `wi-kinship-care` (no
caregiver income test by design), `wi-veterans-property-tax-credit` (no income
test — the absence is easy to "fill").

**`pipeline-principles.md` §3.1's reopen condition** — "a wider corpus turns up
numbers lifted out of scope in the looser direction *about as often*" —
**is not triggered.** Narrower (24) still dominates looser (3). But looser is
now firmly non-zero and reproducible, and a third bucket (`either`, 7) that the
pilot's binary did not have is now visibly significant — batch-2 authoring
should keep counting all three.

### The cost-share-tier shape recurs

`seniorcare-wi` and `wi-chronic-disease-program` — a prominent FPL % that is a
cost-sharing tier, not a ceiling — both Wisconsin DHS health programs. The pilot
flagged this as a possible "house style". At 2 of 60 (plus
`access-community-health-centers-sliding-fee`, a non-DHS fee-schedule variant)
it is **confirmed as a recurring shape**, not a fluke. Worth its own line in
`docs/standing-decisions.md`, "The words" — *a named FPL % that is a
cost-sharing tier and not an eligibility gate* — alongside the existing "named
tier that is not an eligibility gate at all" (`seniorcare-coverage-levels`).

---

## What the survey could not answer

Stated explicitly, per the issue.

1. **Whether a pipeline would make a reviewer faster** (`§5.5`). Nothing here
   produced a reviewer-facing artefact — a candidate rule *plus its provenance
   plus the diff against an existing record*. This survey is 60 hand-authored
   candidates; it does not test throughput against a real reviewer.
2. **Whether a stronger model changes the branch-drop failure** (`§5.6`). The
   characterised failure is *misunderstanding what a number governs* —
   reasoning, not retrieval. This survey was done by an agent reading
   structure-preserving dumps; no model was benchmarked on the 60, and no A/B
   against a weaker reader was run.
3. **The promotion rate.** How many of the 60 survive a human reading the source
   and setting `lastVerified` is unknown — that pass has not happened. Some
   candidates (the `manual-review-dominant` 15) may contribute almost nothing
   once verified; a "coverage" number for the corpus cannot be stated yet.
4. **Representativeness.** The 60 were chosen, not sampled. There are hundreds of
   programs a low-income Dane County resident could qualify for; this set
   over-weights state DHS/DCF and Dane County government by construction. The
   *shape* counts (Q1, Q4) are more trustworthy than the *category* counts.
5. **Whether "no rule published" sources have a rule a phone call would find.**
   The 10 `none-published` candidates were characterised from the web only. A
   caseworker on the phone might state an income limit that simply is not
   written down.
6. **Whether the figures are current.** No candidate is verified. Several dollar
   amounts are explicitly flagged as possibly stale (WFCAP caps from a 2022
   manual, Habitat's income chart, SFMNP's downstream table).
7. **Benefit-interaction and cliff effects.** Many rules exclude people already
   on another program, or count another program's receipt as categorical
   eligibility. The corpus records these per-candidate but does not map the
   graph of which programs gate, exclude, or unlock which others.

---

## Pointers for the follow-on (not decisions — `pipeline-principles.md` §5)

**Three of these have since been acted on** (2026-09-12). The plan they became,
with each question priced against this corpus, is
`../../docs/interview-roadmap.md`; the decisions are recorded in
`standing-decisions.md`. Kept here, marked, because the pointer is the evidence
and the outcome is not always what the pointer proposed.

- `isVeteran`: un-reserve — 11 candidates, a whole category. (`standing-decisions.md`.)
  → **Done, but not as a boolean.** A later measurement found the reserved
  boolean cannot carry the family routes 6 of those 11 qualify through, so the
  fact shipped as `veteranConnection`, an `enumSet`.
- `hasDisability`: un-reserve for the category; expect ~6 disability programs to
  still need a rating/functional fact or a `manualReview`.
  → **Done**, and the ~6 confirmed: they are left as `manualReview` on purpose.
- `AGE_BANDS`: ~14 candidates need a boundary it cannot state. Revisit.
  → **Done.** Three cut points became eight; still bands, not a number.
- The `allOf(clean, manualReview(rest))` shape is the **majority** (36/60), not
  an edge case — whatever comes next should emit it early, per §3.4.
- Structure **preservation** (`renderStructured`) is worth keeping; a
  structure-**dependent** parser would idle on 80% of sources.
- `standing-decisions.md` "The words": add the *FPL-%-that-is-a-cost-share-tier*
  shape (confirmed 2–3× in the corpus) and note `direction: either` as a third
  branch-drop direction beside narrower/looser.
