# Framing-spike fixtures (issue #62)

Real HTML fragments, fetched with a desktop-Chrome user agent (per
`docs/eligibility-extraction.md` Section 1: WI state sites 403 a naive fetcher).
Stored verbatim except where noted, so `structure-excerpt.ts` and its test operate
on ground-truth markup rather than a paraphrase.

| File | Source | Fetched | URL | Notes |
|---|---|---|---|---|
| `wi-medicaid-fpl-chart.html` | Wisconsin DHS -- Medicaid: Federal Poverty Level Guidelines | 2026-09-06 | https://www.dhs.wisconsin.gov/medicaid/fpl.htm | The `<table>` element only, extracted verbatim. One change: the caption en-dash (`2026–January`) normalised to an ASCII hyphen to match the dataset convention. `&nbsp;` entities left as fetched. The `Program limits` row is the point of the fixture: each program acronym (`QMB`, `MAPP Premium Threshold`, `SLMB`, `SLMB+`, `QDWI and Lower`, `MAPP`) sits in a `<td>` under a percent-of-FPL column header, so its scope is carried entirely by column position. |

These fixtures are frozen. If a source changes, add a new dated row rather than
overwriting -- same rule as `tests/fixtures/income-tables/SOURCES.md`.
