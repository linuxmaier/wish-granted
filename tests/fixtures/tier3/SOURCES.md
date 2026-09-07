# Tier-3 source fixtures — provenance

Real source snapshots for the Tier-3 deterministic-parse spike (issue #62,
experiment 3 — see `docs/eligibility-extraction-tier3.md`). Fetched **2026-09-06**
with a desktop-Chrome user agent
(`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36`);
WI state sites 403 a naive fetcher's default UA (matching `docs/data-sources.md`
and `docs/eligibility-extraction.md` §1). eCFR XML additionally requires an
`Accept-Encoding` that permits compression (`curl --compressed`).

These are page/document snapshots, not live data — the parser reads these so the
measured result in the doc is reproducible offline, without a network call in CI.
Verbatim bytes as fetched; not reformatted.

This directory is the **tuning split**: the classifier
(`scripts/tier3-extract/classify.mjs`, `extract.mjs`) was iterated against these
24 sources. The held-out split (`tests/fixtures/tier3-heldout/`) was frozen
before it was run and is where the approach is actually measured.

| File | Source URL | What it publishes |
|---|---|---|
| `ecfr-7-cfr-273.xml` | https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-7.xml?part=273 | 7 CFR part 273 — SNAP certification of eligible households (full part) |
| `ecfr-7-cfr-273-9.xml` | https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-7.xml?section=273.9 | 7 CFR 273.9 — SNAP income and deductions (section) |
| `ecfr-45-cfr-1302-12.xml` | https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-45.xml?section=1302.12 | 45 CFR 1302.12 — Head Start determining, verifying, documenting eligibility |
| `wi-admin-dhs-101.html` | https://docs.legis.wisconsin.gov/document/administrativecode/ch.%20DHS%20101 | Wis. Admin. Code ch. DHS 101 — Introduction and definitions (Medicaid) |
| `wi-admin-dhs-103-04.html` | https://docs.legis.wisconsin.gov/document/administrativecode/DHS%20103.04 | Wis. Admin. Code s. DHS 103.04 — Asset and income limits (Medicaid) |
| `foodshare-fpl.html` | https://www.dhs.wisconsin.gov/foodshare/fpl.htm | FoodShare Wisconsin — monthly income limits (table) |
| `foodshare-index.html` | https://www.dhs.wisconsin.gov/foodshare/index.htm | FoodShare Wisconsin — program landing page |
| `foodshare-basic-work-rules.html` | https://www.dhs.wisconsin.gov/foodshare/basic-work-rules.htm | FoodShare Wisconsin — basic work rules |
| `wic-income-guidelines.html` | https://www.dhs.wisconsin.gov/wic/income-guidelines.htm | Wisconsin WIC — income guidelines / adjunctive eligibility |
| `wic-apply.html` | https://www.dhs.wisconsin.gov/wic/apply.htm | Wisconsin WIC — how to apply / who is served |
| `badgercareplus-fpl.html` | https://www.dhs.wisconsin.gov/badgercareplus/fpl.htm | BadgerCare Plus — income limits and thresholds (table) |
| `badgercareplus-index.html` | https://www.dhs.wisconsin.gov/badgercareplus/index.htm | BadgerCare Plus — program landing page |
| `seniorcare-fpl.html` | https://www.dhs.wisconsin.gov/seniorcare/fpl.htm | SeniorCare — annual income limits by participation level |
| `qmb.html` | https://www.dhs.wisconsin.gov/medicaid/qmb.htm | Qualified Medicare Beneficiary (QMB) Program |
| `sebt-index.html` | https://www.dhs.wisconsin.gov/sebt/index.htm | Wisconsin DHS — Summer EBT |
| `energy-assistance.html` | https://energyandhousing.wi.gov/Pages/AgencyResources/energy-assistance.aspx | WHEAP — energy assistance (prose + 60%-SMI income table) |
| `weatherization.html` | https://energyandhousing.wi.gov/Pages/AgencyResources/weatherization.aspx | WI Weatherization Assistance Program |
| `emergency-assistance.html` | https://dcf.wisconsin.gov/ea | Wisconsin DCF — Emergency Assistance (EA) |
| `homestead-credit.html` | https://www.revenue.wi.gov/Pages/FAQS/ise-home.aspx | Wisconsin DOR — claiming Homestead Credit |
| `wishares-parents.html` | https://dcf.wisconsin.gov/wishares/parents | Wisconsin Shares — income eligibility |

`ecfr-7-cfr-273.xml` covers several source rows (273.9(a), 273.1(b)(2),
273.9(d), 273.2(i), 273.7/273.24, 273.4); `scripts/tier3-extract/sources.mjs`
narrows each to the relevant paragraph sub-tree with a `paragraphFilter`.
