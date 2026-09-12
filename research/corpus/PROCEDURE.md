# PROCEDURE — how to capture a corpus candidate

> **This file is temporary and disposable.** It is scaffolding for one survey
> (issues #100 / #101 / #102). **Delete it when #100 closes.** It lives under
> `research/`, not `docs/`, on purpose: `docs/` carries mechanism expected to
> stay true; this is a method for a job with an end date.
>
> It was written after doing the pilot's 20 candidates and updated after the
> pilot's go/no-go report was accepted and its seven format changes (`GO-NO-GO.md`
> §6) were applied. It is concrete where the pilot hit a real decision and silent
> where nothing came up. Concrete beats complete.
>
> **The capture format is in `README.md`.** This file is the method; `README.md`
> is the schema. Candidate files are `.json5` now (comments, nothing else).

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
- **Reach for a "can't model this shape" note before collapsing a rule to
  `manualReview`.** A shape you did not expect is a finding, not a thing to
  simplify away. If the published rule does something `Criterion` has no node
  for, say so in `surprises` and in `unencodable` (`kind: "other"` with the
  shape described) rather than flattening it. (`GO-NO-GO.md` §6, closing note.)
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

**Batch-2 lessons (2026-09-09):**

- **A multi-benefit org's umbrella page may publish no rule while each
  sub-program page does.** The pilot's `svdp-madison-assistance` was captured as
  "none published" from the `/get-help/` page; the six `/program/<name>/` pages
  each carried a tidy `Eligibility:` list. Before recording "none published" for
  an org, fetch the individual program pages. (The §6.6 split assumes this.)
- **`dhs.wisconsin.gov` and `dcf.wisconsin.gov` restructured their paths.** Many
  once-stable URLs 404 (`/w2` → `/w2/parents/w2`; `/medicaid/msp.htm` → gone,
  now `/medicaid/qmb.htm` + a PDF; `/nutrition/tefap.htm` →
  `/nutrition/tefap/index.htm`). Guessing a `.htm` path is unreliable now —
  fetch the section index and grep its hrefs, or web-search the page title.
- **County/nonprofit sites move off the obvious domain.** The Dane County
  Veterans Service Office is at `danevets.com` (not any `danecounty.gov` path);
  the Salvation Army's Dane County site was unreachable and the fallback was
  `salvationarmyusa.org/wi/madison/...`. Entity/domain disambiguation was the
  single biggest time cost in batch 2, as in the pilot.

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

Field shapes and vocabularies are in `README.md`; this is the order and the
judgment calls.

1. **`access.fetch`, `access.format`, `access.formatNotes`** first, from the
   helper's output. `format` is an array from the fixed word list
   (`html-prose`, `html-table`, `pdf`, `ecfr`, `wi-admin-code`,
   `none-published`); everything else the source does goes in `formatNotes` as
   free text. You now know what kind of source you have.
2. **`access.scopeSeparation`** — for **each figure _or term_ that matters**,
   ask: *is the condition that decides when this applies right next to it?* Set
   `separation` to one of `colocated` / `column-header` / `same-page-elsewhere`
   / `cross-reference` / `other-document` / `n/a — no governing figure`, and
   describe `where` the scope actually lives.
   - **This is the measurement the survey exists for. Do it carefully.**
   - `renderStructured` keeps column headers attached — if a figure's scope IS
     its column header, that's `column-header` (a flattened read would have lost
     it), not `colocated`.
   - A **term** can be the trap: `wi-homestead-credit`'s "$24,680" is fine, but
     "household income" beside it is a 7-page construction. Point `scopeOf` at
     the noun.
3. **`rule.eligibility`** — build the `Criterion` tree. One `allOf` of the
   top-level conditions; `anyOf` for alternative qualifying routes (this is
   where branch-drop is resisted — every "or" the source states must appear);
   `manualReview` with a `note` for any condition that is a judgment or an
   assessment. Verbatim source words go in a `//` comment on the node; a
   reader's caveat goes in a `/* */` block comment.
   - **Before you write `incomeAtOrBelow(...)`: is the prominent % actually a
     ceiling?** In the pilot, SeniorCare's "160% FPL" and the Chronic Disease
     Program's "300% FPL" are **cost-sharing tiers, not eligibility gates** —
     there is no income ceiling. Read down the whole table/section for a "Level
     3 / above X" row that is still eligible.
4. **`rule.branchDropRisk`** — one entry per figure that could be mistaken for
   the whole rule: `{ figure, takenNaivelyAs, actuallyIs, direction }`.
   `direction` is `narrower` (the figure alone rules out people the program
   takes — the measured failure), `looser` (the risk is inventing a limit that
   is not there, e.g. `wi-veterans-property-tax-credit`), or `either` (a
   term-trap that mis-decides both ways). `[]` when the source has no such trap.
   **`direction` is the field the reopen condition in `pipeline-principles.md`
   §3.1 is counted against — fill it honestly.**
5. **`rule.factsNeeded`** — every fact the tree references that is not in
   `FACT_KEYS`. `{key, type, sourceText}`. `[]` if the tree is fully expressible
   with today's vocabulary.
6. **`rule.expressibility`** — `{ level, note }`, `level` one of `full` /
   `partial` / `manual-review-dominant`. This is what stops `factsNeeded: []`
   meaning both "trivial" and "hardest in the batch": say whether the encodable
   rule is the whole thing, a real part beside a `manualReview`, or a thin
   shell around an assessment.
7. **`rule.unencodable`** — `{ kind, text }` per item. `kind` from the fixed
   list (`asset-test`, `work-requirement`, `immigration`, `documentation`,
   `professional-assessment`, `agency-discretion`, `incorporated-law`,
   `other`). List the parts you deliberately did not put in the tree.
8. **`record.*`** — descriptive fields. Plain language for a stressed reader on a
   phone. `categories: []` + a `//` comment if none of the six fit.
9. **`sharedFrontDoor`** — only on a split file (multi-benefit org, `README.md`).
   `{ id, url, phone }` pointing at the umbrella / common intake.
10. **`cost`** — wall-clock minutes and a one-line note on what was awkward.
11. **`surprises`** — the thing you did not expect. If nothing surprised you,
    say that; a boring candidate is also data.

---

## 5. Check your work

- The file parses as JSON5 (comments allowed, quoted keys). The scratchpad
  validator (`validate.mjs`, not committed) checks every `.json5` against the
  field vocabularies in one pass — run it, expect `0 problems`.
- Every figure in the file traces to a URL in `access` that you fetched.
- Redirects recorded as destinations.
- `id` matches the filename.
- Nothing added under `src/`, `scripts/`, `tests/`. `npm test` and `npm run
  build` still pass, untouched.

---

## 6. Batch discipline (from #100)

The pilot was 20 candidates; the `GO-NO-GO.md` §6 split of two multi-benefit
orgs (ADRC, SVdP) brought it to 28. Batch 2 (#102) adds ~32 more, targeting
**~60 total**. The pilot's go/no-go report is accepted and its format changes
are applied; one survey, one schema. Batch 2 aims for **representativeness**
where the pilot aimed for variety — coverage targets are in #102 (all six
`CATEGORIES`, `health-disability` and `veterans` well represented, city/county
not only state/federal, nonprofits, and sources publishing no rule).

Where this file proves wrong or silent during batch 2, fix it here — it is a
working document, deleted when #100 closes.
