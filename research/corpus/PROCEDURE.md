# PROCEDURE — how to capture a corpus candidate

> **This file is temporary and disposable.** It is scaffolding for one survey
> (issues #100 / #101 / #102). **Delete it when #100 closes.** It lives under
> `research/`, not `docs/`, on purpose: `docs/` carries mechanism expected to
> stay true; this is a method for a job with an end date.
>
> It was written after doing the pilot's 20 candidates. It is concrete where the
> pilot hit a real decision and silent where nothing came up. Concrete beats
> complete.

---

## 0. The one rule that governs everything

**Ignore precedent. Capture the program as it is, not as the interview could ask
it.**

- Reference fact keys that do not exist. Invent names for them. `isVeteran`,
  `hasDisability`, `citizenshipStatus`, `employmentStatus` are **not** off
  limits here.
- Do not trim a rule to fit `Criterion`. If part of it is caseworker judgment or
  "call and ask", put that part in `unencodable` and name it.
- Do not skip a program because its rule is hard, or because it publishes no
  rule. Both are findings.
- **Never invent data.** Every figure, URL, and phone number comes from a page
  or PDF you actually fetched. If a search snippet gives a number, that is a
  lead to verify, never a source. (Real example: search said CSFP is 130% FPL;
  the DHS page says 150%.)
- Record redirect **destinations**, not redirectors. Respect robots.txt.
  findhelp.org / auntbertha.com are hard-denied — never fetch them even when a
  search points there.

---

## 1. Find candidates

Aim for **variety**, not convenience. A pilot of 20 clean HTML income tables
from one agency would prove nothing.

Good hunting grounds, in rough order of yield in the pilot:

- **Wisconsin DHS program index** (`dhs.wisconsin.gov`) — health, nutrition,
  aging, disability, SSI-related programs. Many have a `/<program>/index.htm` +
  a sibling eligibility or FPL page.
- **DCF** (`dcf.wisconsin.gov`) — child care, kinship care, W-2, caretaker
  supplement.
- **WDVA** (`dva.wi.gov`) — veterans grants and credits.
- **DOR** (`revenue.wi.gov`) — homestead credit, earned income credit, veterans
  property tax credit. (These pages need form-shell recovery — see §3.)
- **City of Madison** (`cityofmadison.com/dpced/housing`) and **Dane County**
  (`dcha.net`, `daneadrc.org`, `danecountyhumanservices.org`) — housing
  authorities, ADRC, emergency assistance.
- **Local nonprofits** — Project Home, St. Vincent de Paul, Catholic Charities /
  The Beacon, Second Harvest, community action agencies. These are where "no
  published rule" lives.
- **Regulations directly** — `docs.legis.wisconsin.gov/code/admin_code/...` for
  WI Admin Code; `ecfr.gov/current/title-XX/...` for federal. Reach for these
  when the program page cites a chapter but does not state the rule (WDVA
  subsistence aid, kinship care).

Deliberately include, across the batch: PDFs and regulations; rules needing a
fact the interview cannot ask; sources that publish **no** rule; **city and
county** bodies; and figures whose governing scope sits away from the figure.

Check the candidate is not already a shipped record (`src/data/programs/`,
17 files) or already captured here.

---

## 2. Fetch the source

Use the scratchpad helper (not committed): it imports `scripts/lib-source/`
and dumps structure-preserving + normalised text to files you then read.

```
node <scratchpad>/fetch-source.ts <url> <basename> [--browser]
```

It reports `outcome` (`ok` / `moved` / `gone` / `unreachable` / `blocked`),
`status`, `finalUrl`, `contentRegion`, `normalizedLength`, and (for PDFs)
`pageCount`. It writes `<basename>.structured.txt` (**use this one** — it keeps
table column headers and heading paths attached), `.normalized.txt`, `.flat.txt`,
`.raw.html`, `.meta.json`; for PDFs, `.pdf.structured.txt` and `.pdf.flat.txt`.

What the helper wraps (all in `scripts/lib-source/`, none modified):

- `fetcher.ts` `createLiveFetcher()` — desktop-Chrome UA, robots + hard-deny
  enforced, `moved` when the host changes, PDF bytes.
- `html-structure.ts` `renderStructured()` — the structure-preserving render.
- `normalize.ts` `normalize()` / `normalizeToResult()` — stable reading text +
  which content region was found.
- `pdf.ts` `extractPdf()` — coordinate-based, keeps columns.
- `recover.ts` `recoverEmptyPage({allowBrowser})` — form-shell unwrap, then
  optional headless browser.

`scripts/lib-source/` is **only how you read a page** here. It implies nothing
about a pipeline.

### If lib-source cannot reach it

Fall back to `WebFetch` with a prompt demanding **verbatim** eligibility
language and figures. Record `fetch.tool: "WebFetch (fallback)"` on that
candidate. (Did not happen in the pilot — every source was reachable.)

---

## 3. When a source fights back

| Symptom | What it is | Fix |
|---|---|---|
| `normalizedLength: 0`, `contentRegion: "body"` | ASP.NET WebForms / SharePoint shell (`revenue.wi.gov`) | The helper auto-runs `recoverEmptyPage`; `unwrap-shell` neutralises the wrapper `<form>`. Set `fetch.formShellRecoveryNeeded: true`. |
| `gone` (404) on a guessed URL | your guess was wrong, not the page | Fetch the parent/index page, `grep -oE 'href="[^"]*"'` its `.raw.html`, find the real link. Or web-search for the page title and confirm on the fetched primary. |
| `unreachable: fetch failed` | wrong domain, or transient | Web-search the org name; the domain you assumed may not be theirs (`danecountyhousingauthority.com` is not DCHA; `dcha.net` is). |
| eCFR / legis.wisconsin.gov page is 80% site chrome | government CMS | The regulatory text is in there. `grep -nE` the `.flat.txt` for section numbers and rule keywords. |
| PDF `.flat.txt` is one giant line | no newlines survive extraction | Use `.pdf.structured.txt` (has block breaks), or `grep -oE '.{80}<needle>.{200}'` for context windows. |
| Rule cites "Chapter X" but does not state it | the page defers to the code | Fetch the code chapter directly. Set `format` to include `wi-admin-code` or `ecfr`, and `ruleUrl` to the section. |
| Program page is all benefit dollar caps, no eligibility | common on WDVA, DCHA | The rule is in the admin code or is federal. Go get it; note in `surprises` that the public page omitted it. |
| Name collision | e.g. "The Beacon" vs `beaconhelps.org` (a Ghana charity) | Confirm the entity from a `.gov` or a known local aggregator before trusting a page. |

---

## 4. Fill each field

Work in this order — it front-loads the decisions.

1. **`access.fetch` and `access.format`** first, from the helper's output. You
   now know what kind of source you have.
2. **`access.scopeColocated`** — for **each figure that matters**, ask: *is the
   condition that decides when this number applies right next to it?* The scope
   might be a column header, a sentence above a table, a paragraph earlier, a
   cross-reference to another chapter, or another document entirely. Write
   `colocated: false` and describe where it actually is. If the source has no
   governing figure at all, `colocated: null`.
   - **This is the measurement the survey exists for. Do it carefully.**
   - The `renderStructured` output keeps column headers attached — if a figure's
     scope IS its column header and you're reading structured text, that's
     `colocated: true`, but note that a flattened read would have lost it.
3. **`rule.eligibility`** — build the `Criterion` tree. One `allOf` of the
   top-level conditions; `anyOf` for alternative qualifying routes (this is
   where branch-drop is resisted — every "or" the source states must appear);
   `manualReview` with a `note` for any condition that is a judgment or an
   assessment. Put verbatim source words in `_sourceText` on the node.
   - **Before you write `incomeAtOrBelow(...)`: is the prominent % actually a
     ceiling?** In the pilot, SeniorCare's "160% FPL" and the Chronic Disease
     Program's "300% FPL" are **cost-sharing tiers, not eligibility gates** —
     there is no income ceiling. Read down the whole table/section for a "Level
     3 / above X" row that is still eligible.
4. **`rule.factsNeeded`** — every fact the tree references that is not in
   `FACT_KEYS`. `{key, type, sourceText}`. If the tree is fully expressible with
   today's vocabulary, `[]` — and say in `_factsNote` whether that means the
   case was easy or the difficulty was in the scope reading.
5. **`rule.unencodable`** — list the parts you deliberately did not put in the
   tree: assessments, discretion, "apply for all other aid first", incorporated
   federal law, asset tests, background checks.
6. **`record.*`** — descriptive fields. Plain language for a stressed reader on a
   phone. `categories: []` + `_categoriesNote` if none of the six fit.
7. **`cost`** — wall-clock minutes and a one-line note on what was awkward.
8. **`surprises`** — the thing you did not expect. If nothing surprised you,
   say that; a boring candidate is also data.

---

## 5. Check your work

- `node -e "JSON.parse(require('fs').readFileSync('<file>','utf8'))"` — valid
  JSON.
- Every figure in the file traces to a URL in `access` that you fetched.
- Redirects recorded as destinations.
- Nothing added under `src/`, `scripts/`, `tests/`. `npm test` and `npm run
  build` still pass, untouched.

---

## 6. Batch discipline (from #100)

The pilot is 20. Batch 2 (#102) is ~40 more and **does not start** until the
pilot's go/no-go report is accepted. If #102 changes the schema, the change is
applied back to the pilot's 20 — one survey, one schema.
