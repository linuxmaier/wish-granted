# `research/corpus/` — candidate program records

**Nothing in this directory is verified or shipped.** These are research
candidates gathered by an agent for issue #101 (the pilot batch of the
corpus-widening phase, #100). They are:

- **not** in `src/data/programs/`, **not** in `records.ts`, **not** in the
  snapshot;
- **not** verified — `lastVerified` means *a human read the source on that
  date*, and a machine cannot set it (`CONTRIBUTING.md`);
- captured deliberately **unconstrained** by what the interview can ask today —
  `eligibility` trees here reference fact keys that do not exist, including ones
  in `RESERVED_FACT_KEYS`.

Promotion to a shipped record is a separate human pass and is out of scope for
#101.

This file documents the capture format **as it actually ended up** after 20
candidates. `PROCEDURE.md` (temporary — deleted when #100 closes) is the
how-to. `GO-NO-GO.md` (also the comment on issue #101) says what held and what
did not.

**Before batch 2 (#102), the format changes named in `GO-NO-GO.md` §6 get
applied back to these 20** — chiefly: `.json` → `.json5` so the `_sourceText` /
`_note` sibling-key convention below becomes real comments; `scopeColocated` →
`scopeSeparation`; multi-benefit orgs split into one file per sub-program. What
follows describes the 20 files **as they stand now**.

---

## One file per candidate: `<id>.json`

`id` is a kebab-case slug, unique, never reused. Top-level shape:

| Key | Type | Notes |
|---|---|---|
| `id` | string | matches the filename |
| `capturedAt` | `YYYY-MM-DD` | the date the agent fetched the sources |
| `notVerified` | string | fixed disclaimer sentence |
| `record` | object | the normalised descriptive fields (below) |
| `rule` | object | `eligibility` + `factsNeeded` + `unencodable` (below) |
| `access` | object | `entryUrl`, `ruleUrl`, `hops`, `format`, `fetch`, `scopeColocated` |
| `cost` | object | `wallClockMinutes`, `workedBy`, `notes` |
| `surprises` | string[] | the thing that was not predicted — the pilot's most valued output |

### `record` — from `src/domain/program.ts`

`name`, `administeredBy`, `jurisdiction` (`city|county|state|federal`),
`provider` (`government|nonprofit`), `categories` (subset of the six
`CATEGORIES`), `summary`, `benefit`, `howToApply` (`{url, phone?, steps?}`),
`requiredDocuments?`, `status` (`open|seasonal|waitlist|closed`),
`seasonalNote?`.

- When **no category fits**, `categories` is `[]` and a sibling
  `_categoriesNote` says why. (Happened once outright — `wi-earned-income-credit`
  — and several times partially.)
- Sibling `_statusNote` explains a non-`open` status where the reason matters.

### `rule`

- **`eligibility`** — a `Criterion`-shaped tree as literal JSON node objects
  (`{"kind": "allOf", "of": [...]}`, `{"kind": "compare", "fact": "...", "op":
  "...", "value": ...}`, `{"kind": "incomeAtOrBelow", "scale": "...", "percent":
  N}`, `{"kind": "manualReview", "note": "..."}`, `{"kind": "not", "of": {...}}`).
  Fact keys **may not exist** in `FACT_KEYS`.
  - `_sourceText` on a node = the verbatim words of the source that node encodes.
  - `_note` on a node or on the tree = a reader's-eye caveat, most often "there
    is deliberately no income criterion here and here is why".
  - JSON has no comments, so annotations are `_`-prefixed sibling keys. This is
    the single biggest format wart — see the report.
- **`factsNeeded`** — array of `{key, type, sourceText}` for every fact the tree
  references that is **not** in `FACT_KEYS` today. Empty array is meaningful (the
  rule is expressible; the difficulty, if any, is elsewhere). `_factsNote`
  carries the "expressible except for X" nuance.
- **`unencodable`** — array of strings: parts of the published rule that **no**
  fact vocabulary would capture (caseworker judgment, "call and ask", a
  discretionary allowance, an assessment, an incorporated body of federal law).

### `access`

- `entryUrl` — where a person starts.
- `ruleUrl` — the page/PDF/section actually carrying the rule, when different
  from `entryUrl`. `null` when the rule is on the entry page.
- `hops` — ordered strings: the navigation from entry to rule.
- `format` — one of `html-prose`, `html-table`, `pdf`, `ecfr`, `wi-admin-code`,
  `none published` (combinations written as e.g. `html-prose + wi-admin-code`).
- `fetch` — `{tool, status, userAgent, jsRenderNeeded, formShellRecoveryNeeded,
  robots}`. `tool` names the path that worked: `lib-source live fetcher`,
  `lib-source live fetcher + form-shell recovery`, `+ pdf.ts`, or
  `WebFetch (fallback)`.
- **`scopeColocated`** — array of `{figure, colocated, scopeLocation}`. One entry
  per figure that matters. `colocated` is `true` / `false` / `null`
  (`null` = no governing figure exists in the source — a "no rule published"
  case). `scopeLocation` describes where the scope actually lives.

### `cost`, `surprises`

`cost`: `{wallClockMinutes, workedBy: "agent", notes}`. Token cost is estimated
per-candidate in the go/no-go report, not per file. `surprises`: free-text array.

---

## What a reader of these files must keep in mind

1. **The `eligibility` trees are hypotheses, not encodings.** They use invented
   fact keys and would fail `tests/data/vocabulary.test.ts` immediately. That is
   the point of the staging area.
2. **Figures were read off fetched primary sources**, not search snippets.
   Where a search result and the primary disagreed (CSFP 130% vs 150%; Madison
   CDA income figures; kinship rate) the primary won and the disagreement is
   noted in `cost.notes`.
3. **`scopeColocated` is the measurement this survey exists to take.** Read it
   before the `eligibility` tree.
