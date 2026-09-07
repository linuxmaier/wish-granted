# Tier-3 held-out fixtures — provenance

The **frozen held-out split** for the Tier-3 deterministic-parse spike (issue
#62, experiment 3 — see `docs/eligibility-extraction-tier3.md`).

Fetched **2026-09-06** with a desktop-Chrome user agent, AFTER the classifier
(`scripts/tier3-extract/classify.mjs`, `extract.mjs`) had been iterated against
the tuning split (`tests/fixtures/tier3/`) and BEFORE it was run against these.
`expected` in `scripts/tier3-extract/sources.mjs` (`TIER3_HELDOUT`) was assigned
by reading each source and the fact vocabulary — never by looking at parser
output. This is the #43 / #51 held-out methodology: the tuning number measures
the tuning, this one measures the approach.

Verbatim bytes as fetched; not reformatted.

| File | Source URL | What it publishes |
|---|---|---|
| `mapp.html` | https://www.dhs.wisconsin.gov/medicaid/medicaid-purchase-plan.htm | Medicaid Purchase Plan (MAPP) — 250% FPL gated on disability + work + asset test |
| `well-woman.html` | https://www.dhs.wisconsin.gov/wwwp/index.htm | Wisconsin Well Woman Program — 250% FPL gated on age band + insurance status |
| `katie-beckett-eligibility.html` | https://www.dhs.wisconsin.gov/kbp/eligibility.htm | Katie Beckett Medicaid — eligibility (no income figure; disability / level of care) |
| `family-planning-only.html` | https://www.dhs.wisconsin.gov/fpos/index.htm | Family Planning Only Services — bare $/month figure + childbearing-age + Medicaid negation |
| `slmb.html` | https://www.dhs.wisconsin.gov/medicaid/slmb.htm | Specified Low-Income Medicare Beneficiary — 100–120% FPL range, after credits, Medicare gate |
| `w2-parents.html` | https://dcf.wisconsin.gov/w2/parents | Wisconsin Works (W-2) — employment services landing page (no rule) |
| `dpi-free-reduced-meals.html` | https://dpi.wi.gov/school-nutrition/program-requirements/free-reduced-meal-eligibility | WI DPI — free/reduced meal eligibility (direct-certification categorical list, prose) |
| `medicaid-fpl-guidelines.html` | https://www.dhs.wisconsin.gov/medicaid/fpl.htm | WI Medicaid — FPL multiples reference table with a per-program "Program limits" row |
| `ecfr-7-cfr-246-7.xml` | https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-7.xml?section=246.7 | 7 CFR 246.7 — WIC certification (income criteria are a state-option range) |
| `lifeline-do-i-qualify.html` | https://www.lifelinesupport.org/do-i-qualify/ (→ /how-to-qualify/) | Lifeline — 135% FPL + categorical list, AND a survivor-only 200%-FPL extended branch on the same page |
