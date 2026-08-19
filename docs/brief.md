# Wish Granted — Project Brief

> This is a brief, not a spec. It captures the scope decisions made so far so a future
> design session (human or agent) can pick up the remaining architecture/design work
> without re-deriving context. Nothing below should be treated as final implementation
> detail — see "Open questions" for what's still to be designed.

## Product summary

An interactive interview tool (a website) that helps people discover grants and
assistance programs they may be eligible for. Rather than a search box or a single
long eligibility form, the user answers questions in short, grouped screens; as
answers accumulate, matching programs surface progressively.

## Confirmed scope decisions

- **Geography**: City of Madison → Dane County → Wisconsin → Federal. This is the
  intended v1 audience, chosen as a concrete starting point rather than a national tool.
- **Sources**: Both government and non-government assistance programs should be
  supportable, with government programs as the starting point.
- **v1 categories**: Housing & utilities (rent assistance, energy/heating assistance
  such as WI LIHEAP, eviction prevention) and Food & basic needs (SNAP, WIC, food
  pantries, Madison/Dane County emergency assistance). Other categories — childcare/
  education, health/disability, veterans, small business — are deferred, but the data
  schema should stay extensible enough to add them without a rework.
- **Data approach**: v1 ships with a small hand-curated seed set (roughly 10-15 real
  programs), not live scraping or API integration. The schema should be designed so a
  future ingestion pipeline (e.g. Grants.gov, Benefits.gov/USA.gov, WI DHS, Dane County
  and City of Madison open data, 211 Wisconsin) could populate it later without a
  schema rewrite.
- **Privacy — the hard constraint**: Fully stateless. No user accounts, no
  server-side persistence of anyone's interview answers, ever. This pushes toward a
  client-heavy architecture: the interview and eligibility rules engine should run
  entirely in the browser, with the program dataset shipped as a static bundle. If
  analytics are added later, they must not capture interview answers.
- **Matching approach**: A rules engine over structured eligibility criteria (income
  thresholds, residency/geography, age, household size, employment status, etc.), not
  free-text or LLM-based matching. It should be transparent/explainable — someone
  should be able to see why a program did or didn't match — and testable.
- **Interview UX**: A short dynamic form with grouped screens (e.g. household basics,
  then location, then need-specific questions), adaptively narrowing as answers come
  in. Not a one-question-at-a-time chat flow, and not a single giant form.
- **Intent**: This is meant for real public launch, not a portfolio piece. That means
  data accuracy caveats, source citations, and "verify with the source, this is not
  legal/financial advice" disclaimers matter. At the same time, v1 build scope should
  stay lean and achievable on static hosting rather than becoming an enterprise system.

## Open questions (next design session's job)

These were intentionally left undecided so far — they're the substance of the next
round of design work, not settled facts:

- **Tech stack / framework** — language is implied as TypeScript given the
  client-heavy, stateless design, but framework (e.g. Next.js/React static export,
  SvelteKit, Astro, plain Vite+TS) and hosting target are still open.
- **Eligibility / program data schema** — the actual shape of a "program" record and
  its eligibility criteria (income thresholds relative to household size/FPL,
  residency/geography, age ranges, household size, categories/tags, required
  documents, application links/contact info, source citation + last-verified date,
  and room for future criteria types like disability/veteran/employment status).
- **Rules engine design** — how the client-side engine evaluates a partial set of
  answers against all programs' criteria to bucket them into confirmed-eligible,
  possibly-eligible-pending-more-info, and ruled-out, and how it decides which
  question/screen to surface next to narrow fastest.
- **Concrete v1 screen/question list** — the actual grouped screens and questions
  needed to evaluate the seed set of Housing & Food programs.
- **Project folder structure** — where/how the seed program records are authored
  (e.g. one JSON/YAML file per program vs. one consolidated file) and how the app,
  data, and engine code are organized.
- **Build milestone order** — a concrete ordered list of implementation steps from
  scaffold through deploy.
