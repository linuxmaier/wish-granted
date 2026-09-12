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

### Hosting, headers, and log retention

See [`deploy.md`](./deploy.md) for the CI setup, the Cloudflare Pages project configuration,
branch protection, rollback, and the one-time post-deploy header check -- this section is the
*why*, that file is the *how*.

Deployed on **Cloudflare Pages**, chosen specifically because it supports a `public/_headers`
file — the CSP and other security headers below are real response headers, not a `<meta>`
tag, which is the degraded form GitHub Pages would have forced (no custom headers there).

**Content-Security-Policy**, in [`public/_headers`](../public/_headers): `default-src 'self'`
with everything unused set to `'none'`, most importantly `connect-src 'none'` — this turns
"no network calls at runtime" (above) from a property of the code into one the browser
enforces. A future contributor adding a CDN font, an analytics snippet, or a stray `fetch`
gets a blocked request and a console violation, not a silent privacy regression. No
`'unsafe-inline'` anywhere: the production build (checked before this policy was written) has
no inline `<script>` or `<style>` blocks, and the one inline `style` prop in the app
(`App.tsx`'s progress bar) was verified empirically to go through the CSSOM `style` property
rather than an inline attribute, which Chromium does not treat as covered by `style-src`.
`tests/e2e/csp.spec.ts` (run via `npm run test:e2e:prod`, see that file and
`playwright.prod.config.ts` for why a separate config exists — `npm run test:e2e` runs
against the dev server, which never serves `_headers`) asserts the headers are present on the
deployed-shape build and that an injected external request is actually refused, not just
absent by convention.

Also set, each for a specific reason: `Strict-Transport-Security` (force HTTPS; no `preload`
yet — that's a near-permanent submission to browser vendors' preload lists and belongs to a
deliberate decision once the production domain is final); `Referrer-Policy: no-referrer` (for
this audience, a `Referer` header disclosing "came from a benefits-screening tool" is itself a
meaningful leak — this covers even the same-origin footer link to `/privacy`);
`X-Content-Type-Options: nosniff`; `Permissions-Policy` denying `geolocation`, `camera`,
`microphone`, `payment`, `usb`, and `interest-cohort` (an explicit opt-out of FLoC/Topics-style
tracking APIs); `frame-ancestors 'none'` plus the redundant-but-free `X-Frame-Options: DENY`
for older tooling.

**Logs and retention.** We do not run our own server or logging — there is nothing for us to
retain, export, or be compelled to hand over, because we were never given it. On the
Cloudflare Pages tier this project uses, raw per-request logs (IP, timestamp, path, user
agent) are not exposed to us at all: that level of log access (Logpull/Logpush) is an
Enterprise feature. We consider that a feature of this hosting choice for a tool like this,
not only a limitation: **we can't see what we don't collect.**

The honest limit on that claim: Cloudflare itself, as the infrastructure serving the page,
still necessarily processes that same connection metadata on its own systems in order to
operate its network — that is inherent to being a web host, the same way a postal service
has to read an envelope's address to deliver it. That processing happens under Cloudflare's
own privacy policy, which we do not control and have no visibility into. We looked for a
single, authoritative, publicly documented retention period that applies to a plain Cloudflare
Pages site on our tier and could not find one — the one concrete figure we found (~124 days)
belongs to an unrelated Enterprise product (Privacy Gateway) and would have been a wrong
number if quoted here. **Open decision, not yet made:** whether to accept this free-tier
posture indefinitely, or pursue an arrangement (Enterprise, or a different host) that gives
this project visibility into and control over that retention window. Until that's decided,
the public [privacy statement](../public/privacy.html) states only what we've verified —
no invented number.

**Analytics:** no analytics script, tracker, or beacon, and none enabled — Cloudflare Web
Analytics is opt-in per-project (not on by default for a fresh Pages project) and we have not
turned it on. This is narrower than "no counter of any kind": the Workers & Pages dashboard's
built-in project metrics (aggregate request counts, shown by default for any deployed project,
not gated behind an opt-in) are separate from Web Analytics and appear to apply regardless of
whether a project uses Pages Functions. We could not find Cloudflare documentation stating
plainly whether that default view includes purely static Pages projects, so the privacy
statement states the aggregate-count possibility rather than claiming zero counters of any
kind, which would risk being false.

**Outbound links:** every program/source link already used `rel="noreferrer"` before this
work (`ProgramCard.tsx`, `Results.tsx`) — `tests/e2e/personas.spec.ts` now asserts that stays
true as the results panel grows, rather than relying on convention.

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

One file per program under `src/data/programs/`, aggregated by
[`records.ts`](../src/data/programs/records.ts). Curation is per-program: each record carries
its own `lastVerified` and gets re-checked on its own schedule, so a per-file diff makes
"what changed when we re-verified this" legible in review. A single consolidated file would
turn every verification pass into one large, unreadable diff.

### The shippable snapshot (issue #8)

The app does **not** import `records.ts`. `npm run build:snapshot` serializes those records
into [`src/data/programs/snapshot.json`](../src/data/programs/snapshot.json) — a build-time
artifact, committed to the repo, compiled into the bundle by Vite like any other module.
`src/data/programs/index.ts` loads *that*, and nothing else, so the app only ever sees one
shape of the dataset regardless of whether a record was hand-typed or, later, generated.

Why a compiled artifact and not just the TS array:

- **It is the write target for anything that generates records.** The app never changes
  shape when that lands; only what writes `records.ts` (or its successor) does. Nothing
  generates records today — the extraction programme was unwound on 2026-09-08 (#97) — but
  the seam costs nothing to keep and is the reason the app is indifferent to how a record
  was authored.
- **It is validated as data, at build time.** [`snapshot-schema.ts`](../src/data/programs/snapshot-schema.ts)
  hand-rolls a validator (no new dependency). `npm run build` runs `build:snapshot -- --check`
  before `tsc`/`vite`, so a malformed *or stale* snapshot fails the build rather than
  shipping — `vite build` bundles `index.ts` without executing it, so the runtime
  `assertValidSnapshot` in that file (which does catch it under `npm test` / `npm run dev`)
  is not sufficient on its own. Both gates exist deliberately.
- **It carries provenance the raw array cannot.** `generatedAt` (ISO 8601 UTC — the field
  #44's "data as of" indicator consumes; it means *assembled*, not *verified*),
  `snapshotVersion`, `generator`, and `factVocabulary`.

**The fact-vocabulary seam.** `factVocabulary` is the sorted set of every fact key the
shipped `eligibility` rules reference. It is *declared* in the snapshot rather than left to
be re-derived, because it is the seam between the dataset and the interview model: a rule
that references a fact no question asks strands its program in "might qualify" for everyone,
forever, and nothing in the running app surfaces that. `tests/data/vocabulary.test.ts` and
`tests/data/snapshot.test.ts` both check the declared set against what the rules actually
touch and against what the interview can ask; `--check` re-runs the cross-check in the
build. If records ever become machine-generated, a record format that ships compiled
criteria instead of full trees can still state its vocabulary here.

**Round-trip fidelity.** `Program` is flat and `Criterion` is a data tree with no closures,
so JSON serialization only drops `undefined`-valued optional keys and re-orders object keys
— neither of which the engine observes (`evaluate.ts` reads `criterion.label` as
`undefined` whether the key is absent or explicitly unset). `tests/data/snapshot.test.ts`
asserts `matchAll` sees an identical corpus, and the full existing unit + e2e suites pass
unmodified. `generatedAt` is held stable across a no-op rebuild (the generator carries the
previous value forward when the record content is byte-for-byte unchanged), so regenerating
without editing a record produces no diff.

**Size budget.** Measured 2026-09-05 on the 17-record seed dataset, gzipped (`level 9`),
via `npm run build:snapshot -- --measure`:

| | gzipped |
| --- | --- |
| whole `snapshot.json` | 9,785 B (46,693 B raw) |
| per record, **amortised** (records array gzipped ÷ 17) | **524 B** |
| — of which `eligibility` tree | ~63 B |
| — of which prose (`summary` + `benefit` + caveats + steps) | ~364 B |
| per record, gzipped standalone (spread, includes ~18 B framing each) | 618–1,330 B |

The budget number is the amortised one — that is how the records actually ship, one stream
with a shared dictionary. It comes in a little above #1's original ~460 B/record estimate
(that measurement predates the BadgerCare Plus and Wisconsin Shares records). The
`eligibility`-tree figure is *far* below #1's ~250 B guess: the trees are small and highly
repetitive (`{kind:"compare",fact:"state",op:"eq",value:"WI"}` recurs across most records),
so gzip crushes them once amortised. Prose is the real cost and the natural lazy-load target
if the corpus ever outgrows one bundle — but per #1, detail must be fetched for the whole
match set at once or not at all, and chunking is explicitly out of scope here (~524 B/record
means 1,000 programs is ~512 KB gzipped, comfortably inside "serve everything"). No prose is
abbreviated today: the results UI renders all of it, so trimming it would be a behaviour
change. The format simply keeps the full record; an abbreviated-prose variant is a future
`SnapshotRecord` change, not a schema-version bump.

**Bundle cost of this change:** production JS went 79.67 KB → 81.86 KB gzipped (+2.19 KB).
The 17 record modules leave the bundle; `snapshot.json` (~8.9 KB gzipped) and the runtime
validator (~1.5 KB gzipped) enter it. JSON is slightly less compressible than the
builder-call TS form it replaces, which is most of the net increase. The validator ships to
the browser deliberately — an invalid snapshot failing loudly at load is the point.

**Where the curation database lives — decided: git.** #1 left this open ("where the curation
DB lives and who can write to it, given the app itself has no backend"). The answer for now
is that there is no separate database: the records are files in the repo, git history *is*
the change history, and PRs are both the write path and the review gate. This satisfies
#14's "land changes as PRs, never write directly to the published dataset" for free, needs
zero new infrastructure, and suits a one-person part-time maintainer. Per-record provenance
for hand-authored records is `git blame` plus the record's own source-comment (the
convention `docs/data-authoring.md` already enforces). Richer per-record provenance
(source URL, fetch timestamp, the text span a generated rule came from) attaches as an
optional `provenance` field on `SnapshotRecord` if anything ever needs it — adding it is a
non-breaking schema change, not a rework.

A committed SQLite curation DB with the snapshot exported from it would be better at two
things: deduplicating a program that appears in both a state list and a county directory
(#1's open question), and answering provenance queries at scale. It is not justified yet —
17 hand-authored records have no dedup problem, and it would add a binary artifact to git
plus a tool every contributor must install. What would change the decision: the first Tier-1
directory ingestion (#14) landing hundreds of records with real cross-source overlap, at
which point dedup stops being hypothetical. Until then, dedup is a human noticing two
records during PR review.

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

A screen can name one question as its `anchorQuestionId`, which stays first regardless of
impact — an escape hatch for a question that is a natural preamble to the rest of the
screen, not a redesign of the default order. The housing screen anchors "which best
describes your housing right now?" ahead of the trouble checklist, which otherwise scores
higher but reads backwards asked first. Anchoring does not exempt a question from the
relevance filter above: an anchored question nothing undecided depends on is still dropped.

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

### What the interview does not ask

`citizenshipStatus` and `employmentStatus` are declared in the fact vocabulary but not
asked, so `flow.ts` scores them zero and never shows them. Both are standing decisions with
reopen conditions — see [standing-decisions.md](standing-decisions.md); the reasoning is
recorded there once and is not repeated here.

`age` used to sit in that list. Issue #88 replaced the rule that kept it there, and it is
now asked as a band on its own `about-you` screen. The screen is skippable, and a blank
answer leaves the affected programs at "might qualify" — never ruled out.

There are eight bands, and they are deliberately uneven: every boundary is a real program
cut-off, listed against its program in `AGE_BANDS` (`src/domain/facts.ts`). The list grew
from three when the corpus survey found ~14 candidates with a boundary three cut points
rounded away — see [interview-roadmap.md](interview-roadmap.md). `tests/data/vocabulary.test.ts`
checks that every declared band is actually offered by a choice, because a band no question
can produce is a rule no answer can satisfy.

`veteranConnection`, `hasDisability` and `hasChildUnder18` are declared but not yet asked,
for a different reason from `citizenshipStatus` and `employmentStatus`: each has a measured
question waiting on it and lands with the first verified record that needs it. The shapes
are settled ahead of the records so two authors cannot coin two spellings of one fact.

### What the corpus actually gates on (issue #9)

Issue #9 re-derived the fact vocabulary from what the verified 15-program corpus actually
gates on, rather than from the programs the interview was originally designed around. Raw
counts: `state` gates 14/15 programs, `annualHouseholdIncome`/`householdSize` 10/15,
`currentBenefits` 8/15, `county` 5/15, `housingStatus` 3/15, `hasSchoolAgeChild` 2/15, and
six facts — `city`, `facingLossOfHousing`, `utilityShutoffRisk`, `paysHeatingCost`,
`isPregnantOrPostpartum`, `hasChildUnder5` — each gate exactly 1/15.

The numbers are recorded because they are easy to misread. "Gates 1/15 programs" looks like
an argument for demoting a fact to an `eligibilityCaveat`, and it is not: every one of those
six rides inside a checklist that renders anyway — the housing-trouble flags and the
household-members flags — so demoting one would not shorten anyone's interview. It would
only cost the engine the ability to resolve WHEAP crisis assistance or eviction prevention
either way, pushing them into "might qualify" for everyone. That is a regression dressed as
a simplification.

The general rule this illustrates — marginal cost, not raw frequency — is stated in
[standing-decisions.md](standing-decisions.md), "When a fact earns a question".

### Recent income (issue #9)

The "Known gaps" section below used to note that WHEAP's real income test didn't match our
annual-income question, and that the model should eventually carry a recent-income fact. That
gap is now closed, deliberately narrowly:

- **`recentIncomeDrop` is a boolean ("has your income dropped recently?"), not a dollar
  figure.** A precise recent-month income number is hard to estimate accurately mid-crisis,
  and even a precise one couldn't be safely compared against the WHEAP income table without
  parameterising `incomeAtOrBelow`'s fact source in the engine (`src/engine/evaluate.ts`,
  `src/domain/criteria.ts`) — a real change, filed as #34 rather than bundled here. The
  boolean version and the numeric version resolve the same way operationally either
  way (a household that answers "yes" is routed to their county agency, because this app
  cannot responsibly compute WHEAP eligibility from a self-estimated figure) — what the
  numeric version would buy is a *definite* answer instead of "might qualify", which is a real
  but separable improvement.
- **It can only rescue a `fail`, never manufacture a `pass`.** `wheap-energy-assistance.ts`,
  `wheap-crisis-assistance.ts`, and `wisconsin-weatherization.ts` each add a third `anyOf`
  branch: `allOf(isTrue('recentIncomeDrop'), manualReview(...))`. Because `manualReview`
  always evaluates `unknown`, this branch can only hold a program at "might qualify" instead
  of letting it be wrongly ruled out on an annual figure that may no longer reflect the
  household's situation — it can never turn the branch, or the program, into an outright
  `pass`. That asymmetry is deliberate: under-claiming beats over-claiming, always.
  Weatherization's rescue branch is worded more cautiously than the two WHEAP-named records
  ("this program's income test *may* look at recent income...") because the "Home Energy Plus"
  umbrella link connecting it to WHEAP's own PY26-manual citation is inferential, not
  independently confirmed for Weatherization's income-test timing specifically — flagged in
  that file's own comment for whoever next verifies the record.
- **Placement had to fight the impact ranking, twice, not just use it.** The question lives on
  its own screen (`recent-income`), gated by a `showIf` requiring `housingStatus` and
  `paysHeatingCost` to already be known. Two earlier placements were tried and both failed a
  real test before this one, worth recording so nobody repeats either attempt:
  1. On the `household` screen (alongside income), with no guard: every WHEAP-family program
     starts out undecided, so `recentIncomeDrop` sat in their `missingFacts` before annual
     income was even known — asked of nearly everyone in Wisconsin.
  2. Sharing the `situation` screen with `current-benefits`, gated by `showIf` alone: this
     fixed problem 1, but `current-benefits` alone often has enough independent impact to make
     `situation` outrank `housing` in the impact sort *before* `recentIncomeDrop`'s `showIf`
     ever turns true. Screens are never revisited once shown (the back-button-trustworthiness
     invariant), so `situation` got "used up" on `current-benefits` alone and this question
     silently never got offered — a real Playwright run against the actual UI caught this; the
     unit-test harness in `tests/interview/flow.test.ts` did not, because it always answers
     whatever's on a screen the instant it's shown, which never exercises "a screen was visited
     before this question's precondition became true."

  A dedicated single-question screen fixes both: with only one question and a `showIf` guard,
  `screenImpact` (flow.ts, which skips `showIf`-hidden questions) is forced to zero until
  `housingStatus` and `paysHeatingCost` are both known, so the screen itself is never
  *relevant* — and therefore never visited — until its precondition holds. It cannot be "used
  up" by an unrelated question the way sharing a screen allowed. Every WHEAP-family program
  also gates directly (outside the income `anyOf`) on one of those facts, which guarantees the
  `housing` screen stays relevant and gets shown first, so there is no circular wait between
  the two screens. See `src/interview/screens.ts`'s `recent-income` screen comment and
  `tests/interview/flow.test.ts`'s "the recent income drop question (issue #9)" block for the
  mechanism-level proof, and `tests/e2e/personas.spec.ts`'s `LAYOFF_MADISON` persona for the
  real-browser regression test that caught attempt 2.
- **Measured cost.** Zero extra questions for a household that already passes on annual income
  (`madisonFamily`-shaped personas) or is out of state — `recentIncomeDrop` never enters their
  `answers` at all. Zero extra questions for a household ruled out by a non-income fact first
  (doesn't pay heat, no shutoff risk, doesn't rent or own). Exactly one extra question — at the
  very end of the interview, after everything else is settled — for a household whose annual
  income and current benefits both fail the WHEAP-family test and who does pay heat/rent or
  own. That population gaining one question is the fix working as intended, not a cost to
  apologize for.

## Visual design

Issue #10 asked for a deliberate pass: "approachable yet professional... calm, uncluttered,
trustworthy." Before touching anything, the existing UI was screenshotted at desktop and
360px, light and dark, and with a realistic dense result set (15 programs, all "might
qualify" on the first screen). The concrete problems that fell out of that review, not just
a vibe:

- **Color-only state coding, three times over.** Eligible / might-qualify / ruled-out was
  signaled by heading color, card border, and badge fill — the same hue at three altitudes,
  which is one signal, not three, and does not survive grayscale or red-green color
  deficiency. The old "ruled out" text measured 4.63:1 against its background — legal, but
  the thinnest margin in the palette, with the #13 contrast audit still ahead.
- **The accent color used as a call to action fifteen times in a row.** The same saturated
  green filled "Continue" and every card's "How to apply" button, so a 15-card results panel
  read as fifteen equally urgent actions rather than one.
- **No seam between "answering" and "reading."** The interview and results panels were
  identical white cards on the same background, so on mobile — where they stack — nothing
  marked the transition from one to the other.
- **A caution-tape banner as the first thing on the page.** The unverified-data warning was
  a flat warning-yellow `role="alert"` — appropriately prominent, but for an audience that
  may already be in crisis, a loud yellow alert as the literal first impression reads as
  "something is wrong with this site" rather than "double check these numbers."
- **A progress bar that could jump with no explanation.** Answering one question can make
  several later screens irrelevant at once (see "Asking as few questions as possible"
  above), so the bar advancing several steps at once is honest — but nothing said so, which
  reads as a glitch.
- **Uniform 10px radius on every element** blurred the distinction between "things you act
  on" (buttons, inputs) and "things you read" (cards, panels), and a narrow type scale gave
  little visual difference between "call this number" and "here's a caveat."

### Direction: "Quiet civic"

Three directions were sketched (an editorial paper-like theme, a cool minimal-utility theme,
and a warm always-single-column theme); the project owner chose the first, "Quiet civic":

- **Color** ([`src/ui/styles.css`](../src/ui/styles.css)) — a warm paper background
  (`#f7f5f0`) rather than pure white or neutral gray, one muted teal-green accent (`#2a6b52`)
  spent only on the progress bar and the single primary action per screen, and three
  distinct hues for eligible / might-qualify / ruled-out, each re-verified against WCAG AA:
  every text/background pair in both themes now measures at least 5.1:1 (light) and 7.3:1
  (dark), a wider margin than the palette it replaced.
- **Shape over color for match state** ([`src/ui/components/icons.tsx`](../src/ui/components/icons.tsx))
  — eligible, might-qualify, and ruled-out each get a small inline icon (solid-ring
  checkmark, dashed-ring dot, ringed dash) that is a distinct *shape*, not just a distinct
  color, so the state still reads with color removed. Icons are `aria-hidden`; the state is
  always also written out as real text next to them, so nothing is conveyed by shape alone
  to assistive tech.
- **Accent discipline.** Exactly one filled, saturated button exists on any given screen —
  Continue. Every other button (Back, Start over, How to apply, a phone number) is now an
  outline in the same accent color (`.button--quiet`), so a dense results panel does not read
  as a wall of equally-urgent calls to action.
- **Type** — a system serif (`Georgia, 'Iowan Old Style', 'Palatino Linotype', serif`) for
  headings and card names, system sans for body copy, both at zero bytes since they ship
  with the OS. A real 7-step scale (13/14/16/18/23/29/37px) replaces the old narrow range.
- **Space** — an 8px rhythm (`--space-1` through `--space-7`) applied consistently, plus a
  divider between result groups and between a card's apply/steps/caveats sections, so density
  in the results panel reads as organized sections rather than one undifferentiated scroll.
- **Two radii, not one** — `--radius-control` (8px) for things you act on, `--radius-card`
  (14px) for things you read, so the page stops reading as one uniform register of form
  controls.
- **The banner** ([`src/ui/App.tsx`](../src/ui/App.tsx)) is now a calm, factually-worded
  notice (`.banner--notice`) rather than a warning-yellow alert — its own tinted panel and
  icon, still `role="alert"` so assistive tech still announces it immediately, still
  impossible to miss. The lead-in changed from "Draft data." to "Not yet verified.", though
  the sentence the unit test asserts on (`/not yet been checked/i`) was left intact
  deliberately, so no test needed to change for the tone shift.
- **Progress jump acknowledgment** — the step label now reads "Step *n* of about *total*"
  (reconstructed exactly from `history.length / progress`, no new state in
  `src/interview/`), and a one-line note appears for a few seconds the first time progress
  advances by more than a small increment: "A couple of questions were skipped — your
  answers so far already settle them."
- **Mobile bottom strip** ([`src/ui/components/MobileSummary.tsx`](../src/ui/components/MobileSummary.tsx))
  — below 900px, a fixed strip at the bottom of the screen jumps straight to the results
  anchor without scrolling past the interview. It is always in the DOM; CSS alone decides
  whether it's visible, so a stylesheet failure degrades to an ordinary inline link rather
  than losing the shortcut. Its accessible name ("View your results") is stable; the match
  count is a separate `aria-live="polite"` span so count changes are announced gently rather
  than interrupting whatever the screen reader user is doing — results update on every
  answer, and "assertive" would mean an interruption on every single one. See "Live regions"
  below for how this interacts with the results panel's own `aria-live`.

### Observation, not fixed here: the mobile above-the-fold stack

On a fresh mobile load, the draft-data banner, masthead, tagline, and privacy line together
take up roughly 40% of the first viewport before the first question is visible. It's
acceptable today, and improves the moment the banner clears (two data-verification passes
are in flight as of this PR). Trimming it further without touching card hierarchy didn't
have an obvious cheap answer -- the candidates (shortening the tagline, collapsing the
privacy line into the footer, tightening the banner's own padding) all trade away something
the copy is doing on purpose. Left as-is; if it needs a structural answer (e.g. deferring the
privacy line, or a slimmer masthead once the banner is gone for good) that's a call for #11
rather than a CSS-only tweak here.

### Live regions (resolved in #13)

`Results.tsx`'s `<section>` used to carry `aria-live="polite"` on the whole panel -- badges,
reasoning, up to fifteen program cards, all one live region. Because results recompute on
every answer, that queued an enormous announcement after essentially every interaction, which
a screen reader user had to sit through or interrupt. A second, smaller `aria-live="polite"`
region was later added to the mobile summary strip (just the match count), which meant mobile
got both announcements on every answer.

#13 removed `aria-live` from the results `<section>` entirely and replaced both regions with
one: a visually-hidden `role="status"` element inside `Results`, holding only a short count
("4 likely matches"). It lives in `Results` rather than the mobile strip because the strip is
`display: none` above 900px -- an `aria-live` region inside `display: none` content is outside
the accessibility tree, so it can never be heard, and the mobile-only version was silently
useless on desktop. `MobileSummary` now shows the identical wording as plain visible text,
with no live region of its own, so mobile hears the count exactly once.

`ProgramCard`'s "Why this result?" toggle gained `aria-expanded`, matching the pattern the
ruled-out toggle in `Results.tsx` already used. And #13 added focus management on screen
transitions: pressing Continue or Back now moves focus to the new screen's heading
(`tabIndex={-1}`, never on first render), so a keyboard or screen reader user encounters the
next question instead of being left on a button that no longer does anything new. Verified in
real Chromium that mouse-driven transitions do not paint a focus ring (`:focus-visible` does
not match) while keyboard-driven ones do.

**Honesty about how this was verified:** the decision to remove the section-wide live region,
and the wording of its replacement, were made by reading ARIA semantics and testing with
Playwright + axe-core, not by listening to a real screen reader -- NVDA/VoiceOver could not be
driven from the environment #13 was done in. The live-region wording was kept deliberately
short and factual for exactly this reason: less for a real AT pass to overturn. A manual
NVDA/VoiceOver walkthrough of this decision is filed as a follow-up and should happen before
public launch.

## Bugs found (and fixed) during review

Two real regressions surfaced during the design-pass review, both from the same root cause:
content that's correctly *visible* in the DOM's normal flow can still end up in the wrong
place relative to something else, if you only test the box a component draws and not where a
finger or a browser's own click-delivery would actually land.

**A grid overflow.** Widening the badge ("You might qualify" plus an icon, in a non-wrapping
pill) pushed a `.program__head` flex row's min-content past what fit at 360px, and the
single-column mobile grid used a bare `1fr` track, which has an implicit `auto` (min-content)
minimum -- so the whole column, and the page, gained a horizontal scrollbar. Fixed two ways:
the mobile grid track is now `minmax(0, 1fr)` (matching the pattern the desktop two-column
declaration already used), and `.program__head` gained `flex-wrap: wrap` so a long badge can
drop to its own line instead of forcing the row wider than the viewport. Verified clean (no
horizontal scroll) at 320, 360, 390, and 1440px, and at a simulated 200% desktop zoom. Below
roughly 200px of effective layout width -- well under this project's stated 360-390px target
and under WCAG's 320px reflow baseline -- the badge pill itself remains a hard content floor,
since it deliberately does not wrap; noting this rather than chasing a synthetic edge case
that would mean shrinking the badge below a legible size.

**The mobile summary strip covered the Continue button.** At 360x640 -- a common real phone
shape, and narrower than the 412px Pixel 7 the e2e mobile project runs at -- the fixed strip's
zone at the bottom of the viewport overlapped the Continue button whenever the interview
screen's content was short enough that scrolling the button into view parked it flush against
the viewport's bottom edge. The button was `visible` by every check that only asks "is this
element on screen," but `document.elementFromPoint` at its centre resolved to the strip, not
the button -- the actual property that matters (would a tap here reach the button?) was never
true. Two reservations now exist for the two different ways a fixed footer can cover content:
`scroll-padding-bottom` on the scrolling root, so the browser's own scroll-into-view machinery
(native `scrollIntoView`, Playwright's actionability scrolling, Tab-focus auto-scroll, anchor
jumps) stops short of the strip's zone no matter where the target sits in the document -- this
is the actual fix for the reported bug -- and `.app`'s existing `padding-bottom`, which
reserves the same clearance at the tail end of the document for a user scrolling all the way
down by hand. Verified at 360x640 (the reported width), 360x800, and a 200%-zoom proxy, all
the way through a full interview with real `.click()` calls, not just a static overlap check.

**What this says about the test suite.** All 20 e2e tests passed before this fix, including
on the `mobile` project -- which runs at the Pixel 7's 412px, comfortably wider than where the
bug reproduced. The suite looked like it covered mobile and actually covered *one* mobile
width, on the comfortable side. Two changes address that going forward, not just this one bug:
a `mobile-360` project in `playwright.config.ts` (360x640, the reported width, run alongside
`desktop` and `mobile`), and a new test, `the Continue button is not covered by anything,
including the mobile summary strip`, that checks `elementFromPoint` at the button's centre
and then performs a real click and asserts the interview actually advanced -- "visible" was
true in the failing case, so visibility was never the property worth asserting. Confirmed the
new test fails against the pre-fix CSS and passes against the fix, on all three projects.

### Bundle size

Before this pass: 1.93 KB gzipped CSS, 75.78 KB gzipped JS (~77.7 KB total). After: 2.64 KB
gzipped CSS, 76.71 KB gzipped JS (~79.35 KB total) -- a ~1.65 KB (2.1%) increase, from the
icon components, the mobile summary strip, and the `scroll-padding-bottom` fix. No new
runtime dependencies.

## Testing

`npm test` runs 81 unit tests; `npm run test:e2e` runs 33 browser tests across three
projects (desktop, `mobile` at 412px, `mobile-360` at 360px); `npm run test:all` does both.

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
- **`tests/e2e/personas`** — walks whole interviews through real Chromium, on desktop and
  mobile viewports.

### Why the e2e layer exists

It was added after a bug the other four layers structurally could not catch. "211 Wisconsin"
carried an `always()` rule so results would never be empty; every unit test passed, and the
finished interview still told a user in another state they qualified for a Wisconsin-only
service. Worse, the unit assertion that *results are never empty* was passing **because** of
the bug — the bad data was propping up the test meant to catch that class of problem.

What made it visible was walking a persona end to end and reading what a person would
actually see. So the e2e specs assert user-visible outcomes ("a family in crisis sees the
emergency programs", "never claims a Wisconsin-only service applies out of state") rather
than function return values, and two of them verify the privacy guarantee empirically: zero
network requests once the interview starts, and nothing written to storage, cookies, or the
URL.

### Honest empty states

The matcher is now strictly truthful, so it can legitimately return nothing — and it does,
for a high-income household outside Wisconsin. That is handled in the UI rather than by
padding the results: out-of-scope users are told this tool only covers Wisconsin and pointed
at national 211 and USA.gov (`src/data/national-resources.ts`). Those are
deliberately not `Program` records; they are never matched against and never appear in a
bucket.

## Build order

1. ~~Scaffold, domain model, criteria language~~ ✅
2. ~~Rules engine with three-valued evaluation and traces~~ ✅
3. ~~Seed dataset, 15 programs~~ ✅ (unverified — see below)
4. ~~Interview definition and adaptive flow~~ ✅
5. ~~UI with progressive results and "why?" disclosure~~ ✅
6. ~~Test suite~~ ✅
7. ~~Verify the 3 income tables against sources~~ ✅ (2026-08-21). **Verify the 15 program
   records** ← next, blocks launch
8. Accessibility pass — keyboard traversal, screen reader, 200% zoom
9. Deploy to static hosting
10. Print/share view for taking results to an appointment

## Known gaps

- **The 15 program records are unverified.** Every record carries `lastVerified: null` and
  the app shows a warning banner. The three income tables (FPL, Wisconsin SMI, Dane AMI) were
  verified 2026-08-21 and no longer contribute to the banner, but it stays up until the
  program records are checked too. This blocks public launch; see
  [data-authoring.md](data-authoring.md).
- **No Spanish or Hmong.** Both matter for this audience in Dane County. No i18n framework
  is wired in yet, and retrofitting one will touch every string.
- ~~Income is asked as an annual figure, but WHEAP actually counts a single prior month,
  annualized~~ — **addressed in issue #9.** `recentIncomeDrop` (a boolean, not a recomputed
  dollar figure — see "Recent income" above for why) now keeps `wheap-energy-assistance`,
  `wheap-crisis-assistance`, and `wisconsin-weatherization` from being wrongly ruled out on an
  annual figure that may no longer reflect a household's situation after a recent layoff. What
  remains open: a *numeric* version — parameterising `incomeAtOrBelow`'s fact source so the
  engine could test a household-size-adjusted, prior-month-annualized figure directly instead
  of routing to a manual check — would convert "might qualify, call to check" into a definite
  answer. That needs engine changes (`src/domain/criteria.ts`, `src/engine/evaluate.ts`,
  `src/engine/thresholds.ts`) outside issue #9's scope; filed as #34.
- **Screens are ordered by impact but grouped by hand.** Fine at 15 programs; worth
  revisiting well before 100.
