# Triage fixtures — provenance

The routing distribution over the program corpus is measured two ways, and this
directory holds only the second, weaker kind.

## Tier-3 fixtures (the strong set — not here)

Ten of the seventeen program records cite a source that already has a committed,
real, dated Tier-3 capture under `tests/fixtures/tier3*/` (see
`scripts/cross-check/lib/corpus.ts`, issue #84). Triage runs the real
deterministic parser against those captures with no network and no model. Those
ten are the offline-measured part of the routing distribution.

## Reconstructed Tier-4 fixtures (this directory)

The seven community-organisation sources (Tenant Resource Center, Dane Joining
Forces for Families, 211 Wisconsin, Second Harvest, The River Food Pantry, and
the two City of Madison programs) have **no committed Tier-3 capture** — their
pages render through heavy JS/CMS layers that a plain fetch does not resolve
(see each program record's `source` note in `src/data/programs/`).

Four of the seven — the ones whose live pages unambiguously decline to state a
rule — get a **reconstructed** `.html` file here: each is built from the verbatim
quotes recorded in the corresponding program record's `source` note (a human
fetched and read those pages for issue #2 / #40) plus
`docs/eligibility-extraction.md` Section 2's Tier-4 characterisation. They exist
so the `no-rule-published` route is exercised end-to-end offline against a saved
file, and so the offline routing distribution covers 14 of the 17 records.

The other three (`the-river-food-pantry`, `madison-water-bill-assistance`,
`madison-housing-choice-voucher`) get no fixture: what would decide their route
is content a reconstruction would be *guessing* at (a MadCAP / Section 8 dollar
table; The River's grocery rule lives in a linked state TEFAP PDF, not the
pantry page). Their routes are predicted in the PR and in `npm run
extract:triage`'s output, and measured by the coordinator's live run.

These files are **not** evidence of what the live pages say today.

| file | program record | reconstructed from |
|---|---|---|
| `tenant-resource-center.html` | `dane-eviction-prevention` | its `source` note: screening tool, no published threshold, "the only way to know is to apply" |
| `dane-joining-forces-for-families.html` | `dane-joining-forces-for-families` | its `source` note: "voluntary and no eligibility gate beyond location" |
| `211-wisconsin.html` | `wi-211` | its `source` note + #4 (HSDS: no eligibility entity); referral service |
| `second-harvest.html` | `second-harvest-southern-wi` | its `source` note: verbatim "No identification, proof of income, residency, citizenship, or other documentation is required" |
