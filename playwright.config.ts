import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end config.
 *
 * Kept separate from the Vitest suite deliberately. `npm test` stays fast and
 * runs on every save; this boots a real browser against a real dev server and
 * is the slower gate you run before shipping. The spec files use `.spec.ts` so
 * Vitest (which globs `tests/**\/*.test.ts`) never tries to collect them.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },

  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    // Pixel 7 is 412px wide -- comfortable, and not representative of the
    // low end of Android hardware this audience is disproportionately on.
    // 360px is the practical floor for phones still in real use, and it is
    // the width issue #10 names explicitly. A real bug (the mobile summary
    // strip covering the Continue button, making it unclickable) passed
    // 20/20 on desktop + Pixel 7 and only reproduced here.
    {
      name: 'mobile-360',
      use: { ...devices['Pixel 7'], viewport: { width: 360, height: 640 } },
    },
  ],

  // Reuses a dev server you already have running, and starts one otherwise.
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
