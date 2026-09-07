# PDF fixtures — provenance

Saved so the offline suite and `npm run extract:agentic:self-test` can prove the
PDF reader (`scripts/agentic-extract/lib/pdf.ts`, issue #77) end to end with **no
network call in CI**. These are byte-for-byte archives of the real documents —
pinned `binary` in `.gitattributes`, hashed below. A live pipeline refetches; the
fixture exists so `npm test` does not depend on a government host staying up.

| File | Source URL | Fetched | SHA-256 | What it publishes |
|---|---|---|---|---|
| `cnp-income-eligibility-guidelines-2025.pdf` | https://www.govinfo.gov/content/pkg/FR-2025-03-13/pdf/2025-03821.pdf | 2026-09-07 | `acf9985c70afe0165fb68234d6ba64e804da9ad0ab34457e3bb5b422e074110c` | USDA FNS *Child Nutrition Programs: Income Eligibility Guidelines*, 90 FR 11938 (Mar 13, 2025) — the free (130% FPL) and reduced-price (185% FPL) school-meal income table, effective July 1, 2025 – June 30, 2026, for the 48 contiguous states, Alaska and Hawaii. |

## Why this document

`school-meals-wi` (#72's verified agentic run) abstained because the linked
"Nutshell" PDFs 404 and the numeric 130% / 185% FPL thresholds "would not be
backed by a verbatim quote from a fetched page". This is the federal notice those
thresholds come from — the annual Federal Register publication that
`docs/eligibility-extraction.md` §3 names as a Tier-1 source "identified but never
attempted" because it is "published as an annual PDF… different tooling, out of
scope for this script". It is:

- a genuine income **table**, not prose — the whole point of #77 is extracting it
  *as a table* rather than flattening it (the #63/#64 BadgerCare failure class);
- multi-column page layout (the Federal Register's 3-column body) around a
  full-width ruled table — exercises both the column-flow reader and the
  ruling-line table detector;
- served from a **stable** government URL (`govinfo.gov/content/pkg/FR-YYYY-MM-DD/pdf/…`)
  whose `robots.txt` allows `/content/`.

## Refetching

```
curl -A "<desktop Chrome UA>" -o cnp-income-eligibility-guidelines-2025.pdf \
  https://www.govinfo.gov/content/pkg/FR-2025-03-13/pdf/2025-03821.pdf
```

The next year's notice is a new document ID under the same path shape (e.g.
`FR-2026-03-.../pdf/2026-…​.pdf`); the extractor is not pinned to this one.
