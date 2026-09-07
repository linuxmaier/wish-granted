# Tier-3 second held-out fixtures — provenance

The **clean measurement set** for the Tier-3 deterministic-parse spike
(issue #71, building on #69 / issue #62 experiment 3 — see
`docs/eligibility-extraction-tier3.md` §9).

The `docs/eligibility-extraction-tier3.md` §4.2 held-out number is **tuned**: the
five signal-set rules added to `scripts/tier3-extract/classify.mjs`,
`extract.mjs`, and `html-structure.mjs` were written against the exact failures
the first held-out split surfaced. This third frozen set was fetched **2026-09-07**
with a desktop-Chrome user agent, AFTER those rules landed and BEFORE the parser
was ever run against it. `expected` in `scripts/tier3-extract/sources.mjs`
(`TIER3_HELDOUT2`) was assigned by reading each frozen fixture and the fact
vocabulary — never by looking at parser output. No source here appears in
`TIER3_SOURCES` (tuning) or `TIER3_HELDOUT` (burned split).

Weighted per issue #71 toward the shape that has broken every design so far: a
plausible percentage whose governing scope sits somewhere structural (an age
band, a disability / program-enrolment gate, a cost-sharing or income-deductible
tier, a "higher of" floor, a subpopulation branch). 14 sources: 12 `abstain`,
2 `extract` controls (a categorical situational test; a clean poverty-line
ceiling) so the run can tell "safe" from "abstains on everything".

Verbatim bytes as fetched; not reformatted. eCFR text is the real
`/api/versioner/v1/full/2026-09-01/…` endpoint.

| File | Source URL | Fetched | What it publishes |
|---|---|---|---|
| `qdwi.html` | https://www.dhs.wisconsin.gov/medicaid/qdwi.htm | 2026-09-07 | QDWI — 200% FPL "after certain credits" in an AND-list with disability + Medicare Part A + asset test |
| `slmb-plus.html` | https://www.dhs.wisconsin.gov/medicaid/slmb-plus.htm | 2026-09-07 | SLMB+ — countable income *between* 120% and 135% FPL, Medicare gate, asset test |
| `wcdp.html` | https://www.dhs.wisconsin.gov/forwardhealth/wcdp.htm | 2026-09-07 | Wisconsin Chronic Disease Program — 300% FPL is an income deductible, not a ceiling; diagnosis-gated |
| `hdap-clients.html` | https://www.dhs.wisconsin.gov/hiv/hdap-clients.htm | 2026-09-07 | HIV Drug Assistance Program — income ≤300% FPL AND "living with HIV, confirmed by a doctor" |
| `tmj.html` | https://dcf.wisconsin.gov/w2/tmj | 2026-09-07 | Transform Milwaukee Jobs — 150% FPL in an AND-list + a four-way subpopulation branch |
| `caretaker-supplement.html` | https://www.dhs.wisconsin.gov/ssi/caretaker.htm | 2026-09-07 | Caretaker Supplement — no income figure; SSI-parent categorical gate |
| `family-care.html` | https://www.dhs.wisconsin.gov/familycare/index.htm | 2026-09-07 | Family Care — no income figure; age 18+, disability, functional screen |
| `dor-earned-income-credit.html` | https://www.revenue.wi.gov/Pages/FAQS/ise-eic.aspx | 2026-09-07 | WI Earned Income Credit — 4/11/34% are credit shares by child count, not income; qualifying-child gate |
| `ecfr-42-cfr-435-119.xml` | https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-42.xml?section=435.119 | 2026-09-07 | Medicaid adult (expansion) group — 133% FPL gated on age 19–64, not pregnant, not Medicare |
| `ecfr-42-cfr-435-118.xml` | https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-42.xml?section=435.118 | 2026-09-07 | Medicaid infants/children — 133% / 185% FPL "the higher of", scoped by age group, set in the State plan |
| `ecfr-42-cfr-423-773.xml` | https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-42.xml?section=423.773 | 2026-09-07 | Medicare Part D low-income subsidy — 135% / 150% FPL tiers, Part D / Medicare gate, resource test |
| `ecfr-24-cfr-5-603.xml` | https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-24.xml?section=5.603 | 2026-09-07 | HUD Section 8 income definitions — 80% / 50% / 30% of area median income, with HUD discretion |
| `wic-index.html` | https://www.dhs.wisconsin.gov/wic/index.htm | 2026-09-07 | WIC landing page — categorical situational test (pregnant / breastfeeding / postpartum / child <5) — EXTRACT control |
| `headstart-resource-guide.html` | https://dcf.wisconsin.gov/childcare/parents/resource-guide/head-start | 2026-09-07 | WI Head Start — "incomes below the poverty guidelines" = a clean 100% FPL ceiling — EXTRACT control |

These are page snapshots so `tests/data/tier3-extraction.test.ts` runs offline in
CI. A real ingestion pipeline (#14) would refetch on a schedule.
