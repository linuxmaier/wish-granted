# `research/corpus/` — candidate program records

**Nothing in this directory is verified or shipped.** These are research
candidates gathered by an agent for the corpus-widening phase (#100): the pilot
batch (#101) and batch 2 (#102). They are:

- **not** in `src/data/programs/`, **not** in `records.ts`, **not** in the
  snapshot;
- **not** verified — `lastVerified` means *a human read the source on that
  date*, and a machine cannot set it (`CONTRIBUTING.md`);
- captured deliberately **unconstrained** by what the interview can ask today —
  `eligibility` trees here reference fact keys that do not exist, including ones
  in `RESERVED_FACT_KEYS`.

Promotion to a shipped record is a separate pass, and it has two halves that
are easy to run together and should not be:

- **Re-authoring the record against freshly fetched sources.** A candidate's
  figures are unverified and some are wrong — the first three promoted
  (`wi-veterans-subsistence-aid`, `wi-veterans-housing-recovery`,
  `dane-county-veterans-service-office`) each needed corrections, including a
  phone number one candidate carried that appears on none of its sources. Never
  copy a candidate's `eligibility` across; re-derive it.
- **Setting `lastVerified`.** That means *a human* read the source, and nothing
  else counts. A promoted record ships with `lastVerified: null` and a comment
  saying what was confirmed and what was not, exactly like
  `dane-eviction-prevention.ts`.

`PROCEDURE.md` (temporary — deleted when #100 closes) is the how-to.
`analysis/` (also temporary) holds the scripts behind every number quoted in
`FINDINGS.md` and `../../docs/interview-roadmap.md` — run them from the repo
root; they need no dependencies.
`GO-NO-GO.md` (also the comment on issue #101) is the pilot's report: what the
capture format got right and the seven named changes (§6) that this file now
describes as applied.

---

## One file per candidate: `<id>.json5`

**JSON5, not JSON** (`GO-NO-GO.md` §6.1). The only JSON5 features used are
**comments** — keys stay quoted, no trailing-comma reliance. Comments carry the
things that used to be `_`-prefixed sibling keys:

- the **verbatim words of the source** a node encodes → a `//` line comment
  above or beside that node (was `_sourceText`);
- a **reader's-eye caveat** on a node or subtree ("there is deliberately no
  income gate here, and here is why") → a `/* … */` block comment (was `_note`,
  `_factsNote`, `_categoriesNote`, `_statusNote`).

A reader can now tell a real key from an annotation: annotations are comments.

Not `.ts`: a typed candidate would need `Criterion` widened with escape-hatch
nodes and `Program`'s enums widened too, and every closed type is a place the
survey silently rounds a surprising rule toward something that compiles — the
risk this phase exists to guard against. `.ts` is a later-pass concern.

`id` is a kebab-case slug, unique, never reused. Top-level shape:

| Key | Type | Notes |
|---|---|---|
| `id` | string | matches the filename |
| `capturedAt` | `YYYY-MM-DD` | the date the agent fetched the sources |
| `notVerified` | string | fixed disclaimer sentence |
| `sharedFrontDoor` | object? | **optional** — present only on split files (below). `{ id, url, phone }` pointing at the umbrella / common intake, so a split file does not copy `howToApply` |
| `record` | object | the normalised descriptive fields (below) |
| `rule` | object | `eligibility` + `factsNeeded` + `expressibility` + `branchDropRisk` + `unencodable` (below) |
| `access` | object | `entryUrl`, `ruleUrl`, `hops`, `format`, `formatNotes`, `fetch`, `scopeSeparation` |
| `cost` | object | `wallClockMinutes`, `workedBy`, `notes` |
| `surprises` | string[] | the thing that was not predicted — the survey's most valued output |

### `record` — from `src/domain/program.ts`

`name`, `administeredBy`, `jurisdiction` (`city|county|state|federal`),
`provider` (`government|nonprofit`), `categories` (subset of the six
`CATEGORIES`), `summary`, `benefit`, `howToApply` (`{url, phone?, steps?}`),
`requiredDocuments?`, `status` (`open|seasonal|waitlist|closed`),
`seasonalNote?`.

- When **no category fits**, `categories` is `[]` and a comment says why. The
  pilot found two gaps in the six-category set with no schema fix available
  here: **cash / tax-credit income support** (`wi-earned-income-credit`,
  `wi-homestead-credit`, `wi-caretaker-supplement`) and **cross-cutting
  referral service** (the shipped set already works around this with `wi-211`
  and `dane-jfff`). Recorded as a finding, not patched.
- A comment explains a non-`open` status where the reason matters.

### `rule`

- **`eligibility`** — a `Criterion`-shaped tree as literal JSON node objects
  (`{"kind": "allOf", "of": [...]}`, `{"kind": "compare", "fact": "...", "op":
  "...", "value": ...}`, `{"kind": "incomeAtOrBelow", "scale": "...", "percent":
  N}`, `{"kind": "manualReview", "note": "..."}`, `{"kind": "not", "of": {...}}`).
  Fact keys **may not exist** in `FACT_KEYS`. Source words and caveats are
  comments (above).
- **`factsNeeded`** — array of `{key, type, sourceText}` for every fact the tree
  references that is **not** in `FACT_KEYS` today. Empty array is meaningful:
  the rule is expressible with today's vocabulary. Pair it with `expressibility`
  to say whether that meant the case was easy.
- **`expressibility`** (`GO-NO-GO.md` §6.4) — `{ level, note }` where `level` is
  one of:
  - `full` — the whole published rule maps into `Criterion` + facts (new facts
    allowed);
  - `partial` — a real, decidable part maps; a real part is `manualReview`;
  - `manual-review-dominant` — the rule is mostly professional assessment,
    discretion, or incorporated law; the encoded rule is thin even though it may
    need zero new facts (`katie-beckett-medicaid`, `wi-kinship-care`).
  `factsNeeded: []` no longer conflates "trivial" (`wi-csfp-senior-food`,
  `expressibility: full`, no `branchDropRisk`) with "hardest in the batch"
  (`seniorcare-wi`, `expressibility: full` but a load-bearing `branchDropRisk`):
  the discriminator is `expressibility.level` **and** `branchDropRisk`, read
  together.
- **`branchDropRisk`** (`GO-NO-GO.md` §6.3) — array, one entry per figure that
  can be mistaken for the whole rule:
  `{ figure, takenNaivelyAs, actuallyIs, direction }` where `direction` is
  `"narrower"` (encoding the figure alone rules out people the program accepts —
  the measured failure class), `"looser"` (the risk is *inventing* a limit the
  program does not have, e.g. `wi-veterans-property-tax-credit`), or `"either"`
  (a term-trap that mis-decides in both directions depending on how the reader
  resolves it, e.g. `wi-homestead-credit`'s "household income"). Empty array
  when the source carries no such trap. `direction` is a named field so batch 2
  can test `pipeline-principles.md` §3.1's reopen condition by counting.
- **`unencodable`** (`GO-NO-GO.md` §6.7) — array of `{ kind, text }`. `kind` is
  one of, anchored to `docs/data-authoring.md` "Things the engine should not
  model" plus three the pilot added:
  - `asset-test`, `work-requirement`, `immigration`, `documentation` (from
    data-authoring);
  - `professional-assessment` — a clinical or functional determination
    (Katie Beckett level-of-care, the ADRC LTC screen, Kinship "best interests");
  - `agency-discretion` — a capped or optional allowance the applicant cannot
    rely on (Head Start 10% / 35% slots);
  - `incorporated-law` — a whole external test folded in by reference (EIC "meet
    the federal requirements", Head Start part-1305 definitions);
  - `other`.

### `access`

- `entryUrl` — where a person starts.
- `ruleUrl` — the page/PDF/section actually carrying the rule, when different
  from `entryUrl`. `null` when the rule is on the entry page.
- `hops` — ordered strings: the navigation from entry to rule.
- **`format`** (`GO-NO-GO.md` §6.5) — an **array** from a fixed vocabulary:
  `html-prose`, `html-table`, `pdf`, `ecfr`, `wi-admin-code`, `none-published`.
  Combine as needed, e.g. `["html-table", "ecfr"]`. Aggregatable.
- **`formatNotes`** — free text for everything the controlled `format` cannot
  carry ("recovered from an ASP.NET WebForms shell", "26-page instruction
  booklet", "rule split across a citizen page and a handbook").
- `fetch` — `{tool, status, userAgent, jsRenderNeeded, formShellRecoveryNeeded,
  robots}`. `tool` names the path that worked: `lib-source live fetcher`,
  `lib-source live fetcher + form-shell recovery`, `+ pdf.ts`, or
  `WebFetch (fallback)`.
- **`scopeSeparation`** (`GO-NO-GO.md` §6.2) — array of
  `{ scopeOf, separation, where }`. One entry per figure **or term** that
  matters. `scopeOf` is the figure ("$24,680") *or* the term ("household
  income") whose governing scope is in question. `separation` is one of:
  - `colocated` — the scope is right next to the figure;
  - `column-header` — the scope IS a table column/row header, attached only
    because the structure-preserving render kept it (a flattened read loses it);
  - `same-page-elsewhere` — a paragraph earlier/later on the same page;
  - `cross-reference` — a pointer to another section/definition of the same
    source ("see section F, Definitions #11");
  - `other-document` — a different page, PDF, or body of law entirely;
  - `n/a — no governing figure` — the source publishes no rule figure at all
    (the "no rule published" case; replaces the pilot's `colocated: null`).
  `where` is free text describing where the scope actually lives.

### `cost`, `surprises`

`cost`: `{wallClockMinutes, workedBy: "agent", notes}`. Token cost is estimated
per-candidate in the go/no-go report, not per file. `surprises`: free-text array.

---

## Split files: multi-benefit orgs (`GO-NO-GO.md` §6.6)

**One rule per file.** When an organisation runs several benefits with several
different rules, it becomes several files:

- **Multi-condition, one benefit, one rule with alternatives** stays one file
  with an `anyOf` — `wi-chronic-disease-program` (renal / hemophilia / adult CF).
- **Multi-benefit orgs** split into one file per sub-program that has its own
  rule and its own distinct benefit:
  - `dane-county-adrc` keeps a thin umbrella file (core Information & Assistance
    is itself a real "call here first" resource) plus
    `dane-county-adrc-disability-benefit-specialists`,
    `dane-county-adrc-elder-benefit-specialist`,
    `dane-county-adrc-long-term-care-functional-screen`.
  - `svdp-madison-assistance` had **no** rule on its umbrella page — but each
    sub-program page did (a pilot miss the split corrects). It becomes
    `svdp-madison-food-pantry`, `svdp-madison-charitable-pharmacy`,
    `svdp-madison-thrift-vouchers`, `svdp-madison-microlending`,
    `svdp-madison-seton-program`, `svdp-madison-vinnys-lockers`. No thin
    umbrella — the org page is not itself a "call here first" rule.
- Split files carry `sharedFrontDoor` instead of copying `howToApply`.
- **Not** a `subPrograms[]` array — that keeps the counting muddy and builds
  machinery for a disposable survey.

---

## What a reader of these files must keep in mind

1. **The `eligibility` trees are hypotheses, not encodings.** They use invented
   fact keys and would fail `tests/data/vocabulary.test.ts` immediately. That is
   the point of the staging area.
2. **Figures were read off fetched primary sources**, not search snippets.
   Where a search result and the primary disagreed (CSFP 130% vs 150%; Madison
   CDA income figures; kinship rate) the primary won and the disagreement is
   noted in `cost.notes`.
3. **`scopeSeparation` and `branchDropRisk` are the measurements this survey
   exists to take.** Read them before the `eligibility` tree.
4. **Aggregation** (`FINDINGS.md`, #102) parses these with the `json5` module —
   `grep -c` on `separation:`, `direction:`, `kind:`, `"level":` reproduces the
   headline counts.
