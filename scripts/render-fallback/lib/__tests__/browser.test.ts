import { test } from 'node:test';
import assert from 'node:assert/strict';

import { playwrightRenderer } from '../browser.ts';

/**
 * These do NOT require a browser binary: the robots gate is checked before
 * Playwright is ever loaded, and an unavailable browser is a returned
 * `{ ok: false }`, never a throw. The real Chromium wiring is exercised
 * separately by `npm run render-fallback:browser-check` (which skips cleanly
 * when the binary is absent).
 */

test('a hard-deny host is refused before any browser work (live gate, no network)', async () => {
  // findhelp.org is in HARD_DENY_HOSTS -- the live gate rejects it synchronously,
  // before robots.txt is fetched or a browser is launched.
  const outcome = await playwrightRenderer().render('https://www.findhelp.org/anything');
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.match(outcome.reason, /hard-deny/);
});

test('an injected robots gate that disallows the path blocks the render', async () => {
  const r = playwrightRenderer({
    robotsGate: async () => ({ allowed: false, reason: 'robots.txt disallows /private' }),
  });
  const outcome = await r.render('https://example.gov/private/page');
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.match(outcome.reason, /blocked: robots\.txt disallows/);
});

test('an invalid URL is rejected by the gate, not thrown', async () => {
  const outcome = await playwrightRenderer().render('not-a-url');
  assert.equal(outcome.ok, false);
});

test('render() never throws even when Playwright/Chromium is missing', async () => {
  // Allowed by the gate, so this proceeds to the browser step. Whether or not a
  // binary is installed, the result is a value, not an exception.
  const r = playwrightRenderer({
    robotsGate: async () => ({ allowed: true, reason: 'ok' }),
    timeoutMs: 5_000,
  });
  const outcome = await r.render('https://example.test/never-navigated');
  assert.ok(typeof outcome.ok === 'boolean');
});
