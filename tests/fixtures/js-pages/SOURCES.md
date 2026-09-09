# JS/SharePoint page fixtures — provenance

Raw HTML snapshots fetched **2026-09-07** with a plain `fetch()` carrying the standard
desktop-Chrome User-Agent from `scripts/refresh-income-tables/lib/http.ts` (WI/government
sites 403 a naive fetcher's default UA but serve a normal one — see `docs/archive/data-sources.md`).
No headless browser was used to capture these — that is the point (see below).

Used by `scripts/render-fallback/` (`index.ts --self-test` and
`lib/__tests__/recover.test.ts`) to prove issue #76's before/after **without a network call
in CI**: a plain fetch of these pages reduces to **zero** readable text under
`scripts/check-sources/lib/normalize.ts` and
`scripts/agentic-extract/lib/html-structure.ts`, and `recoverEmptyPage()` turns that into
the full eligibility content — table column headers and heading hierarchy intact.

| File | Source URL | What it publishes |
|---|---|---|
| `wheap-energy-assistance.aspx.html` | https://energyandhousing.wi.gov/Pages/AgencyResources/energy-assistance.aspx | WHEAP (WI Home Energy Assistance Program): "About the Program", regular vs. crisis benefits, and the **Income Guidelines** table — household size × one-month / annual income, "Based on 60% of Wisconsin's median income", 2025–2026 program year. Cited `source.url` for `wheap-energy-assistance` and `wheap-crisis-assistance`. |
| `weatherization.aspx.html` | https://energyandhousing.wi.gov/Pages/AgencyResources/weatherization.aspx | Wisconsin Weatherization Assistance Program (WAP): program description, funding, what it covers, and how eligibility is determined (automatic for energy-assistance recipients; otherwise by local agency). Cited `source.url` for `wisconsin-weatherization`. |

## The #76 finding these fixtures record

#76 was filed as "energyandhousing.wi.gov is a SharePoint/JS-rendered SPA; a plain fetch
returns a shell, so we need a headless browser." **That premise is wrong**, and these
fixtures are the evidence:

- The bytes you see here are a *plain* `fetch()` — no browser. They already contain the
  WHEAP income table (`$3,201.75` / `$38,421` … for a household of 1, etc.), the 60%-SMI
  note, and the crisis-assistance prose. Nothing is injected by JavaScript. A headless
  render of the same URL returns the same bytes.
- Both extraction pipelines saw "zero readable text" for one reason: ASP.NET WebForms
  (which SharePoint is built on) wraps the **entire** `<body>` in a single
  `<form id="aspnetForm" method="post">`, and both reducers strip `<form> … </form>`
  wholesale to drop CSRF/session `<input>`s. That one strip deletes the whole document.
- The fix (`scripts/render-fallback/lib/unwrap-shell.ts`) neutralises that wrapper form
  only when a page has already reduced to nothing, so the reducers can see the content
  that was there all along. No browser needed for any source in the dataset today.

These are page snapshots, not live data — a real ingestion pipeline (#14, #67) refetches on
a schedule. They exist so the test suite can assert the recovery works without depending on
`energyandhousing.wi.gov` staying up and unchanged for `npm test` to pass. If the live
pages are restructured, re-fetch with the same UA and update this file's date.
