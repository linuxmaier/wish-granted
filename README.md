# Wish Granted

An interactive interview that helps people find grants and assistance programs they may be
eligible for — City of Madison, Dane County, Wisconsin, and federal.

Answer a few short grouped questions and matching programs surface as you go, with the
reasoning behind every match visible. **Your answers never leave your browser tab.**

> ⚠️ **The program data is not yet verified.** All 15 seed records were drafted from
> secondary knowledge and have not been checked against their official sources. The app
> shows a warning banner until they are. See [docs/data-authoring.md](docs/data-authoring.md).

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 77 unit tests
npm run test:e2e   # 20 browser tests (Chromium, desktop + mobile)
npm run test:all   # both
npm run build      # -> dist/, deployable to any static host
```

Requires Node 20+.

## How it works

Three ideas carry the whole design:

**Nothing is stored anywhere.** No accounts, no server, no `localStorage`, no answers in the
URL, no analytics. The interview and the rules engine run entirely in the browser and the
program dataset is compiled into the bundle. Closing the tab destroys the data.

**Eligibility is three-valued.** Every criterion is `pass`, `fail`, or `unknown`, so the app
can show confirmed matches, "might qualify", and ruled-out from the very first answer,
rather than making people finish a form before seeing anything.

**The interview asks as little as it can.** One answer can settle several facts — "I live in
Madison" implies the county and state, so it is never asked twice — and any question that
can no longer change an outcome is dropped. Someone outside Wisconsin gets a handful of
federal questions instead of the full interview.

Because criteria are data rather than code, every verdict can explain itself: each result
has a "Why this result?" disclosure showing the specific rules that decided it and a link to
the official source.

## Layout

```
src/
  domain/      Facts, the criteria language, the Program schema
  engine/      Three-valued evaluation, matching, income thresholds
  data/
    programs/  One file per program, hand-curated
    reference/ FPL / SMI / AMI income tables
  interview/   Questions, screens, adaptive flow, answer handling
  ui/          React components
tests/
  engine/      Rules engine
  interview/   Simulated interviews
  data/        Dataset <-> interview consistency
  ui/          jsdom smoke test
  e2e/         Whole interviews in real Chromium
docs/
  brief.md            Original scope
  design.md           Architecture decisions and rationale
  data-authoring.md   How to add and verify program records
```

`src/domain` and `src/engine` import nothing from React and can be used independently.

## Contributing program data

Read [docs/data-authoring.md](docs/data-authoring.md) first. The short version: one file per
program, cite the source, and set `lastVerified` only after a human has actually read that
source.

## Disclaimer

Wish Granted is an unofficial guide and **not legal or financial advice**. Eligibility rules
change, funding runs out, and only the agency running a program can tell you whether you
qualify. Always confirm with the source linked on each program.
