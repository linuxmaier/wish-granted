import { defineConfig, devices } from '@playwright/test';

/**
 * Production-build e2e config, for tests/e2e/csp.spec.ts only.
 *
 * `playwright.config.ts` runs against `vite dev`, which never serves
 * `public/_headers` -- so a CSP/header test there would pass or fail for the
 * wrong reason. This boots the actual production build behind Cloudflare's
 * own local Pages emulator (`wrangler pages dev`), which applies `_headers`
 * (and `_redirects`) the same way the real deployment does. That was chosen
 * over hand-rolling a static server that reads `_headers`, because the thing
 * worth testing is Cloudflare's header semantics, not a parser of our own
 * that could quietly drift from them.
 *
 * `wrangler pages dev` was verified (2026-08) to start in ~4s with no login
 * prompt and no CLOUDFLARE_API_TOKEN/account ID required for local static
 * serving -- safe to run in CI. `npm run build` runs first so the emulator
 * serves current output, not a stale `dist/`.
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
    command:
      'npm run build && npx wrangler pages dev dist --port=8788 --compatibility-date=2026-08-18',
    url: 'http://localhost:8788',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
