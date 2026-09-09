# #101 pilot — go / no-go report

**Recommendation: PROCEED WITH NAMED FORMAT CHANGES.** The working method
survives contact with real sources and is cheap. The capture format holds for
the descriptive record and for `factsNeeded`, but `scopeColocated` and the
"annotations in JSON" convention need specific changes before ~40 more candidates
are captured against them. All changes below are to be applied back to the
pilot's 20 first (one survey, one schema).

**The changes stay deliberately light on structure.** This survey exists to see
what real-world eligibility data looks like, not to produce a clean dataset —
there will be later passes to align candidates into the system, and each one is a
chance to tighten. Over-structuring now would do the same thing the closed
`Criterion` language already does: quietly limit what the survey can record to
what we expected to find. So the format moves to **JSON5** (comments, nothing
else) and the new fields are loose conventions, not schemas.

20 candidates are in `research/corpus/*.json` (valid JSON5 as-is). `npm test`
(120) and `npm run build` are green and untouched; the only new path is
`research/`.

---

## 1. Did the format hold?

**Descriptive `record` fields:** yes, no changes needed. `jurisdiction`,
`provider`, `status`, `howToApply` mapped cleanly every time. `categories`
missed **once outright** (`wi-earned-income-credit` — a large cash benefit for
poor working families that fits none of the six `CATEGORIES`) and partially
~5 times (kinship care, caretaker supplement, homestead credit, SVdP, the
Beacon). **Finding, not a format bug:** the category set has no bucket for
tax-credit / cash income support, and no bucket for "cross-cutting referral
service" (the shipped set already works around this with `wi-211` and
`dane-jfff`).

**`rule.eligibility` as literal `Criterion` JSON:** workable but strained on one
axis. A node has to do three jobs at once — encode the rule, cite the source
(`_sourceText`), and carry the reader's caveat (`_note`, usually "there is
deliberately no income gate here"). JSON has no comments, so every annotation is
a `_`-prefixed sibling key. This is legible but ad-hoc, and a reviewer cannot
tell a real key from an annotation without knowing the convention.

**`factsNeeded`:** held well. 51 entries across 20 candidates (~40 distinct keys
— see §2). Empty on 3 (`seniorcare-wi`, `wi-csfp-senior-food`,
`dane-county-housing-authority-hcv`) and each empty for an instructive reason.

**`unencodable`:** held, but a flat string list flattens very different weights —
"an $50,000 life-insurance exclusion" sits next to "the entire federal EIC
statute, incorporated by reference". Worth tiering in batch 2.

**Fields the schema did not have, that candidates wanted:**

| Missing field | Candidates that needed it |
|---|---|
| an explicit `n/a` for `scopeColocated` when the source publishes no figure | `svdp-madison`, `dane-county-adrc`, `dane-county-housing-authority-hcv`, `the-beacon-dane` (used `colocated: null` as a stopgap) |
| a place to record a **term-trap** (the figure is fine, the *noun* beside it is a 7-page construction) | `wi-homestead-credit` ("household income"), `wi-family-planning-only-services` (MAGI "own income") |
| a structured **branch-drop risk** field | ~9 candidates — currently scattered through `_note` strings |
| an **expressibility / difficulty** summary distinct from "how many new facts" | `seniorcare-wi` and `wi-chronic-disease-program` (hardest cases, zero new facts) vs `wi-csfp` (trivial, zero new facts) |
| `format` as a controlled vocabulary | every candidate — the field was filled free-form and is not aggregatable |
| a "one id = many sub-programs" signal | `dane-county-adrc` (5 sub-programs, 5 rules), `wi-chronic-disease-program` (3 conditions), `svdp-madison` (6 programs) |

---

## 2. Are `factsNeeded` and `scopeColocated` actually discriminating?

### `factsNeeded` — yes, strongly.

Not mostly empty (3/20), not mostly "unknown". The 20 candidates proposed ~40
distinct new fact keys. Grouped:

- **Reserved keys, now evidenced:** `isVeteran` (2 candidates),
  `citizenshipStatus` (4), a child/person disability fact (`childHasDisability`,
  `isDisabled`, `vaDisabilityRating100OrIU` — 4). **`hasDisability` un-reserve
  question:** the corpus says un-reserving the plain boolean is *necessary but
  not sufficient* — `wi-veterans-property-tax-credit` needs a specific "100%
  service-connected or individual unemployability" rating, and `katie-beckett`
  needs "disabled per the Social Security Act" scoped to a specific child. A
  boolean unlocks the category; it does not carry these rules.
- **A person-scoped rather than household-scoped income concept** — recurring:
  `childOwnIncomeAboveInstitutionalLimit` (Katie Beckett), `ownMonthlyIncome`
  (FPOS), `childMeetsIncomeAndAssetTest` (caretaker supplement). `incomeAtOrBelow`
  and `annualHouseholdIncome` assume one household aggregate.
- **`AGE_BANDS` is broken by ~a third of the batch.** `under-60 / 60-64 /
  65-plus` cannot express: 40-64 (Well Woman), 62 (Homestead), 55 for Native
  Americans (Senior Farmers Market), 18-59 (ADRC disability benefit
  specialists), under-19 (Katie Beckett), 18-61 (Homestead). This is the single
  most concrete vocabulary finding.
- **Categorical-status facts the interview has no shape for:** `childIsHomeless`,
  `childInFosterCare`, `isRelativeCaregiverOfChildInHome`,
  `isExperiencingHomelessness`, `isOfReproductiveAge`, `isWoman`,
  `isNativeAmerican`.
- **"Incorporated body of law" facts** — a single boolean standing in for an
  entire federal test: `qualifiesForFederalEIC`, `potentiallyEligibleForPublicAssistance`.
  These are real but the interview can never ask them.
- **Insurance-status facts** (Well Woman): `hasHealthInsurance`,
  `insuranceCoversScreenings`, `canAffordInsuranceCostSharing`,
  `eligibleForMedicare`.
- **Property / asset facts** (Project Home): `homeValueWithinLimit`,
  `homeNotForSaleOrInForeclosure`.

### `scopeColocated` — yes, but it is the field that needs redesign.

Across the batch: **14 figures colocated, 12 not colocated, 4 n/a**. That is a
discriminating split, not a field that came out all-one-way.

The 12 not-colocated cases are exactly the branch-drop hazard the survey exists
to measure (see §4). But the field's framing around *figures* has two gaps:

1. It has no honest value for a source with **no governing figure** (4 "no rule
   published" candidates — `null` was a stopgap).
2. It cannot record a **term-trap**: `wi-homestead-credit`'s "$24,680" is a fine
   number, but "household income" beside it is a 7-page statutory construction.
   The scope problem is in the noun, and the field only looks at the number.

**Change:** rename to `scopeSeparation`, widen it to point at a term as well as a
figure, and give it an honest `n/a` value for no-rule sources. Exact shape in §6.2.

---

## 3. What did a candidate cost?

- **Wall-clock:** 6–20 minutes per candidate, mean **11.2**. 1–3 fetches each.
- **Cheapest:** "no rule published" sources (SVdP 6 min, ADRC 7 min) — nothing
  to characterise.
- **Most expensive:** multi-page PDFs and regulations — `wi-homestead-credit`
  (26-page booklet, 18 min), `head-start-dane` (eCFR + local grantee, 20 min).
- **Token cost (agent):** the full session — 20 candidates + the fetch helper +
  `README.md` + `PROCEDURE.md` + this report — ran roughly **300k tokens total**,
  i.e. **~12–15k tokens per candidate**, dominated by reading structure-preserving
  source dumps (a government page is 4–20 KB of text after normalisation; a PDF
  more). No model API calls beyond the agent itself — `scripts/lib-source` was
  used only for fetching and text extraction.
- Extrapolating: **batch 2 (~40 candidates) ≈ 7–8 hours wall-clock, ~0.5–0.6M
  agent tokens** at pilot pace, before any schema-change rework.

---

## 4. Branch-drop — the measurement this survey exists for

**~9 of 20 candidates carry a real "a number is not the rule" hazard:**

| Candidate | The number | What it actually is |
|---|---|---|
| `seniorcare-wi` | 160% FPL | Level-1 cost-sharing tier. **No income ceiling** — Level 3 is "> 240% FPL, still enrolled". |
| `wi-chronic-disease-program` | 300% FPL | Deductible trigger. **No income ceiling.** |
| `head-start-dane` | 100% poverty | One of **four** qualifying routes; plus a 10% and a 35%/130% over-income allowance in separate subsections. |
| `wi-family-planning-only-services` | 306% FPL / $4,069.80/mo | Same limit, two units, on two pages; MAGI income-counting rules cross-referenced to another chapter. |
| `wi-senior-farmers-market-nutrition` | 185% FPL | Not on the public page at all — two documents downstream. |
| `wi-veterans-assistance-grant` | 200% FPL | Not on the program page; and carved out entirely for deployed-military families. |
| `wi-veterans-property-tax-credit` | *(none)* | **No income test at all** — the hazard is *inventing* one. |
| `madison-cda-public-housing` | $74,800 / $47,400 | Column-scoped: public housing (80% AMI) vs Section 8 (50% AMI). |
| `wi-homestead-credit` | $24,680 | Number is fine; "household income" beside it is a 7-page add-back construction. |

**Two things stand out:**

1. **The "FPL % that is a cost-share tier, not a ceiling" shape appeared twice
   independently** — `seniorcare-wi` and `wi-chronic-disease-program`, both
   Wisconsin DHS health programs. This is the retired `seniorcare-coverage-levels`
   case reproducing in a second program. It reads less like a fluke and more
   like a Wisconsin DHS house style. Worth naming as its own branch shape in
   `standing-decisions.md`, "The words".

2. **One case (`wi-veterans-property-tax-credit`) is the *looser* direction** —
   the risk is hallucinating an income ceiling onto a program that has none.
   `pipeline-principles.md` §3.1's reopen condition is "a wider corpus turns up
   numbers lifted out of scope in the looser direction *about as often*". At
   1-of-9 it is **not** triggered — but it is no longer zero, and batch 2 should
   count this direction explicitly.

**Also relevant to §5.3 (is deterministic parsing worth rebuilding):**
`html-structure.ts`'s `renderStructured()` — which keeps table column headers
and heading paths attached — *already prevented* the column-scope drop on
`madison-cda-public-housing` and `wi-earned-income-credit`. The failure only
appears if the page is flattened first. Whatever comes next, structure
preservation is worth **keeping**.

---

## 5. What surprised us

- **The hardest branch-drop cases need zero new vocabulary.** SeniorCare and the
  Chronic Disease Program are fully expressible with today's `FACT_KEYS`; the
  entire difficulty is a reader not treating the prominent FPL % as a ceiling. A
  schema that measures "new facts needed" scores these as trivial. This is why
  §6.4 adds a separate `expressibility` signal.
- **A county government body publishes no eligibility rule.** Dane County Housing
  Authority's own site states program purpose and waitlist status and *nothing*
  about the 50% AMI income rule. "No rule published" is not just a small-nonprofit
  phenomenon.
- **`AGE_BANDS` breaks under a third of the batch.** Expected the odd 62+ edge;
  did not expect 40-64, 55, 18-59, and under-19 all in one pilot.
- **Two `revenue.wi.gov` pages returned zero usable text** until
  `unwrap-shell.ts` neutralised an ASP.NET WebForms wrapper `<form>`. The
  form-shell recovery tool earned its place; a naive fetch of the Wisconsin DOR
  would have captured nothing.
- **Entity disambiguation was sometimes harder than rule capture.** "The Beacon"
  collides with an unrelated Ghana charity on a near-identical domain
  (`beaconhelps.org`); "Dane County Housing Authority" is at `dcha.net`, not the
  domain its name suggests.
- **Search snippets lied, on schedule.** CSFP: snippet said 130% FPL, the DHS
  page says 150%. Madison CDA income figures differed from a HUD-generic quote.
  Every figure in the 20 files traces to a fetched primary; the disagreements
  are logged in each file's `cost.notes`.

---

## 6. Named changes to apply to the 20 before batch 2

The bar for each of these is "a batch-2 researcher can fill it without a schema
doc, and someone can still `grep`/count it later" — not "it validates."

1. **Move to JSON5, rename the 20 files `.json` → `.json5`.** Comments become
   first-class, so the `_sourceText` / `_note` sibling-key hack goes away —
   `_sourceText` becomes a `//` comment on the line it annotates, `_note` becomes
   a block comment on the node. Nothing else about JSON5 is used (no unquoted
   keys, no trailing-comma reliance). Not `.ts`: a typed candidate would need the
   `Criterion` union widened with escape-hatch nodes and `Program`'s enums
   widened too, and every closed type is a place the survey silently rounds a
   surprising rule toward something that compiles — the exact risk this phase is
   guarding against. `.ts` is a later-pass concern, once we know what we're
   aligning to.
2. **`scopeColocated` → `scopeSeparation`.** Same idea, wider aperture: an entry
   is `{ scopeOf: "<the figure OR the term>", separation: "colocated" |
   "column-header" | "same-page-elsewhere" | "cross-reference" |
   "other-document" | "n/a — no governing figure", where: "<free text>" }`. The
   two gaps it closes: an honest value for no-rule sources (4 candidates used
   `null`), and the ability to point at a *term* (`wi-homestead-credit`'s
   "household income") not only a number.
3. **Capture `branchDropRisk` as its own key** instead of burying it in `_note`
   prose: `{ figure, takenNaivelyAs, actuallyIs, direction: "narrower" |
   "looser" }`. Loose object, but having `direction` as a named field is what
   lets batch 2 test `pipeline-principles.md` §3.1's reopen condition by
   counting (see §4).
4. **Capture `expressibility`** — one of `full` / `partial` /
   `manual-review-dominant` plus a sentence — so `factsNeeded: []` stops meaning
   both "trivial" (`wi-csfp`) and "hardest case in the batch" (`seniorcare-wi`).
5. **`format` as a fixed word list** (`html-prose`, `html-table`, `pdf`, `ecfr`,
   `wi-admin-code`, `none-published`, combinable) plus a free-text `formatNotes`
   for everything else. It was filled free-form in the pilot and is currently
   not aggregatable.
6. **Split multi-benefit orgs into separate candidate files; keep the survey
   instrument one-rule-per-file.** The line the shipped set already draws
   (`wheap-energy` vs `wheap-crisis` are split; `wi-211` and `dane-jfff` are
   single umbrellas) is *different benefit + different rule → separate record*.
   Apply it:
   - **Multi-condition, one benefit, one rule with alternatives** —
     `wi-chronic-disease-program` (renal / hemophilia / adult CF) — stays **one
     file** with an `anyOf`. This already worked.
   - **Multi-benefit orgs** — `dane-county-adrc` (I&A + Disability Benefit
     Specialists + Elder Benefit Specialist + LTC waiver + HS Transition),
     `svdp-madison-assistance` (pantry / pharmacy / vouchers / microlending /
     Seton) — **split into one file per sub-program that has its own rule and its
     own distinct benefit.** Keep a thin umbrella file only where the umbrella is
     itself a real "call here first" resource (ADRC's core I&A qualifies; SVdP's
     org page does not).
   - Add an optional **`umbrella` / `sharedFrontDoor`** pointer field so split
     files reference a shared "how to apply" front door instead of copying it.
   - **Not** a `subPrograms[]` array — that keeps the counting muddy and builds
     machinery for a disposable survey.
   - Accept that the candidate count grows (ADRC → ~3, SVdP → ~4). A bigger,
     more honest corpus is the phase's goal.
7. **Tag each `unencodable` entry with a `kind`**, anchored to the taxonomy the
   repo already has in `docs/data-authoring.md` ("Things the engine should not
   model") plus the three the pilot added:
   - from data-authoring: `asset-test`, `work-requirement`, `immigration`,
     `documentation`
   - new from the pilot: `professional-assessment` (Katie Beckett level-of-care,
     ADRC LTC screen, Kinship "best interests"), `agency-discretion` (Head Start
     10% / 35% allowances), `incorporated-law` (EIC "meet the federal
     requirements", Head Start part-1305 definitions)
   - `other` for the rest.
   Entry shape: `{ kind, text }`.

None of these change the *method* in `PROCEDURE.md` — only the file shape. The
method (find for variety → fetch with `lib-source` → read the structure-preserving
dump → resist the prominent number) is sound and carries into batch 2 as written.
`PROCEDURE.md` gets one addition: **reach for a "can't model this shape" note
before collapsing a rule to `manualReview` — a shape you didn't expect is a
finding, not a thing to simplify away.**

---

## 7. Bottom line

Go. The pilot produced 20 usable candidates **and** a procedure, at ~11 min and
~13k tokens each. `factsNeeded` is rich and already answers part of
`pipeline-principles.md` §5.2 (the `hasDisability` / `AGE_BANDS` questions).
`scopeColocated` measured the branch-drop signal (12 of 30 figures separated
from their scope; the cost-share-tier shape confirmed as recurring) but needs
the redesign in §6 before it carries 40 more. Apply §6 to the 20, then start
#102.
