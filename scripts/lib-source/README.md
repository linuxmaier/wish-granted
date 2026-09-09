# `scripts/lib-source` — source-access tools

Ways to reach a program's source page and read what it says: fetch politely,
render a JS/WebForms shell into real text, preserve table structure, read a
linked PDF, search within a site, recover a moved URL, normalise a page to its
meaningful text, and talk to the Anthropic API.

**Nothing in this repo consumes it.** It exists for corpus research — a person
or a model gathering program records needs to reach real sources — and it is
deliberately free of any assumption about a pipeline.

## What this is not

It is **not** the surviving half of the extraction pipeline, and its existence
is **not** a decision about what a future pipeline should look like. That
programme was unwound on 2026-09-08; see #97 and
[`docs/pipeline-principles.md`](../../docs/pipeline-principles.md). Tools that
encoded a design bet — constraining extraction to the interview's current fact
vocabulary, requiring a verbatim provenance span, the agent loop itself — were
deleted with it, on purpose.

## Rules that still apply

- **Never invent data** ([`CONTRIBUTING.md`](../../CONTRIBUTING.md)). These tools
  fetch; they do not guess.
- **Never report a number you did not measure.** `anthropic-client.ts` throws
  `MissingApiKeyError` when `ANTHROPIC_API_KEY` is absent so a caller reports
  SKIPPED rather than fabricating a result.
- Respect `robots.txt` (`robots.ts`). A 403 from a WI state site to a naive
  fetcher is not a crawl prohibition — see the Facts table in
  [`standing-decisions.md`](../../docs/standing-decisions.md).

```
npm run test:lib-source
npm run typecheck:lib-source
```
