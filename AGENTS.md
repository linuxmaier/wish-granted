# AGENTS.md

Read this first, then [`CONTRIBUTING.md`](CONTRIBUTING.md) before writing code.

This file is an orientation and a routing table. It states the few things that
govern every decision here and tells you where everything else lives. **It
deliberately does not restate what it links to** — duplicated principles drifting
apart is the specific failure this project has already paid for.

---

## What this is

An interview that helps low-income people in Madison / Dane County / Wisconsin
find benefits and assistance they may qualify for. Static, client-side, no
server. The audience is people in or near financial crisis — often on an old
phone, on metered data, sometimes at a library computer, sometimes reading
English as a second language.

It is meant for real public launch. Someone will act on what this app tells them.

## The two things that decide most questions

**1. Be right about the programs we show.** Sending someone to an office, an
application, and a rejection costs them a morning, a bus fare, and their trust —
and the trust is what pays for every later suggestion we make.

**2. Show enough programs to be worth opening.** A tool that is impeccably
accurate about twenty-one programs has failed most of the people who open it, and
failed them invisibly: nobody files a bug for a program they were never shown.

These pull against each other and **both are the job**. When they genuinely
conflict, #1 wins — but not infinitely, and the ranking is narrower than it
looks: the app has a third bucket, and "might qualify" is not a wrong answer in
either direction. Read [`docs/standing-decisions.md`](docs/standing-decisions.md),
"The two harms", before invoking either of these in an argument.

Where the corpus stands: **20 records, 16 verified, all hand-authored.** There is
no extraction pipeline — the one built through 2026 was unwound on 2026-09-08
(#97), and widening the corpus by hand is the current route to reach. "We should
add programs" is always in scope; it is presently the main job.

The corpus-widening research (#100) has produced **60 unverified candidate
records** in `research/corpus/` and an analysis in `research/corpus/FINDINGS.md`
— counts on what rule shapes actually occur, what the fact vocabulary needs, and
how often a figure is separated from its governing scope. Candidates are **not
shipped**; promoting one is a separate human pass. `research/corpus/PROCEDURE.md`
is the capture method and `research/corpus/analysis/` the scripts behind the
numbers (both temporary — deleted when #100 closes).

**What the interview has to ask to serve that corpus is planned in
[`docs/interview-roadmap.md`](docs/interview-roadmap.md).** The headline: with
the questions the app asked before that plan, 76% of those 60 candidates would
say "might qualify" to everyone. One new question and a longer age-band list
take that to 43%. Read it before adding a fact or a question.

The first three candidates have been promoted — the `veterans` category now
ships, and the `veteranConnection` question with it. Promoting a candidate is
*not* the same as verifying it: all three carry `lastVerified: null` and a
comment naming what an agent confirmed against a fetched source and what it
could not. A human still has to read the sources.

## Where principles live, and where new ones go

One rule: **a principle is stated once, and everywhere else links to it.**

| Where | Carries | Never carries |
|---|---|---|
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | The product's promises, plus how to work here | Anything with a revisit condition |
| [`docs/standing-decisions.md`](docs/standing-decisions.md) | **Every design principle and judgment**: the statement, the reason, the reopen condition, the glossary, and what has changed | Mechanism |
| `docs/design.md`, `docs/data-authoring.md`, `docs/interview-roadmap.md`, `docs/pipeline-principles.md`, … | How a thing works, and how to use it | The *argument* for a principle |
| Code and tests | The rule, in one line, with a link | Justification, history, or a retelling of why |
| Git history and GitHub issues | The full argument at the time | — |
| Issues labelled `superseded`, and `docs/archive/` | A dated record of retired work | **Anything current.** Not a source of reasoning — see below |

**Writing a new principle?** It goes in `docs/standing-decisions.md`, in the
standing-decisions table, **with a named condition under which it should be
reopened.** A judgment with no reopen condition is not finished being written.

**About to explain in a code comment *why* a rule exists?** The explanation
belongs in `standing-decisions.md`; the comment belongs at one line with a link.

**Reading an issue labelled `superseded`, or a document under `docs/archive/`?**
Those are the record of the eligibility-extraction programme, unwound on
2026-09-08. They are history, **not a source of current reasoning**: nothing in
them is a constraint, a requirement, or an established fact about what is
possible. Measurements that survived are hoisted into this file's routing targets
— `standing-decisions.md` and `docs/pipeline-principles.md`. Start there. #97 has
the verdict and the findings that stand.

## How work goes wrong here

These are the actual failure patterns this project has hit, not hypotheticals.
Watch for yourself doing them.

- **Treating a judgment as a fact.** Issue bodies carry lists headed *"not up for
  re-litigation"* that mix measured facts with somebody's reasonable call. Read as
  one undifferentiated block, they stop you considering options that would help.
  `standing-decisions.md` splits them; check there before concluding something is
  out of bounds.
- **Circular scope reasoning.** "We can't ask that fact because no rule needs it,
  and no rule can need it because we don't ask it." This kept a whole class of
  senior programs unreachable for months (#88). If a constraint's justification
  depends on the constraint, say so out loud.
- **Caution that reads as safety but costs reach.** Anything that abstains on
  everything has zero wrong answers and is worth nothing. A measure of correctness
  has to count *decidable* answers, not the presence of an answer — see
  `standing-decisions.md`. Nothing enforces this in code today; your reasoning has
  to.
- **Correcting a document by appending.** If the top of a doc or an issue argues
  something a later paragraph retracts, readers get the retracted version. Fix the
  claim where it is made, and record the change in one place.
- **The same word meaning two things.** "Over-claim" did, for months, and it cost
  four architectures designed against a scoreboard that measured the wrong
  direction. Say the direction in the sentence: *"tells someone they qualify when
  they do not."* The same trap is live for `branch`, `rule`, `source` and
  `program`, each of which names one thing in a source and a different thing in
  our encoding of it. **"The words" in `standing-decisions.md` defines them; add
  to it when you coin one.**

## Non-negotiables (details in CONTRIBUTING.md)

1. **No answers ever leave the browser.** No runtime network calls, no storage, no
   analytics, no answers in the URL. Enforced by e2e tests and CSP.
2. **Never invent data.** Every figure, phone number, URL and rule comes from a
   source you actually fetched. Search snippets lie — fetch the primary source.
3. **`lastVerified` means a person read the source on that date.** Anything not
   freshly confirmed is named in the record's comment.
4. **When a rule is genuinely uncertain, leave it `unknown`.** It lands in "might
   qualify", which is the honest answer.
5. **No new runtime dependencies** without agreement.
6. **Never auto-merge an eligibility change.** A pipeline proposes; a human
   disposes.

## Orientation

```
src/domain/     fact vocabulary, criteria language, Program shape (framework-free)
src/engine/     three-valued (Kleene) evaluation; criteria are data, not functions
src/interview/  screens + adaptive flow; exactly one question writes each fact
src/data/       hand-authored program records, compiled to snapshot.json
src/ui/         React 19; useInterview.ts is the only place answers are held
scripts/        two directories only: build-snapshot (ships the app) and
                lib-source (source-access tools, no consumer — see its README)
```

Read `docs/design.md` for the architecture and its rationale. It is expected to
stay true — if your change makes a sentence there false, fix the sentence in the
same PR.

## Before you start

- **Propose a plan first.** File by file, what you'll test, and anything you found
  that contradicts the issue's assumptions. Discovering the issue is misspecified
  is a cheap and welcome outcome.
- **Pin your dev server port.** Multiple worktrees run in parallel and Vite will
  silently take another port, so your tests can pass green against someone else's
  branch. See CONTRIBUTING.md, "Dev server ports".
- **Make sure your test can fail.** Break the thing it guards and watch it fail.
  This project has shipped tests that looked like they guaranteed a user-facing
  property while asserting something weaker.
- **Report honestly.** If a test fails, show the output. If you skipped scope, say
  which and why.

## Commands

```
npm test                     # 120 unit tests (vitest)
npm run typecheck
npm run build                # regenerates + checks snapshot, then tsc + vite
npm run test:e2e             # Playwright, 3 viewports
npm run build:snapshot       # after editing any program record — commit both
npm run test:lib-source      # 73 tests (Node's runner, not vitest)
```

Two runners, deliberately separate: `npm test` is vitest over the app;
`test:lib-source` is Node's built-in runner over `scripts/lib-source`. A failure
should say which one broke. `npm run test:all` runs vitest plus Playwright.

**Windows:** the Bash tool's PATH lacks node and gh —
`export PATH="$PATH:/c/Program Files/nodejs:/c/Program Files/GitHub CLI"`.
