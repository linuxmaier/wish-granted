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

### What v1 does not ask

`citizenshipStatus`, `employmentStatus`, and `age` are declared in the fact vocabulary but
no v1 rule consults them, so asking would be pure friction — and `flow.ts` would score them
zero and never show them anyway.

Immigration status is the pointed case. It genuinely affects federal food benefits, but the
rules are full of exceptions — children frequently qualify when adults do not — and an
engine that got them slightly wrong would tell a family they are ineligible when they are
not. That is the worst error this app can make. v1 declines to encode it; affected programs
carry a plain-language caveat and stay in "might qualify".

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
- **Income is asked as an annual figure**, but WHEAP actually counts a single prior month,
  annualized (×12) — not the "last three months" this note previously (and incorrectly)
  claimed. Per the WHEAP PY26 Manual: "The HE+ Program uses a prior month income test which
  is annualized to determine program income eligibility." This cuts the other way from what
  was assumed here: a one-month test is *more* forgiving to someone recently laid off than
  our annual-income question implies, since only their now-lower most recent month counts,
  not an average that still includes higher pre-layoff earnings. The model should eventually
  carry a recent-income fact so the interview can ask what WHEAP actually asks, rather than
  approximating it with a full-year figure.
- **Screens are ordered by impact but grouped by hand.** Fine at 15 programs; worth
  revisiting well before 100.
