# Contributing to Wish Granted

Written for anyone picking up work here — human or agent. It lives in the repo on
purpose: an earlier version sat in a scratch directory, got cleared, and a
contributor worked a whole issue without it.

Agents: read [`AGENTS.md`](AGENTS.md) first — it is shorter, and it says where
principles live so you do not have to infer it. This file is the detail.

## The product in one paragraph

An interview that helps low-income people in Madison / Dane County / Wisconsin find
benefits and assistance they may qualify for. Fully static, fully client-side. The
audience is people in or near financial crisis, often on an old phone, on metered
data, sometimes at a library computer, sometimes reading English as a second
language.

## The job has two halves

**Be right about the programs we show, and show enough programs to be worth
opening.** A tool that is impeccably accurate about twenty-one programs has
failed most of the people who open it — and failed them invisibly, because
nobody files a bug for a program they were never shown.

Where the corpus stands today: **20 records** (16 verified), all hand-authored.
A Dane County resident in crisis could plausibly qualify for several times what
we list.

So **"we should add programs" is always an in-scope proposal** — and since the
extraction programme was unwound on 2026-09-08 (#97), it is the main job rather
than an alternative to one. A record is about ninety lines and the procedure is
written down ([docs/data-authoring.md](docs/data-authoring.md)). A program whose
eligibility nobody publishes is still worth adding — see
`the-river-food-pantry.ts` and `wi-211.ts`.

## Hard constraints

Do not violate these without agreement first. These are the product's promises;
they do not move.

Everything *else* that reads like a rule around here — which facts we ask, which
categories are in scope, which sources we fetch, how the two failure directions
are ranked — is a standing decision with a revisit condition, recorded in
[`docs/standing-decisions.md`](docs/standing-decisions.md). **That file is the
only place design principles are argued.** Read it before concluding something is
out of bounds; code comments and mechanism docs state rules and link there, and
should not be carrying the reasoning themselves.

1. **No answers ever leave the browser.** No network calls at runtime, no
   `localStorage` / `sessionStorage` / cookies / IndexedDB, no answers in the URL, no
   analytics, no router. The stronger form: *what the client requests must not depend
   on the user's answers.* This is enforced at three levels — two e2e tests assert
   zero network requests and zero storage writes, and `public/_headers` ships
   `connect-src 'none'` so the browser refuses regardless.
2. **Never invent data.** Program details, income limits, dollar figures, phone
   numbers, URLs and eligibility rules come from a source you actually fetched. If you
   cannot fetch it, say so and leave the field unverified. A plausible wrong number in
   a benefits tool does damage a missing one does not.
3. **`lastVerified` means a person checked the source on that date**, and anything
   left unconfirmed is named in the record's comment. See `docs/data-authoring.md`.
   Never write a date you did not earn.
4. **When a rule is genuinely uncertain, leave it `unknown`** — it lands in "might
   qualify" — rather than guessing `fail` or `pass`.

   Of the two ways to be wrong, telling someone they qualify when they do not is
   worse: they spend a morning and a bus fare on an application that was never going
   to work, and they stop trusting the next thing we tell them. But telling someone
   they are ruled out when they are not is also a real harm, not a safe default — it
   is help they never hear about. Neither is infinitely worse than the other.

   **This ranking only applies when choosing between `eligible` and `ruledOut`.** It
   does *not* apply to whether a program belongs in the dataset at all: a record that
   abstains cannot tell anyone they qualify, so leaving programs out buys no safety
   and costs reach. See [`docs/standing-decisions.md`](docs/standing-decisions.md),
   "The two harms".
5. **No new runtime dependencies** without agreement. Dev dependencies still get
   flagged. A CDN font would violate both the privacy guarantee and the CSP.

## Commands

```
npm test                        # vitest, 153 tests
npm run test:refresh-income-tables   # Node's own runner, 19 tests (different runner)
npm run test:e2e                # Playwright, 81 tests, 3 viewports
npm run test:e2e:prod           # Playwright vs the production build + headers, 4 tests
npm run typecheck
npm run build                   # runs build:snapshot -- --check first, then tsc + vite
npm run build:snapshot          # regenerate src/data/programs/snapshot.json from records.ts
npm run build:snapshot -- --measure   # print the per-record size budget
npm run check:links             # opt-in; --strict fails on dead links, never redirects
```

A PR must leave typecheck, `npm test` and `build` green. Run the e2e suites too if you
touched `src/ui/`, `src/interview/`, or anything the production build serves.

## Environment (Windows)

The Bash tool's PATH is missing node and gh:

```
export PATH="$PATH:/c/Program Files/nodejs:/c/Program Files/GitHub CLI"
```

## Dev server ports — read this before running anything

Several worktrees run in parallel and Vite defaults to 5173 in every one. Two failure
modes follow, and both have cost real time here:

1. Vite finds 5173 busy and silently moves to 5174/5175. Your script then talks to
   another worktree's build.
2. `playwright.config.ts` sets `reuseExistingServer: !process.env.CI`. A leftover
   server means your suite can **pass green against somebody else's branch**.

So: pin your port (`npx vite --port 52XX --strict-port`), never edit the shared
Playwright config for your own run — copy it to a local uncommitted
`*.local.config.ts` (gitignored) and pass `--config` — and stop any server you start.
If a port is unexpectedly busy, find out what is on it rather than moving along.

## Architecture

- `src/domain/` — fact vocabulary, the criteria expression language, the `Program`
  record shape. Framework-free.
- `src/data/programs/` — one hand-authored record per file, aggregated by `records.ts`.
  The app loads the compiled `snapshot.json` (built by `npm run build:snapshot`), not the
  records directly — see `docs/design.md`, "The shippable snapshot". Edit a record →
  regenerate → commit both.
- `src/engine/` — three-valued (Kleene) evaluation. Every criterion is `pass` / `fail`
  / `unknown`; the three result buckets fall out of that logic. Criteria are **data,
  not functions**, so the engine walks the evaluated tree to generate explanations.
- `src/interview/` — screens plus an adaptive flow that ranks questions by how many
  undecided programs they would resolve and drops questions that cannot change an
  outcome. Invariant, enforced by test: **exactly one question writes each fact.**
- `src/ui/` — React 19. `useInterview.ts` is the only place answers are held.
- `scripts/` — build-time tools. Never shipped. No shebangs (see below).
- `docs/design.md` is the rationale and is expected to stay true. If your change makes
  a sentence there false, fix the sentence in the same PR.

## Working agreement

1. **Propose a plan before writing code.** Cover what you'll change file by file, what
   you'll test, what you found that contradicts the issue's assumptions, and any
   decision you want ruled on. A plan revealing that the issue is misspecified is a
   cheap and welcome outcome.
2. **Report honestly.** If a test fails, show the output. If you skipped scope, say
   which and why. Never describe work as done that isn't.
3. **Fix the data first and the test second, never the reverse.** If corrected data
   breaks a test, work out whether the test's *intent* still holds — then fix it and
   say so.
4. **Make sure your test can fail.** Before claiming a regression test works, break the
   thing it guards and watch it fail. This project has shipped seven tests that looked
   like they guaranteed a user-facing property while asserting something weaker.

## Things that have bitten us

- **No shebangs in `scripts/`.** Vite does not strip `#!` when a test imports a module,
  so it becomes an invalid token — and only on a cold transform cache, so it passes
  locally and breaks elsewhere. A guard test enforces this.
- **A recursive schema cannot be enforced by strict structured output.** A
  `Criterion` is a recursive expression language, which exceeds the API's
  grammar-compilation limits, so `strict: true` cannot be used for it. Measured
  in #5 §4.5 and recorded in the Facts table of
  [`docs/standing-decisions.md`](docs/standing-decisions.md); the code that
  demonstrated it was deleted in the unwind.
- **Search snippets lie.** A snippet gave Wisconsin Shares' income threshold as 185%
  FPL; the real page says 200%. Fetch the primary source.
- **Redirects:** record the destination, never the redirector.

## Commits and PRs

- Imperative subject, blank line, then *why* rather than *what*.
- End commit messages with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- End PR bodies with:
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
