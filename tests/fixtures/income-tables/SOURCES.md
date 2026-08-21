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

**Note on the numbers themselves, not just the fixture mechanics:** when these fixtures were
first fetched, `src/data/reference/income-tables.ts`'s income tables were still unverified
(drafted from memory, per that file's own docstring at the time), and this extractor's output
disagreed with them substantially — e.g. `wheap.html`'s household-of-4 figure was $73,888
against a then-seed value of $62,300. Issue #3 landed independently afterward and verified
the real tables by an entirely different route: a human read the HHS Federal Register notice
and the WHEAP PY26 manual PDF directly. **The verified `FPL` and `WI_SMI_60`
(src/data/reference/income-tables.ts) now agree with this extractor's output exactly** — see
`tests/data/income-table-extraction.test.ts`'s "corroboration" block, which asserts this and
will fail if either side ever drifts. Two independently-arrived-at numbers landing on the same
figure is stronger evidence for both than either alone; full discussion in
`docs/eligibility-extraction.md` Section 3. `DANE_AMI` has no corresponding comparison here —
HUD's dataset format was out of scope for this HTML-table extractor (see `NOT_ATTEMPTED` in
`scripts/extract-income-tables.mjs`), so this spike has nothing to agree or disagree with it.
