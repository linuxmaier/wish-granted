# Contributing to Wish Granted

Written for anyone picking up work here — human or agent. It lives in the repo on
purpose: an earlier version sat in a scratch directory, got cleared, and a
contributor worked a whole issue without it.

## The product in one paragraph

An interview that helps low-income people in Madison / Dane County / Wisconsin find
benefits and assistance they may qualify for. Fully static, fully client-side. The
audience is people in or near financial crisis, often on an old phone, on metered
data, sometimes at a library computer, sometimes reading English as a second
language.

## Hard constraints

Do not violate these without agreement first.

1. **No answers ever leave the browser.** No network calls at runtime, no
   `localStorage` / `sessionStorage` / cookies / IndexedDB, no answers in the URL, no
   analytics, no router. The stronger form: *what the client requests must not depend
   on the user's answers.* This is enforced at three levels — two e2e tests assert
   zero network requests and zero storage writes, and `public/_headers` ships
   `connect-src 'none'` so the browser refuses regardless.
2. **Never invent data.** Program details, income limits, dollar figures, phone
   numbers, URLs and eligibility rules come from a source you actually fetched. If you
   cannot fetch it, say so and leave the field unverified. A plausible wrong number in
   a benefits tool is the worst failure this project has.
3. **`lastVerified` means a person checked the source on that date**, and anything
   left unconfirmed is named in the record's comment. See `docs/data-authoring.md`.
   Never write a date you did not earn.
4. **Telling someone they are ineligible when they are not is the worst engine
   error.** When a rule is genuinely uncertain, leave it `unknown` — it lands in
   "might qualify" — rather than guessing `fail`. Under-claim, always.
5. **No new runtime dependencies** without agreement. Dev dependencies still get
   flagged. A CDN font would violate both the privacy guarantee and the CSP.

## Commands

```
npm test                        # vitest, 120 tests
npm run test:refresh-income-tables   # Node's own runner, 19 tests (different runner)
npm run test:e2e                # Playwright, 81 tests, 3 viewports
npm run test:e2e:prod           # Playwright vs the production build + headers, 4 tests
npm run typecheck
npm run build
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
- **A recursive schema cannot be enforced by strict structured output.** See
  `scripts/llm-extraction/criterion-schema.ts`.
- **Search snippets lie.** A snippet gave Wisconsin Shares' income threshold as 185%
  FPL; the real page says 200%. Fetch the primary source.
- **Redirects:** record the destination, never the redirector.

## Commits and PRs

- Imperative subject, blank line, then *why* rather than *what*.
- End commit messages with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- End PR bodies with:
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
