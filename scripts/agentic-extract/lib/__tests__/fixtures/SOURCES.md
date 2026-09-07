# Agentic-extractor fixtures — provenance

Saved so the offline suite and `npm run extract:agentic:self-test` can prove the
retrieval path end to end with **no network call in CI**. Byte-for-byte archives
of the real documents/pages, hashed below. A live pipeline refetches; the
fixtures exist so `npm test` does not depend on a government host staying up.

---

## PDF fixture (`scripts/agentic-extract/lib/pdf.ts`, issue #77)

Pinned `binary` in `.gitattributes`.

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

---

## Site-search fixtures (`scripts/agentic-extract/lib/site-search.ts`, issue #75)

All fetched **2026-09-07** with the repo's desktop-Chrome UA
(`scripts/refresh-income-tables/lib/http.ts`). Plain UTF-8; not pinned binary.

| File | Source URL | SHA-256 | Role in the proof |
|---|---|---|---|
| `dhs-wisconsin-gov-robots.txt` | https://www.dhs.wisconsin.gov/robots.txt | `773fb8d35bb9a39d35335ee6db8dc5c912d2aacbfb823152d9c61cd647dd902d` | Drupal robots.txt. `Disallow: /search/` — the reason site-search never calls the DHS search endpoint and works by sitemap + link crawl instead. No `Sitemap:` line. |
| `dhs-wisconsin-gov-sitemap.xml` | https://www.dhs.wisconsin.gov/sitemap.xml | `94b357294b0b5f90d2d04b90c0401ef830aab447e679335edd7656797b06ec21` | A `<sitemapindex>` pointing at 11 paginated children (`/sitemap.xml?page=1..11`). |
| `dhs-foodshare-index.html` | https://www.dhs.wisconsin.gov/foodshare/index.htm | `4b5bfe82c0047db2c98bbec7ca99adc00dbf46264dcde424baf713be8993380c` | The entry URL for `foodshare-snap-wi`. Links to `fpl.htm` **only from the sidebar `<nav>`**, which `html-structure.ts` drops before the model sees the page. |
| `dhs-foodshare-fpl.html` | https://www.dhs.wisconsin.gov/foodshare/fpl.htm | `d2d9bfc9fd73db97ca0242e93b6755ccc7723c74ac462d433174ec938701f8b5` | The page #72 could not reach. States the size-tiered **200% FPL gross income limit** table, "Effective October 1, 2025, through September 30, 2026". |

### The before/after this closes

`foodshare-snap-wi` is #72's one remaining unsolved case. Its abstention:

> every guessed URL 404s and is redirected back to the FoodShare index… the
> site's sitemap is too large to search **without a working text-search tool**.
> Without reaching the page that states the actual income-limit figures… I cannot
> back a compare/incomeAtOrBelow eligibility rule with a verbatim quote.

**Before:** `search_web` returned guidance text. The entry page render
(`renderStructured`) drops the `<nav>` that holds the only link to `fpl.htm`, so
the model cannot see the URL; guessed URLs 404. → abstain.

**After** (`OFFLINE_SCENARIOS[8]`, `site-search.test.ts`): `search_web` reads
`/robots.txt`, follows `/sitemap.xml`, finds its children **403** (Akamai denies
every query string on this host — verified: even `fpl.htm?x=1` → 403), and
degrades to crawling the site's links. It ranks `/foodshare/fpl.htm` first by
matching the query against page text, the model `fetch_page`s it, and the
200%-FPL spans verify against that page through the **unchanged** provenance
gate.

### A real finding, stated plainly

For `dhs.wisconsin.gov` — the host every unsolved case sits on — **site search
proper is not available to us**: `/search/` is robots-disallowed and the
paginated sitemap is edge-blocked. What works is the link crawl. It reaches
`fpl.htm` because the FoodShare section hub links to it; it would *not* reach a
page that is orphaned from every crawlable hub on the site. No such case exists
in the current dataset, but if one appears it needs a different approach (a
saved URL, or a human), not a search tool that quietly returns nothing.

### Refetching

```
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
for p in robots.txt sitemap.xml foodshare/index.htm foodshare/fpl.htm; do
  curl -sS -A "$UA" --compressed "https://www.dhs.wisconsin.gov/$p"
done
```
