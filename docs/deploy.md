# Deploy: CI, Cloudflare Pages, and the post-deploy header check

This is the runbook for issue #15. It covers what's automated (CI, the
scheduled link check) and what's owner action -- Cloudflare project setup,
branch protection, DNS, and the one-time manual header verification -- that
nobody with only repo write access can do, because it needs a Cloudflare
account and DNS control.

See [`design.md`, "Hosting, headers, and log retention"](./design.md) for
*why* Cloudflare Pages and this header set; this file is *how* to stand it
up and keep it gated correctly.

## 1. CI (`.github/workflows/ci.yml`)

Runs on every pull request and every push to `main`. One job, ordered
cheapest-fails-first: typecheck, `npm test` (vitest, 113 tests), the
Node-test-runner suite (`test:refresh-income-tables`, 19 tests -- a
different runner over different tests, kept as its own step so a failure
names which runner broke), build, then the Playwright matrix (`test:e2e`,
66 tests across desktop / Pixel 7 / mobile-360) and finally
`test:e2e:prod` (4 tests, the CSP/header suite against a real production
build). Nothing here needs secrets -- it's all read-only against the repo.

**Full e2e matrix on every PR, not a fast subset.** The mobile-360 project
exists because a real bug -- the mobile summary strip covering the Continue
button -- passed 20/20 on desktop + Pixel 7 and only reproduced at 360px,
which is the practical floor for phones still in real use and exactly the
hardware this audience is disproportionately on. The full matrix costs
under a minute of wall clock; a missed regression here costs someone in a
financial crisis being unable to tap Continue on the device they actually
have. There's no subset to cut that preserves that guarantee -- "desktop +
one mobile size" is the subset that already failed once.

**Why Node is pinned to the 24.x line, not current LTS (22.x).** An npm
script runs `.ts` files directly:

```
"test:lib-source": "node --test \"scripts/lib-source/__tests__/*.test.ts\""
```

That relies on Node's native TypeScript type-stripping, chosen deliberately
so `scripts/` needs zero new dependencies (no `tsx`, no build step). That
behaviour is absent or flag-gated on Node 22; pinning to current LTS would
make `test:lib-source` fail in CI on what looks like a code problem but is
actually a version problem. `.nvmrc` pins `24.19.0` -- the exact version
this was developed and verified against (`node --version` locally,
confirmed 73/73 on `test:lib-source` against it). `actions/setup-node` reads `.nvmrc` directly
(`node-version-file: '.nvmrc'`); the Cloudflare Pages build (below) is set
to the same version via its `NODE_VERSION` build variable. All three
places -- local dev, CI, Cloudflare's builder -- must agree, or a build
that passes CI can still behave differently on Cloudflare's image.

**The `CI` env var hazard.** `playwright.config.ts` sets
`reuseExistingServer: !process.env.CI` -- if `CI` weren't set, a leftover
dev server could make the suite pass against the wrong build. GitHub
Actions sets `CI=true` for every step by default, but the workflow asserts
this explicitly before the e2e steps rather than trusting the default
silently; if it's ever unset, the step fails loudly and names
`reuseExistingServer` as the reason, instead of the e2e suite quietly
passing for the wrong reason.

**Playwright browsers are cached** (`actions/cache`, keyed on
`hashFiles('package-lock.json')`) so a normal run doesn't re-download
Chromium; a `@playwright/test` version bump changes the lockfile hash and
invalidates the cache automatically. `npx playwright install --with-deps
chromium` still runs every time to install/verify system deps and pull the
browser if the cache missed.

**`refresh:income-tables` is not wired into CI.** Issue #6 owns that
script; noting here only what it would require if a future PR schedules
it: **`pdftotext` (Poppler / `poppler-utils`)** on the runner --
`apt-get install -y poppler-utils` on `ubuntu-latest` -- since the Dane AMI
source is PDF-only (see `docs/data-authoring.md`).

## 2. Scheduled link check (`.github/workflows/check-links.yml`)

Weekly (Monday 13:00 UTC) plus manual `workflow_dispatch`. Deliberately
**not** a PR gate -- it hits live agency sites over the network, which
`tests/e2e/personas.spec.ts` explicitly proves the app itself never does,
so this has to live outside that guarantee's blast radius as a separate,
opt-in job.

Runs `npm run check:links -- --strict`. `--strict` was changed (this PR)
to exit non-zero **only on an actually dead link (4xx/5xx/timeout)**, never
on a redirect -- agency sites redirect constantly, and a job that fails
most weeks for a benign 301 is a job everyone learns to ignore, which
defeats the point of having it. Redirects are still printed in the job log
for a human to skim and update the source record if convenient
(`docs/data-authoring.md`); they just don't fail the run. Failure surfaces
via GitHub's default "scheduled workflow failed" notification to the repo
-- no auto-filed issue; that's more automation than this needs right now.

## 3. Cloudflare Pages setup (owner action -- needs your Cloudflare account)

I have no Cloudflare credentials and did not create a project, run
`wrangler login`, or configure anything here. This is a checklist for
whoever has account access.

**Why the native Git integration, not a `wrangler`-in-Actions deploy:**
Cloudflare Pages' dashboard-connected-repo mode builds and deploys on
Cloudflare's own infrastructure with no GitHub Actions secrets at all, and
gives every PR a free preview URL automatically. The alternative
(`wrangler pages deploy` from an Actions workflow) needs a
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` stored as GitHub
secrets -- more to leak, more to rotate, and credentials I'm not able to
create anyway. Use the native integration.

- [ ] **Create the Pages project.** Cloudflare dashboard -> Workers & Pages
      -> Create -> Pages -> Connect to Git -> select `linuxmaier/wish-granted`.
- [ ] **Build settings:**
  - Framework preset: None (Vite isn't in Cloudflare's preset list in a way
    that matches this repo's script names -- set manually)
  - Build command: `npm run build`
  - Build output directory: `dist`
  - Root directory: `/` (repo root)
- [ ] **Environment variable:** add `NODE_VERSION` = `24.19.0` (must match
      `.nvmrc` and the CI workflow -- see the reasoning above). Without
      this, Cloudflare's builder uses its own default Node version, which
      can silently drift from what CI verified.
- [ ] **No other secrets are required.** The app makes zero network calls
      and needs no API keys, tokens, or environment variables beyond
      `NODE_VERSION` -- consistent with the privacy architecture in
      `docs/design.md`.
- [ ] **Production branch:** `main`.
- [ ] **Preview deployments:** on by default for all non-production
      branches/PRs once the project is connected -- this is what satisfies
      the issue's "preview deploy per PR" requirement, with no additional
      workflow file and no secrets in GitHub.
- [ ] **Custom domain:** Workers & Pages -> your project -> Custom domains
      -> Add. If the domain's DNS is already on Cloudflare, this is a
      couple of clicks; otherwise add the CNAME Cloudflare gives you at
      your existing DNS provider. HTTPS is automatic (Cloudflare-managed
      certificate) once the domain is verified.
  - Once the domain is final, revisit the `Strict-Transport-Security`
    header's `preload` question noted in `public/_headers` and
    `docs/design.md` -- deliberately not enabled yet.

### Branch protection (required -- closes a real gap, do this)

**Cloudflare's native Git integration deploys on push to `main`
independent of whether the CI workflow passed.** CI and the Cloudflare
build are two separate systems that both react to the same push; nothing
about connecting the repo makes one wait for the other. Left unconfigured,
a PR that fails the whole suite still deploys the moment it's merged --
unacceptable as a silent default for a tool whose worst failure mode is
telling someone in crisis the wrong thing about their benefits.

The fix is at the merge boundary, not in the workflow file:

- [ ] GitHub repo -> Settings -> Branches -> Add branch protection rule for
      `main`.
- [ ] Enable **"Require status checks to pass before merging"** and select
      the `CI / Test and build` check (from `ci.yml`) as required.
- [ ] Enable **"Require branches to be up to date before merging"** so a
      stale branch can't merge on an outdated green run.
- [ ] Consider also requiring a review approval, if this repo doesn't
      already.

**What this does and doesn't cover.** This gates every merge through the
GitHub UI/API. It does **not** stop a direct push to `main` by someone with
admin override -- branch protection can be configured to include admins,
which is worth turning on if that's a realistic risk for this repo; if not
enabled, an admin bypass still deploys unreviewed, and that residual gap is
worth knowing about rather than assuming away.

### Rollback

Cloudflare Pages keeps every deployment. Rollback is: Workers & Pages ->
your project -> Deployments -> find the last known-good deployment -> "..."
menu -> **Rollback to this deployment**. Sub-minute, no rebuild, no CLI.

- [ ] **Do this once against a throwaway change before relying on it in a
      real incident** -- I can't perform this step myself (no account
      access); it's the one item in this runbook that specifically needs a
      human to click through and confirm the button does what this
      paragraph says, per the issue's "rollback documented and tested
      once" acceptance criterion.

## 4. One-time manual header check (do this once, right after first deploy)

`npm run test:e2e:prod` proves the *browser* enforces the CSP and other
headers in `public/_headers` -- but it serves them through
`tests/e2e/prod-server.mjs`, a small parser we wrote, not Cloudflare's own
`_headers` parser. (We originally tried to close that gap with `wrangler
pages dev`, Cloudflare's own local emulator, but its `workerd` runtime
crash-looped in at least one contributor's environment -- see
`playwright.prod.config.ts`'s docblock. A security test only one machine
can run is worse than a small, checkable, one-time gap.) This checklist
closes that gap against the real, deployed site.

Run once after the first production deploy (and again after any change to
`public/_headers`):

```sh
curl -sI https://<your-domain>/
curl -sI https://<your-domain>/privacy.html
```

For **each** URL, check every header below is present with **exactly**
this value (copy the expected values straight from `public/_headers` if
this file and that one ever disagree -- `public/_headers` is the source of
truth):

- [ ] `content-security-policy` -- full value matches `public/_headers`
      verbatim, in particular `connect-src 'none'` (the centerpiece: this
      app makes zero network calls by design, and this is what turns that
      into something the browser refuses rather than something merely
      true today)
- [ ] `strict-transport-security: max-age=63072000; includeSubDomains`
- [ ] `referrer-policy: no-referrer`
- [ ] `x-content-type-options: nosniff`
- [ ] `permissions-policy` -- matches `public/_headers` (geolocation,
      camera, microphone, payment, usb, interest-cohort all denied)
- [ ] `x-frame-options: DENY`

If any header is missing or differs from `public/_headers`, the likely
cause is Cloudflare's `_headers` parser disagreeing with ours on some
syntax detail (comment handling, path matching, line wrapping) --
Cloudflare's own `_headers` docs are the next place to check, not this
repo's tests, since `test:e2e:prod` already proved the file's *intent* is
correct.

- [ ] Once all boxes above are checked against the live site, this item
      (and issue #15's "headers verified against the live site" acceptance
      criterion) is done. No need to repeat unless `public/_headers`
      changes.
