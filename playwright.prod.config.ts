import { defineConfig, devices } from '@playwright/test';

/**
 * Production-build e2e config, for tests/e2e/csp.spec.ts only.
 *
 * `playwright.config.ts` runs against `vite dev`, which never serves
 * `public/_headers` -- so a CSP/header test there would pass or fail for the
 * wrong reason. This boots the actual production build behind
 * tests/e2e/prod-server.mjs, a small static server that parses the real
 * `dist/_headers` file (see that file's docblock for why this isn't
 * `wrangler pages dev`: Cloudflare's own local Pages emulator crash-looped
 * in at least one contributor's environment, which makes a security test
 * that's supposed to be everyone's safety net unusable as one). `npm run
 * build` runs first so the server serves current output, not a stale
 * `dist/`.
 *
 * Known gap: this doesn't confirm Cloudflare's own `_headers` parser agrees
 * with tests/e2e/prod-server.mjs's. That's a one-time, checkable-after-
 * deploy gap, not an ongoing one -- see docs/design.md.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['**/csp.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: 'http://localhost:8788',
    trace: 'on-first-retry',
  },

  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: 'npm run build && node tests/e2e/prod-server.mjs',
    url: 'http://localhost:8788',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
