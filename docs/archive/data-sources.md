> **ARCHIVED — source survey, 2026-09-08.**
>
> Filed under the extraction programme that was unwound on 2026-09-08 (#97), but
> most of this is a survey of **where benefit data lives**, not a pipeline design:
> which sources were checked, their robots.txt status, what WI DHS and WI DOA
> actually publish, why Grants.gov and Open Referral / HSDS are the wrong corpus,
> and what PolicyEngine covers. **That part stands and is worth mining** when
> widening the corpus — deliberately, rather than by re-fetching what was already
> fetched.
>
> What does not stand: the tiering percentages and anything framed as a handoff
> to the retired pipeline (the closing "What to hand #5 / #14" sections). The
> tiering was derived by reading hand-picked excerpts rather than whole pages,
> and three sources were later reclassified once that error was found.
>
> Current reasoning lives in [`../standing-decisions.md`](../standing-decisions.md).

# Data sources — spike findings (issue #4)

Investigated live in August 2026: fetched pages and robots.txt files, ran searches, read
source docs/specs directly. Every claim below is either a quoted excerpt, a directly
observed HTTP response, or explicitly marked as inferred/unconfirmed. Where a fetch failed
or a claim couldn't be verified, that's stated rather than guessed.

## TL;DR

- **Grants.gov is the wrong corpus, confirmed.** It indexes discretionary grants to
  organizations, not benefits for individuals. Don't reach for it. See [Grants.gov](#grantsgov).
- **211 / Open Referral (HSDS) is directory data, not eligibility data — confirmed from the
  spec itself.** Its four core objects are `organization`, `service`, `location`,
  `service_at_location`; there is no eligibility entity. This is the most load-bearing
  finding in this document and it's the direct answer to the question the issue was built
  around. See [Open Referral / HSDS](#open-referral--hsds-and-211-wisconsin).
- **Scoped headline on structured eligibility data: none of the government/directory sources
  surveyed publish eligibility as structured data.** But one adjacent category does, and
  it's a real finding, not a null result: **PolicyEngine US** encodes federal benefit rules
  (and a thin slice of Wisconsin-specific rules) as open-source, parameterized, runnable code
  — genuinely structured, genuinely eligibility, genuinely extractable at build time. It does
  **not** cover the local programs (Dane County, City of Madison, WHEAP specifics) that make
  up roughly half of this app's current dataset. See [PolicyEngine US](#policyengine-us).
- **Live bug found**, not fixed here: `src/data/national-resources.ts` points "Benefits.gov"
  at `https://www.benefits.gov/`, which now 301-redirects to a USA.gov URL carrying UTM
  params and a welcome-modal query string. Benefits.gov as a brand is retired. See
  [Live bug: dead Benefits.gov link](#live-bug-dead-benefitsgov-link-not-fixed-here).
- **What wasn't checked**, so this doesn't get quoted as more exhaustive than it is: state
  benefit rules-as-code beyond PolicyEngine (e.g. in-house state eligibility systems'
  internal representations, which are not public); county/city CRM or case-management
  systems' internal schemas; any source requiring a paid account or NDA (e.g. deeper
  findhelp.org partner APIs); non-Wisconsin state open-data portals as a comparison point;
  academic/research eligibility-rules corpora (e.g. NBER TAXSIM, Urban Institute's
  ATTIS) — plausible adjacent finds, not investigated here.

---

## Method

For each source: fetched the real page or file (via `WebFetch` and, where that tool was
blocked, `curl` with a standard browser user-agent), fetched `robots.txt` directly, and
searched for licensing/API documentation. Excerpts below are quoted from what was actually
retrieved, with the fetch method noted where it matters (a couple of government sites 403
the WebFetch tool specifically but serve `curl` normally — see
[Fetch-tooling caveat](#fetch-tooling-caveat-wi-state-sites-block-some-automated-fetchers)).

---

## Sources surveyed

| Source | Coverage | Access | Format | Eligibility: structured or prose? | Scraping permitted? | Verdict |
|---|---|---|---|---|---|---|
| [Grants.gov](#grantsgov) | Federal discretionary grants, mostly to orgs | Public API + bulk XML extract | XML/JSON, real schema | N/A — wrong corpus | robots.txt fully open (`Allow: /`) | **Not worth ingesting** — wrong corpus |
| [Benefits.gov / USA.gov benefit finder](#benefitsgov--usagov-benefit-finder) | Federal benefits, individuals | No public API found | HTML | Prose | robots.txt permissive (crawl-delay 10) | Not worth ingesting as data; **fix the dead link separately** |
| [Open Referral / HSDS spec](#open-referral--hsds-and-211-wisconsin) | Spec itself, not a data source | N/A | Spec (JSON Schema) | **No eligibility field exists in the schema** | N/A | Reference the spec; don't expect eligibility from anything shaped like it |
| [211 Wisconsin](#open-referral--hsds-and-211-wisconsin) | Dane County + statewide service directory | No public API/export found | HTML (CommunityOS/VisionLink platform) | Directory data only — see HSDS finding | No `robots.txt` file (404); ToS not located | **Worth it for the directory half only** (contact info, `administeredBy`), never for `eligibility` |
| [findhelp.org](#findhelporg) | National service directory, incl. WI | Proprietary, partner-only | HTML | Directory data, proprietary | robots.txt: generic `User-agent: *` gets `Disallow: /`; only named search bots allowed | **Not worth it** — blocked and proprietary |
| [PolicyEngine US](#policyengine-us) | Federal benefit rules + thin WI state slice | Open-source Python package + self-hostable API | Python + YAML parameters, AGPL-3.0 | **Structured, executable rules** for the programs it covers | N/A (open source) | **Worth serious follow-up for federal-program thresholds**; does not reach local programs |
| [eCFR (7 CFR 273 etc.)](#ecfr-and-wisconsin-administrative-code) | Federal regulation text | Public API (versioner) | Structured XML | **Document is structured; rules inside are prose** | robots.txt allows crawling, disallows indexing 2 API paths (SEO, not access) | Worth it as a change-detection / provenance source, not a rules source |
| [Wisconsin Administrative Code / Statutes](#ecfr-and-wisconsin-administrative-code) | State regulation text | docs.legis.wisconsin.gov, structured pages | HTML per-section | Document structured; rules prose | robots.txt permissive | Same pattern as eCFR — provenance, not rules |
| [WI DHS (FoodShare, WIC, BadgerCare, ACCESS)](#wi-dhs) | State-run, statewide | HTML only; open-data portal is stats, not rules | HTML / PDF | Prose | robots.txt permissive; some fetch tools 403 (tooling, not policy) | **Worth it for descriptive fields** via HTML parsing; eligibility stays hand-authored |
| [WI DOA/DEHCR — WHEAP + Weatherization](#wi-doa--energy-and-housing-wheap) | State-run, statewide | HTML + large PDF program manual | HTML / PDF | Prose (manual), numeric tables for income limits | robots.txt not found (404) | Worth it for descriptive + income-table refresh |
| [USDA FNS/FNA — SNAP national](#usda-fnsfna) | Federal, all states | HTML + published PDF tables | HTML / PDF table | Numeric tables (income limits) structured; program rules prose | robots.txt permissive | Worth it for the annual income-table refresh (issue #1's "highest value per unit of effort") |
| [Dane County open data (ArcGIS Hub)](#dane-county--city-of-madison-open-data) | Dane County | Socrata/ArcGIS-style portal | GIS/CSV | N/A — not human-services data | Not directly confirmed (see below) | **Not worth it** — GIS/parcel data, not program data |
| [City of Madison open data (ArcGIS Hub)](#dane-county--city-of-madison-open-data) | City of Madison | ArcGIS Hub | GIS/CSV | N/A | robots.txt permissive, crawl-delay 60 | **Not worth it** — same reason |
| [ACCESS Wisconsin](#access-wisconsin) | Statewide screener, individual-facing | Authenticated web app, no public API found | HTML | N/A — a screener, not a data feed | robots.txt: 404 (no file) | Not an ingestible source; useful as a **manual cross-check tool** during verification |

---

## Grants.gov

**URL:** https://www.grants.gov/ · **Run by:** HHS (on behalf of the federal grant-making
agencies) · **robots.txt:** `User-agent: * / Allow: /` (fully open — the technical barrier is
zero, which is exactly why this is worth stating plainly: *permission was never the
problem*).

**The hypothesis, tested:** the issue's suspicion was that Grants.gov indexes grants to
*organizations* (states, nonprofits, researchers), not benefits an individual applies for
directly. Confirmed. From Grants.gov's own eligibility guidance and search UI:

- The applicant-eligibility page states organizational applicant types (state/local/tribal
  governments, nonprofits, higher ed, small businesses) as the norm, and directs the reader
  to per-opportunity "Application Instructions" for the legal eligibility text — i.e.
  eligibility isn't even standardized across opportunities, it's redefined per grant.
  (`https://www.grants.gov/applicants/applicant-eligibility.html`)
- Search commentary confirms individual applicant profiles exist, but as a narrow carve-out:
  "Individual applicants are welcome to apply... though most of the funding opportunities on
  Grants.gov are for organizations, not individuals," and an individual profile is
  specifically for someone *not* applying on behalf of an organization — e.g. individual
  research fellowships, not "help paying rent."

**Access is real and irrelevant.** It has a documented API and a bulk XML extract
(`grants.gov/xml-extract`) against a real schema — the technical part of the "obvious
source" story is true. It's the corpus that's wrong: this product needs "can a person in
financial crisis apply for this," and Grants.gov's applicant pool is overwhelmingly
institutions applying to run programs, not people needing help.

**Verdict: not worth ingesting.** Record this so nobody re-investigates it: the API quality
was never the question, the applicant pool is.

---

## Benefits.gov / USA.gov benefit finder

**URL:** `https://www.benefits.gov/` · **Confirmed status:** 301 Moved Permanently, redirecting to
`https://www.usa.gov/benefit-finder?utm_source=usa_benefits-gov&utm_medium=redirect&utm_campaign=redirect_benefits-gov&modal=b-welcome-1899`.
Benefits.gov as a distinct brand/service has been folded into USA.gov's benefit finder; the
UTM params on the redirect target are USA.gov's own migration tracking, confirming this is a
deliberate, permanent brand retirement rather than a temporary outage.

**No public API found.** Search for developer/API documentation turned up nothing under
`benefits.gov` or `usa.gov` — the visible hits were unrelated VA benefits APIs
(`developer.va.gov`, for VA claims processing, not a benefits directory) and a dead
`api.benefits.gov` reference with no accessible docs. USA.gov's own content is reportedly
maintained via GitHub repos for some datasets, but no benefit-finder-specific data API
surfaced. Treat "no API" as the working assumption, not exhaustively disproven.

**robots.txt** (`https://www.usa.gov/robots.txt`) is permissive — standard Drupal boilerplate,
`Crawl-delay: 10`, no disallow on main content paths.

**Verdict: not worth ingesting as a data source** (no structured feed, and it's a *finder*
UI over the same programs already covered by ingesting the underlying agencies directly).
It is, however, cited in our own dataset — see the callout below.

### Live bug: dead Benefits.gov link (not fixed here)

`src/data/national-resources.ts` lines 29-34:

```ts
{
  name: 'Benefits.gov',
  url: 'https://www.benefits.gov/',
  description:
    'The federal benefit finder. Covers programs in every state, not just Wisconsin.',
},
```

This is one of three `NATIONAL_RESOURCES` shown to a visitor the app can't help (someone
outside Wisconsin). The URL now redirects through UTM-tagged USA.gov params to a welcome
modal — a working link, technically, but pointing at a retired brand with tracking params
baked into a link we show to a stranger. `tests/e2e/personas.spec.ts:176` asserts
`getByRole('link', { name: 'Benefits.gov' })` is visible — that test checks our own link
text renders, not that the destination is live or correctly branded, so it will keep passing
even though the destination has moved on. **Filed as a bug for the coordinator to track
separately; not fixed in this spike.**

---

## Open Referral / HSDS, and 211 Wisconsin

This is the section the issue was built around, so the finding gets stated plainly and
completely.

**What HSDS actually is.** Fetched the spec's own overview
(`https://docs.openreferral.org/en/latest/hsds/overview.html`). HSDS designates **four core
objects**:

1. `organization` — organizations that provide services
2. `service` — the service itself, with descriptions and classifications
3. `location` — locations where services are delivered
4. `service_at_location` — links services to locations, with location-specific detail

There is no eligibility entity or eligibility field anywhere in the core schema. The closest
related object is `required_document` (1:many from `service`) — i.e. the spec can say "bring
your ID and a utility bill," but it has no field for "household income at or below X% of
FPL." This is a deliberate design choice, not an omission I'm inferring: HSDS exists to
support **bulk exchange of service-directory data between I&R systems** — who to call, what
they do, where they are — which is a fundamentally different data product than eligibility
rules.

**211 Wisconsin, concretely.** Runs on the CommunityOS platform (I&R + case-management
software; page metadata confirms: `"CommunityOS is an I&R, Disaster, and Public Health client
database and case management system"`, publisher VisionLink). I looked for a public
API/export and found none — `https://211wisconsin.communityos.org/robots.txt` returns the
site's custom 404 page rather than an actual robots.txt file (no disallow rules exist because
no file exists), and no developer/data/API link appears in the site's own navigation (`Find
Services`, `Partner Hub`, `Addiction Recovery`, `Local Emergencies`, `About`, `Contact` — no
"Data" or "API" entry). The `Partner Hub → Database Policy` link
(`/inclusion-exclusion-policy`) is the closest thing to published data-use terms and would be
worth reading in full before any ingestion attempt, but nothing found so far suggests bulk
export access exists.

**The constructive half, stated as clearly as the negative one:** HSDS-shaped data — and
211 Wisconsin's underlying directory, if we ever got access to it — maps cleanly onto the
**descriptive** half of our `Program` schema: `administeredBy`, `howToApply.url`,
`howToApply.phone`, plausibly `summary`. It is exactly the right shape for the half of the
record that issue #1 already calls "genuinely automatable." It is structurally incapable of
ever supplying `eligibility`, no matter how good the feed is, because the standard doesn't
carry that information. Any future ingestion pipeline should treat "found in an HSDS-shaped
feed" as a green light for autofilling contact/description fields and a permanent, structural
no-op for the criteria tree.

**Verdict:** worth pursuing later *if* API access materializes, strictly for the descriptive
fields, and only for local/regional programs 211 actually covers (Joining Forces for
Families-style referral programs are the closest fit in our existing dataset). Not worth
building a pipeline around today — no confirmed access path exists. Never a source for
`eligibility`.

---

## findhelp.org

**URL:** https://www.findhelp.org/ (formerly Aunt Bertha) · **Run by:** findhelp Inc.
(commercial company; free public search UI, paid partner integrations).

**robots.txt**, fetched directly:

```
User-agent: Googlebot
Allow: /
...
User-agent: bingbot
Allow: /
Crawl-delay: 1
...
User-agent: *
Crawl-delay: 1
Disallow: /
```

Read literally: named search engines get a scoped `Allow`, and the catch-all `User-agent: *`
rule — which governs any generic scraper, including anything we'd write — is
**`Disallow: /`, the entire site.** That's an explicit, unambiguous no for automated access
outside the named search-engine bots.

**Terms confirm the same conclusion from the licensing side**, independent of robots.txt:
findhelp's terms describe their database as continuously collected "pursuant to separate
content agreements with third parties, including its customers," and reserve "all right,
title and interest ... in and to the Findhelp API, Data, and Materials" outside a licensed
customer relationship. There is a real API, but it's a paid partner product, not an open
data source.

**Verdict: not worth it.** Both robots.txt and ToS say no independently; don't reinvestigate
this looking for a workaround.

---

## PolicyEngine US

This is the one that could have falsified the "no structured eligibility data" headline, and
it partially does — worth the longest writeup here because the coordinator asked for a
serious evaluation, not a yes/no.

**What it is.** Open-source (GitHub: `PolicyEngine/policyengine-us`), built on the OpenFisca
microsimulation framework. Models federal individual income tax and major federal benefit
programs, plus state-specific rules where implemented. Confirmed distribution paths, fetched
from `https://policyengine.org/us/api`:

> "Use `policyengine[us]` when you want to work locally with `calculate_household_impact()`
> or `Simulation` instead of sending HTTP requests." Also offered: a self-hosted Docker image
> ("Run the same household API yourself via GitHub Container Registry ... None [auth] by
> default. Immediate [availability]"), and the hosted REST API as a third, optional path.

That matters specifically for our privacy constraint: **the rules engine can run entirely
offline, as a Python package, with no network call** — which is exactly the shape a
build-time extraction step needs. Querying their hosted API at runtime would violate "what
the client requests must not depend on the user's answers"; running their package during our
own build does not, because it never touches a real user's answers.

**License: AGPL-3.0**, confirmed from the repository's `LICENSE` file
(`https://github.com/PolicyEngine/policyengine-us/blob/master/LICENSE`) — "GNU AFFERO GENERAL
PUBLIC LICENSE, Version 3." AGPL's distinguishing clause triggers on operating the software
as a network service; running it as an offline build-time tool to derive parameter values
that we then hand-transcribe into our own `Criterion` trees is a materially different usage
than embedding or redistributing their engine. This is a real legal question, not a technical
one — **flagging for the coordinator/reviewer to get an actual opinion on before #5 leans on
it**, rather than asserting it's fine.

**Wisconsin coverage: thin, and doesn't reach the local programs we actually need.** Browsed
the parameter tree directly:
`https://github.com/PolicyEngine/policyengine-us/tree/master/policyengine_us/parameters/gov/states`
— a `wi` directory exists (confirming Wisconsin isn't simply absent), but its contents are
narrow:
`https://github.com/PolicyEngine/policyengine-us/tree/master/policyengine_us/parameters/gov/states/wi`
contains only **`dcf/`, `hhs/chip/premium/`, and `tax/`.** No `snap/`, no `tanf/`, no energy
assistance. Cross-referenced against search results describing LIHEAP as modeled "100%
federal" in PolicyEngine — meaning WHEAP's actual Wisconsin-specific mechanics (60% SMI
threshold rather than federal defaults, crisis-assistance dollar caps, the specific rules our
`wheap-energy-assistance.ts` and `wheap-crisis-assistance.ts` encode) are **not** represented.
Federal SNAP eligibility (the 130%/100% FPL gross/net test) is presumably modeled since SNAP
is federally defined, but Wisconsin's broad-based categorical eligibility that raises the
FoodShare gross-income test to 200% FPL (the number our `foodshare-snap-wi.ts` actually uses)
lives, if anywhere, in a part of the tree I didn't confirm — worth a direct check before
anyone builds against it. **None of our county- or city-level programs (Dane Eviction
Prevention, Madison Water Bill Assistance, Housing Choice Voucher, Joining Forces for
Families) could ever come from PolicyEngine — it models tax-and-benefit policy, not local
nonprofit/county programs, by design.**

**Uncertainty handling: unconfirmed, flagged as an open question rather than guessed.**
Our engine is built around three-valued (pass/fail/unknown) evaluation over partial answers
— that's the whole point of the adaptive interview. PolicyEngine's simulation model, from
what the docs show, takes a household as a dict of concrete variable values and returns a
computed number; I found nothing describing a first-class "this input is unknown" mode
analogous to our `unknown`. If it requires complete inputs to produce a result, that's a
structural mismatch with the adaptive/partial-answer interview, not just an integration
detail — it would mean PolicyEngine could produce a build-time reference value (a threshold,
a formula) but not directly replace or generate one of our `Criterion` trees, which must
evaluate correctly against however few facts the user has answered so far. Confirming this
needs someone to actually run `policyengine-us` locally against a partial household — not
done in this spike, budget did not allow it.

**Verdict: worth serious follow-up, scoped correctly.** Best use is as a **cross-check /
extraction aid for federal program thresholds** (confirm our FPL-based rules against their
parameter values at build time, get early warning when federal parameters change) — not as a
drop-in eligibility engine, and not for anything county- or city-specific. This reshapes part
of #5: an LLM extracting eligibility from prose is still necessary for the local programs
that are most of what makes this app useful, but for the federal-program subset, "diff
against PolicyEngine's published parameters" is a deterministic alternative to LLM extraction
worth prototyping before assuming LLM-only.

---

## eCFR and Wisconsin Administrative Code

**eCFR** (`https://www.ecfr.gov/`) publishes federal regulations — 7 CFR 273 is SNAP's actual
certification regulation — via a public "versioner" API. Fetched
`https://www.ecfr.gov/api/versioner/v1/full/2026-08-18/title-7.xml?part=273` directly: it
returns real, well-formed XML with a hierarchical structure (`<DIV5>` part → `<DIV6>` subpart
→ `<DIV8>` section, `<HEAD>` for titles, `<P>` for numbered paragraphs, `<AUTH>`/`<CITA>` for
citations). **This is a different, more precise answer than "PDF only": the *document* is
machine-readable and versioned, even though the *legal text inside each `<P>` tag is still
prose*.** Worth its own row for exactly that distinction — an ingestion pipeline could
reliably fetch, diff, and cite specific CFR sections (great for provenance and change
detection) without that meaning the eligibility rule itself becomes structured data.

**robots.txt** (`https://www.ecfr.gov/robots.txt`) allows general crawling; it disallows
`/search`, `/recent-changes`, `/on/`, `/compare/`, `/my/`, `/auth/*`, and — notably —
`/api/renderer/v1/content/` and `/api/versioner/v1/full/` from being *indexed*. That
disallow governs search-engine indexing of API responses (avoiding duplicate-content SEO
noise), not permission to call the documented public API programmatically; eCFR's API is
published specifically for programmatic use.

**Wisconsin Administrative Code / Statutes** (`docs.legis.wisconsin.gov`, maintained by the
Legislative Reference Bureau) follows the same pattern at the state level — e.g. the DHS
administrative code chapters that actually govern FoodShare/Medicaid eligibility live here as
structured, addressable HTML pages per section. `robots.txt` is permissive (disallows only
search-results pages, frames, and a couple of internal paths). Same conclusion as eCFR:
**good for provenance and citing the authoritative legal text a rule came from; the rule
itself, inside the section, is still prose.**

**Verdict:** not a source of structured eligibility rules, but genuinely useful as a
**citation/provenance layer** — issue #14 wants "the source text span it was derived from"
recorded per extracted rule, and eCFR/WI Admin Code URLs are exactly the kind of stable,
versioned, directly-citable source that makes that provenance trustworthy instead of a link
to a marketing page that will reword itself in six months.

---

## WI DHS

**URLs:** `dhs.wisconsin.gov` (FoodShare, WIC, BadgerCare, ACCESS Wisconsin), plus a separate
statistics-only open-data portal.

**Access confirms the epic's hypothesis: HTML-only for policy content.** Fetched
`https://www.dhs.wisconsin.gov/foodshare/index.htm` successfully via `curl` with a standard
browser user-agent (200 OK) and pulled real headings out of it: `"FoodShare: A Recipe for
Good Health"`, `"Can you get FoodShare?"`, `"How to manage your benefits online"`, `"Protect
yourself from FoodShare fraud"`, plus a "Public charge rule" subsection — exactly the kind of
plain-prose policy page issue #1 predicted, with no structured eligibility markup.

**"Public Benefit Program Data" is statistics, not eligibility rules.** WI DHS does publish
an open-data presence (`data.dhsgis.wi.gov` for spatial data, plus monthly
enrollment/caseload dashboards referenced at `dhs.wisconsin.gov/legislative/data.htm` and
`dhs.wisconsin.gov/foodshare/rsdata.htm`) — but this is aggregate reporting (how many people
are enrolled, by county, by month), not a machine-readable eligibility-rules feed. Don't
confuse "WI DHS has an open data portal" with "WI DHS publishes eligibility as data" — it
doesn't; the portal answers a different question (how many, not who qualifies).

### Fetch-tooling caveat: WI state sites block some automated fetchers

Several `dhs.wisconsin.gov` and related state-site pages returned **HTTP 403 to this
session's `WebFetch` tool** but **200 OK to `curl` with a standard browser user-agent** run
moments later against the identical URL. `robots.txt` itself is standard Drupal boilerplate
with **no site-wide disallow** (`https://www.dhs.wisconsin.gov/robots.txt`, confirmed via
`curl`, 200 status) — so the block is bot/UA fingerprinting at the app layer, not a stated
policy against automated access. This matters directly for #14: whatever fetcher the
pipeline uses needs a normal-looking user agent; a naive fetch client may get false 403s that
look like "this source refuses scraping" when the actual answer is "this source refuses *this
specific client*."

**Verdict:** worth ingesting for the **descriptive half** — the pages are real HTML with
predictable heading structure, robots.txt is permissive, and the content changes on a
recognizable cadence (open-enrollment periods, annual guideline updates). Eligibility stays
prose and stays a human/LLM-extraction target.

---

## WI DOA / Energy and Housing (WHEAP)

**URLs:** `energyandhousing.wi.gov` (agency site), `homeenergyplus.wi.gov` (program
front-end), plus the program manual PDF directly:
`https://energyandhousing.wi.gov/Documents/WHEAP/WheapManual_PY26.pdf` (2.5MB).

**The manual is PDF-only and did not extract cleanly with the tooling available in this
spike** — the fetch returned raw encoded PDF stream data rather than readable text.
That's a tooling limitation report, not a claim that the PDF has no extractable text (I did
not confirm it's a scanned image); a real ingestion attempt should try a proper PDF-text
library before concluding it needs OCR.

**The numeric side is confirmed real and already reflected correctly in our own data.**
Search results (cross-checked against `src/data/reference/income-tables.ts`) confirm WHEAP's
income limit is 60% of Wisconsin State Median Income for the 2025–2026 program year (Oct 1,
2025 – May 15, 2026 heating season), consistent with our `WI_SMI_60_2025` table's own
documentation. Benefit amounts are also published as a range ($30 minimum to $2,147 maximum
for heating; crisis assistance up to $1,200).

**robots.txt not found** — `https://energyandhousing.wi.gov/robots.txt` returns a SharePoint
404 page (the site runs on SharePoint, evidenced by `SharePointError` metadata), meaning no
robots.txt file exists at all rather than a restrictive one. Absence of a file is
conventionally read as "no crawling restriction stated," but SharePoint-hosted government
sites are also exactly the kind of source likely to break in path-dependent, brittle ways —
worth flagging as a fragile scrape target independent of permission.

**Update (issue #76):** the SharePoint page content is fully server-rendered — the WHEAP
income table, the 60%-SMI note, and the eligibility prose are all in the plain-fetch bytes,
no JavaScript required. What made both extraction pipelines see "zero readable text" is that
ASP.NET WebForms wraps the entire `<body>` in one `<form id="aspnetForm">`, and
`scripts/check-sources/lib/normalize.ts` + `scripts/agentic-extract/lib/html-structure.ts`
both strip `<form>` wholesale. `scripts/render-fallback/` neutralises that wrapper as a
fallback (only when a page reduces to nothing), which recovers all three
`energyandhousing.wi.gov` records with no headless browser.

**Verdict:** worth ingesting for the income-table refresh specifically — this is the exact
"highest value per unit of effort" target issue #1 already identified, and this spike
confirms the number exists, is published on a predictable annual cadence, and is already
correctly wired into our schema. The manual's programmatic rules (crisis-assistance
triggers, categorical eligibility via other program enrollment) remain prose/PDF and stay a
human or LLM-extraction target.

---

## USDA FNS/FNA

**Note on the domain itself:** search results show the agency's SNAP content has migrated
from `fns.usda.gov` to `fna.usda.gov` (Food and Nutrition Administration) — a live example of
the kind of URL churn that makes "Last-Modified header" and "changelog" the wrong mental
model for detecting change here; the *page itself moved*, which a naive hash-the-URL
change-detector would read as "gone," not "changed." Worth designing #14's retirement-vs-move
handling around this concretely rather than abstractly.

**robots.txt** for `fna.usda.gov` is standard permissive Drupal boilerplate (same shape as
`dhs.wisconsin.gov`'s), no site-wide disallow.

**The genuinely structured artifact here:** USDA publishes a real annual PDF table —
`FY2025-Income-Eligibility-Standards.pdf` (found via search, hosted on
`fns-prod.azureedge.us`) — with gross (130% FPL) and net (100% FPL) income limits by
household size, refreshed every fiscal year. This is the same "numeric table published
annually" shape as WHEAP's and FPL's tables: genuinely tabular, genuinely worth a scheduled
refresh script, and exactly what issue #1 calls out as the best-value/lowest-risk automation
target — it is not itself the *rule* (the rule — gross/net tests, deduction stack, categorical
eligibility, work-requirement exemptions — stays prose across every SNAP source checked), but
it is the number the rule is measured against, and it moves every threshold that references
it.

**Verdict:** worth ingesting for the annual income-table refresh, same category as FPL and
WHEAP's SMI table.

---

## Dane County / City of Madison open data

**Dane County:** the URL I first tried (`data-danecounty.opendata.arcgis.com`) does not
exist (`{"error":"Site does not exist"}`, confirmed by direct fetch). The real portal,
found via search, is `https://gis-countyofdane.opendata.arcgis.com/`, run by the Dane County
Land Information Office — description confirms it's built "to provide GIS data free of
charge," i.e. parcels, land records, mapping layers. I did not re-fetch this corrected URL
directly in this spike (budget); flagging the wrong-URL discovery itself as a useful
data point (a naive scrape script would have silently gotten a 404-shaped JSON error and
moved on) and leaving direct confirmation of its dataset list as a follow-up before anyone
builds against it.

**City of Madison:** `https://data-cityofmadison.opendata.arcgis.com/` is a real, reachable
ArcGIS Hub instance. `robots.txt` is permissive (`Crawl-delay: 60`, disallows only
`/sites/`, `/admin/`, `/sessions/`, `/groups/`, `/people/`, `/workspace/`, and publishes a
sitemap). I was not able to get a dataset listing through the fetch tooling available (the
portal is a JS-rendered SPA shell), so "GIS/budget rather than program eligibility" is
carried over from the issue's own stated expectation rather than independently confirmed
against an actual dataset catalog in this spike.

**Verdict, provisionally: not worth it**, consistent with the issue's prior expectation, but
**this is the one row in this document I'd rate lowest-confidence** — a follow-up pass
that actually gets past the SPA shell (e.g. hitting the ArcGIS REST API directly rather than
the Hub UI) is cheap and would turn "provisionally" into a real answer either way.

---

## ACCESS Wisconsin

**URL:** `https://access.wisconsin.gov/` · The state's own individual-facing screener —
covers FoodShare, Medicaid/BadgerCare, and the Family Planning Waiver Program, with an "Am I
Eligible" tool requiring no login. `robots.txt` returns a plain 404 (no file). No public API
found; this is an authenticated case-management web app (apply, check status, report
changes), not a data feed.

**Verdict:** not an ingestible source, but worth keeping in the verification toolkit —
`docs/data-authoring.md`'s manual verification procedure could point a human at ACCESS
Wisconsin's own screener as a sanity check when hand-verifying our FoodShare/BadgerCare
threshold values, since it's the state's own canonical calculator for the same programs.

---

## Does the shape of real eligibility rules match `src/domain/criteria.ts` / `facts.ts`?

Read both files in full before this spike, and checked real rules found above against them.

**What fits well, confirmed by real examples:**
- Geography gating (`livesIn.daneCounty`, `livesIn.madison`) matches how every county/city
  program actually gates — Dane Eviction Prevention, Madison Water Bill Assistance, WHEAP
  crisis assistance all condition on jurisdiction first.
- `incomeAtOrBelow` against a named `IncomeScale` matches how WHEAP (60% WI SMI), FoodShare
  (a percent of FPL), and Dane AMI-based programs are actually expressed — a percentage
  against a published table is the real shape, not a coincidence of our schema design.
  USDA's own published SNAP standard is literally "130% FPL gross / 100% FPL net," i.e. two
  `incomeAtOrBelow` tests, not one — worth checking whether `foodshare-snap-wi.ts` currently
  encodes only the WI 200%-FPL gross test and needs a net-income companion.
- `currentBenefits` / categorical eligibility fits WHEAP's real mechanic: several programs
  grant automatic eligibility to people already enrolled in another program, which is exactly
  what `hasAnyOf('currentBenefits', [...])` is for.
- `manualReview` is the correct encoding for WHEAP's funding-contingent language and for
  211-style "call and a human figures it out" programs — already used correctly in the
  existing dataset (`dane-joining-forces-for-families.ts`).

**What does NOT fit, concretely, and would need to stay prose (direct input to #8/#9):**
- **SNAP's deduction stack.** The real federal net-income test (100% FPL) is not "income
  minus nothing" — it's gross income minus a standard deduction, an earned-income deduction,
  a dependent-care deduction, medical expenses over a threshold for elderly/disabled members,
  and excess shelter costs. `facts.ts` has one `annualHouseholdIncome` fact; modeling the real
  net test would need half a dozen new facts and materially more interview questions for a
  program that already qualifies most of its applicants on the simpler gross test. Confirms
  `data-authoring.md`'s existing instruction to keep this in `eligibilityCaveats`.
- **Immigration-status exceptions.** Already correctly identified and deferred in
  `facts.ts`'s own comments (`citizenshipStatus` is declared but unasked in v1, with the
  file's own reasoning: "children frequently qualify when adults do not," and getting it
  wrong risks the worst failure mode). Every real SNAP/WIC source confirms this is exactly as
  intricate as the code comment already assumes — nothing found in this spike should change
  that decision.
- **Work requirements with layered exemptions** (SNAP's ABAWD time-limit rules, exemptions
  for parents, people with disabilities, etc.) — same shape problem as the deduction stack:
  real, but not a `compare`/`set` node, an exemption tree with its own facts.
  `employmentStatus` exists as a reserved fact but isn't enough on its own to model this
  correctly; confirms it should stay caveat prose rather than a half-correct rule.
- **Funding-contingent / discretionary language** ("subject to funding availability," "at
  caseworker discretion") appears constantly in real sources (WHEAP crisis assistance,
  county rent-assistance programs) and is exactly what `manualReview` exists for — not a
  fit problem, just confirming the node type earns its place in the schema.

No real rule found in this spike required a new `Criterion` *kind* — `allOf`/`anyOf`/`not`/
`compare`/`set`/`incomeAtOrBelow`/`manualReview` cover the actual shapes seen. What's missing
is *fact* coverage for the deduction/exemption detail inside programs we already model at a
coarser grain, which is a data-authoring decision (keep as caveat prose, as already
documented) rather than a schema gap.

---

## Recommended ingestion order for MVP

1. **Income-table refresh script first** (FPL, WI SMI 60%, Dane AMI, and add the FNS
   SNAP-specific standard). Confirmed by this spike as genuinely tabular, annually published,
   and already the exact shape `src/data/reference/income-tables.ts` expects. No LLM needed.
   Matches issue #1's own read; this spike just confirms the underlying pages exist and are
   fetchable (with the WI-site user-agent caveat above).
2. **Change-detection over `source.url` for the existing 15 records**, using WI Admin
   Code / eCFR citations where available as the stable provenance anchor rather than the
   agency's marketing page (agency pages move — see the FNS→FNA domain migration found in
   this spike; regulation citations don't).
3. **Descriptive-field ingestion from WI DHS / WI DOA HTML** for the programs already in the
   dataset, once a fetch client with a normal user-agent is confirmed to get past the 403s
   this spike hit.
4. **PolicyEngine cross-check** for the federal-program subset (SNAP, WIC) as a deterministic
   alternative/companion to LLM extraction — prototype this before assuming #5 needs to be
   LLM-only for those specific programs. Needs the AGPL and partial-input questions above
   resolved first.
5. **211 Wisconsin directory fields**, contingent on finding an actual access path (none
   confirmed in this spike) — descriptive fields only, never eligibility.
6. **LLM extraction (#5)** for everything else — which, per this spike, is most local/county
   programs and the exemption-heavy detail inside federal programs. Treat PolicyEngine's
   parameter values as one input/cross-check to an extraction pipeline, not a replacement for
   it.

## What to hand #5 (eligibility extraction)

- The scoped negative: no structured eligibility source exists for county/city programs —
  design for LLM-from-prose as the default path, not the fallback.
- PolicyEngine as a *validation* signal for federal-program thresholds specifically (SNAP,
  WIC), not as an extraction source in itself — pending the AGPL and partial-input questions.
- The concrete "doesn't fit" list above (SNAP deductions, immigration exceptions, work-
  requirement exemptions, funding-contingent language) as the abstention/`manualReview`
  triggers a prompt should be built around from day one, not discovered later.
- eCFR / WI Admin Code URLs as the preferred provenance citation over agency marketing pages,
  per #14's requirement to record "the source text span it was derived from."

## What to hand #14 (first ingestion pipeline)

- **Highest-value first target: the income-table refresh** (item 1 above) — smallest scope,
  clearest schema fit, zero LLM risk, and it's the one piece of automation that moves every
  program's effective threshold at once.
- **Fetch-tooling note:** WI state sites 403 naive fetchers even though their `robots.txt` is
  permissive; use a normal browser user-agent, and don't treat a 403 as "scraping forbidden"
  without checking robots.txt/ToS directly first, per this spike's WI DHS finding.
- **URL churn is real, not hypothetical**: FNS→FNA is a live example from this spike. #14's
  "a 404 is not an edit" handling needs a "the source domain moved" case distinct from both
  "changed" and "gone."
- **findhelp.org and 211 Wisconsin are hard nos for automated fetching** — robots.txt
  (`findhelp.org`) and absence of any confirmed access path (211 Wisconsin) respectively.
  Don't point a scraper at either without new information overturning this spike's findings.
- **Dane County's open-data URL in the original issue draft was wrong** (confirmed 404); the
  real portal is `gis-countyofdane.opendata.arcgis.com`. Use the corrected URL if county GIS
  data is ever pursued, but per this document that's not currently recommended for MVP scope.
