# Income-table fixtures — provenance

Raw HTML snapshots fetched **2026-08-21** with `curl -A "<standard desktop Chrome UA>"`
(WI/government sites 403 a naive fetcher's default UA but serve a normal one — see
`docs/data-sources.md`). Used by `scripts/extract-income-tables.mjs` and
`tests/data/income-table-extraction.test.ts` so the measured hit rate in
`docs/eligibility-extraction.md` is reproducible offline, without a network call in CI.

| File | Source URL | What it publishes |
|---|---|---|
| `fpl.html` | https://aspe.hhs.gov/topics/poverty-economic-mobility/poverty-guidelines | 2026 HHS poverty guidelines, three tables (48 contiguous states + DC, Alaska, Hawaii) |
| `madcap.html` | https://www.cityofmadison.com/pay/madcap | City of Madison MadCAP water-bill assistance income table |
| `lifeline.html` | https://www.lifelinesupport.org/how-to-qualify/ | Federal Lifeline phone/internet subsidy income table, three regions |
| `wheap.html` | https://energyandhousing.wi.gov/Pages/AgencyResources/energy-assistance.aspx | WHEAP (WI home energy assistance) 60%-SMI table, program year 2025–2026 |

These are page snapshots, not live data — a real ingestion pipeline (#14) would refetch on
a schedule, not read these files. They exist so this repo's test suite can assert
"the extractor gets these four sources right" without depending on four government/nonprofit
websites staying up and unchanged for `npm test` to pass.

**Note on the numbers themselves, not just the fixture mechanics:** the `wheap.html` snapshot's
extracted table differs substantially from `src/data/reference/income-tables.ts`'s existing
`WI_SMI_60_2025` (e.g. household of 4: $73,888 here vs. $62,300 in the seed data — about
19% higher, not a normal annual adjustment's worth of drift). The `fpl.html` snapshot's
2026 guidelines are modestly higher than the seed `FPL_2025` table, consistent with a routine
annual update. Both comparisons are discussed in `docs/eligibility-extraction.md`; neither the
seed data nor this fixture has been reconciled as part of this spike — that is a
`docs/data-authoring.md` verification task, out of scope here.
