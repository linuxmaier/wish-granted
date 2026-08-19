# Wish Granted — Design

This answers the open questions in [brief.md](brief.md). The brief's confirmed scope
decisions are taken as given and not re-argued here.

## Tech stack

**Vite + React 19 + TypeScript, built to static files, tested with Vitest.**

The privacy constraint does most of the choosing. "No server-side persistence, ever" is
easiest to guarantee when there is no server at all, so the build output is plain static
files: `npm run build` produces `dist/`, deployable to any static host with no runtime.

React over the alternatives mostly for boring reasons — the interview is a small amount of
form state and a live-updating results panel, which any framework handles, so the
tiebreaker was ecosystem familiarity for future contributors. The rules engine is
deliberately framework-free: `src/engine` and `src/domain` import nothing from React and
could be lifted into a different app unchanged.

The bundle is ~75 KB gzipped, most of it React. If that becomes a problem for the audience
this serves — people on old phones and metered connections — the engine's independence
means swapping the view layer for Preact or plain DOM is a contained change.

## Privacy architecture

The guarantee is that answers never leave the tab. Concretely:

- Interview state lives in one React hook, [`useInterview`](../src/ui/useInterview.ts). It
  is the only place answers are held, deliberately, so any future persistence has to be
  added there and cannot creep in sideways.
- No `localStorage`, `sessionStorage`, cookies, or IndexedDB.
- No answers in the URL. There is no router; screen transitions are local state, so nothing
  leaks through browser history or a `Referer` header.
- No network calls at runtime. The program dataset is compiled into the bundle.
- No analytics. If any are ever added, they must be event-count only — never answer values,
  never a fact set that could re-identify a household.

Closing the tab destroys the data. That is the intended behaviour, not a missing feature.

## Data schema

[`src/domain/program.ts`](../src/domain/program.ts) defines one `Program` record.
Everything is flat and serializable so a future ingestion pipeline can populate it without
a rewrite — the only field resisting automation is `eligibility`, which is why the criteria
language is small and declarative.

Notable fields:

- `source: { url, name, lastVerified }` — `lastVerified` is `string | null`, and null means
  never checked. A nullable date rather than a defaulted one, because a plausible-looking
  date on unverified data is worse than an obvious gap.
- `eligibilityCaveats` — conditions the engine deliberately does *not* model (asset tests,
  work requirements riddled with exemptions). Always shown with a match, so "you qualify"
  is never overstated.
- `status` — `open` / `seasonal` / `waitlist` / `closed`. A program can be eligible on paper
  and unavailable in practice; conflating those misleads people.
- `categories` — all six from the brief are declared, though v1 only populates two. Adding
  childcare or veterans programs is a data change, not a schema change.

Income thresholds live apart from programs, in
[`src/data/reference/income-tables.ts`](../src/data/reference/income-tables.ts), because
they change annually on their own schedule. FPL, Wisconsin SMI (for WHEAP), and HUD Area
Median Income for Dane County. AMI is modelled as HUD actually computes it — a four-person
median plus household-size adjustment factors — so updating the base figure keeps the
derivation correct.

### Where records live

One file per program under `src/data/programs/`, re-exported from `index.ts`. Curation is
per-program: each record carries its own `lastVerified` and gets re-checked on its own
schedule, so a per-file diff makes "what changed when we re-verified this" legible in
review. A single consolidated file would turn every verification pass into one large,
unreadable diff.

## Rules engine

### Three-valued logic

The central decision. Every criterion evaluates to `pass`, `fail`, or **`unknown`**, and the
boolean combinators use Kleene logic:

| | result |
|---|---|
| `allOf` | `fail` if any child fails, else `unknown` if any is unknown, else `pass` |
| `anyOf` | `pass` if any child passes, else `unknown` if any is unknown, else `fail` |
| `not` | swaps pass/fail, leaves unknown alone |

`unknown` is a real answer, not an error, and that is what makes progressive matching work.
A program is "possibly eligible" exactly while some part of its rule is unknown and no part
has failed. The three buckets fall out of the logic rather than being computed separately.

Note the asymmetry: `allOf` returns `fail` even while siblings are still unknown, because
one disqualifying answer rules a program out no matter what else we learn. That is what
lets the app rule things in and out from the first screen instead of waiting for a complete
interview.

### Explainability

Criteria are **data, not functions**. That is the whole reason for the little expression
language — a predicate closure can be evaluated but not inspected, so the engine walks the
same tree it evaluated and generates a human-readable reason for each verdict.
`decidingReasons` then prunes the trace to the leaves that actually decided it: a failing
`allOf` is explained by the children that failed, a passing `anyOf` by the branch that
succeeded, not by everything under them.

Explanations are generated from structure rather than hand-written, so they cannot go stale
when a rule beside them changes. Where household size is known, income rules name the
actual dollar cutoff rather than "130% of the federal poverty level".

### `manualReview`

Some eligibility genuinely cannot be decided by a rules engine: "subject to funding
availability", "the waiting list is currently closed", caseworker discretion. These are
encoded as a `manualReview` node that is *always* `unknown`, pinning the program in "might
qualify" with an explanation. Modelling them as `always` would claim knowledge we do not
have — for the Housing Choice Voucher, the waiting list is the binding constraint far more
often than income is.

## The interview

### Asking as few questions as possible

A question is expensive; a fact is cheap. Three mechanisms keep the interview short:

**One answer can settle several facts.** "Where do you live? → City of Madison" sets city,
county, *and* state. There is no reason to walk someone down a country → state → county →
city ladder when the narrowest answer implies every broader one. Choices therefore carry an
`implies` map rather than a single value.

**Related yes/no facts collapse into one checklist.** Three separate questions about
children under 5, pregnancy, and school-age children become one "who is in your household"
checklist. Critically, submitting it records the *unchecked* boxes as `false` rather than
leaving them unknown — that is what makes one checklist worth three questions.

**Questions that cannot change an outcome are not asked.** After every answer the whole
dataset is re-evaluated, and a question is dropped when no still-undecided program depends
on any fact it supplies. Someone outside Wisconsin gets a handful of federal questions
instead of the full interview. Remaining questions are ordered by how many undecided
programs they would resolve — most decisive first.

Ranking counts *distinct programs* a question would unblock, not a sum of per-fact tallies,
so a question supplying two facts a single program is waiting on scores 1, not 2.

Why a plain count rather than an information-theoretic score: true entropy needs a prior
over how people answer, which we could only get by collecting answers — precisely what the
privacy constraint forbids. Counting unblocked programs needs data about nobody, and on a
dataset this size picks the same questions.

### One fact, one owner

Each fact is written by exactly one question, enforced by a test. An earlier draft had
"unhoused" imply `facingLossOfHousing: true` while a later checklist also set that fact —
so the checklist would silently overwrite the inference with `false`. Implications must not
cross question boundaries.

### Fixed groups, adaptive order

Screens are coherent groups asked in impact order, with visited screens keeping their place
in history so the back button stays trustworthy. Screen *contents* are fixed; which screens
appear, and in what order, adapts.

### What v1 does not ask

`citizenshipStatus`, `employmentStatus`, and `age` are declared in the fact vocabulary but
no v1 rule consults them, so asking would be pure friction — and `flow.ts` would score them
zero and never show them anyway.

Immigration status is the pointed case. It genuinely affects federal food benefits, but the
rules are full of exceptions — children frequently qualify when adults do not — and an
engine that got them slightly wrong would tell a family they are ineligible when they are
not. That is the worst error this app can make. v1 declines to encode it; affected programs
carry a plain-language caveat and stay in "might qualify".

## Testing

`npm test` runs 75 tests across four layers:

- **`tests/engine/evaluate`** — three-valued logic, including that `false` is treated as
  answered rather than missing, and that a settled verdict stops reporting missing facts.
- **`tests/engine/match`** — bucketing against the *real* dataset, so a curation mistake
  that would mislead someone fails the build. Includes the invariant that results are never
  empty: pantries and referral lines have no income test by design.
- **`tests/interview/flow`** — simulates whole interviews per persona and asserts the
  efficiency properties: compound answers, no pointless questions, a shorter interview
  out of state, and nothing left undecided that another question could settle.
- **`tests/data/vocabulary`** — cross-checks the dataset against the interview. A rule
  referencing an unaskable fact, or a question no rule consults, fails here. Neither is
  visible by reading either file alone.
- **`tests/ui/app`** — renders the real app in jsdom and drives it, confirming the rules are
  wired to the screen and the disclaimers are actually present.

## Build order

1. ~~Scaffold, domain model, criteria language~~ ✅
2. ~~Rules engine with three-valued evaluation and traces~~ ✅
3. ~~Seed dataset, 15 programs~~ ✅ (unverified — see below)
4. ~~Interview definition and adaptive flow~~ ✅
5. ~~UI with progressive results and "why?" disclosure~~ ✅
6. ~~Test suite~~ ✅
7. **Verify all 15 program records and 3 income tables against sources** ← next, blocks launch
8. Accessibility pass — keyboard traversal, screen reader, 200% zoom
9. Deploy to static hosting
10. Print/share view for taking results to an appointment

## Known gaps

- **The seed data is unverified.** Every record carries `lastVerified: null` and the app
  shows a warning banner. This blocks public launch; see
  [data-authoring.md](data-authoring.md).
- **No Spanish or Hmong.** Both matter for this audience in Dane County. No i18n framework
  is wired in yet, and retrofitting one will touch every string.
- **Income is asked as an annual figure**, but WHEAP actually counts the last three months.
  Someone recently laid off may be told they do not qualify when they do. The caveat says
  so; the model should eventually carry a recent-income fact.
- **Screens are ordered by impact but grouped by hand.** Fine at 15 programs; worth
  revisiting well before 100.
