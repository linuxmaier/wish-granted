import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Verifies the CSP and other security headers in `public/_headers` are real
 * -- run against the production build via `npm run test:e2e:prod` (see
 * playwright.prod.config.ts for why a separate config exists). A header
 * nobody tests is a header that silently rots.
 *
 * `tests/e2e/personas.spec.ts` already proves the app *doesn't* make network
 * requests. This file proves the browser would *refuse* one even if a future
 * change tried -- the stronger, enforced version of the same guarantee.
 */

const EXPECTED_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; " +
  "font-src 'self'; connect-src 'none'; frame-src 'none'; object-src 'none'; " +
  "base-uri 'none'; form-action 'none'; frame-ancestors 'none'; manifest-src 'none'; " +
  "worker-src 'none'; upgrade-insecure-requests";

/** Loosely walks the interview by picking the first available answer to
 * each visible question, without asserting on the results -- this test only
 * cares whether normal interaction trips a CSP violation. */
async function clickThroughInterview(page: Page, maxScreens = 12) {
  for (let i = 0; i < maxScreens; i += 1) {
    if (await page.getByText(/that is everything we need to ask/i).isVisible()) return;

    const fieldsets = page.locator('fieldset.question');
    const count = await fieldsets.count();
    if (count === 0) break;

    for (let f = 0; f < count; f += 1) {
      const fieldset = fieldsets.nth(f);
      const numberInput = fieldset.locator('input[type=number]');
      const noneButton = fieldset.locator('button.choice--none');
      const choice = fieldset.locator('label.choice').first();

      if (await numberInput.count()) await numberInput.fill('2');
      else if (await choice.count()) await choice.click();
      else if (await noneButton.count()) await noneButton.click();
    }

    const continueButton = page.getByRole('button', { name: 'Continue' });
    if (!(await continueButton.isVisible())) break;
    await continueButton.click();
  }
}

test.describe('CSP headers (production build)', () => {
  test('the document response carries the expected security headers', async ({
    page,
  }) => {
    const response = await page.goto('/');
    const headers = response!.headers();

    expect(headers['content-security-policy']).toBe(EXPECTED_CSP);
    expect(headers['strict-transport-security']).toBe('max-age=63072000; includeSubDomains');
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['permissions-policy']).toBe(
      "geolocation=(), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()",
    );
  });

  test('/privacy.html carries the same headers', async ({ page }) => {
    const response = await page.goto('/privacy.html');
    expect(response!.headers()['content-security-policy']).toBe(EXPECTED_CSP);
  });

  test('produces no CSP violation while the interview is answered', async ({ page }) => {
    await page.goto('/');
    const violations: string[] = [];
    await page.exposeFunction('__reportViolation', (v: string) => violations.push(v));
    await page.evaluate(() => {
      document.addEventListener('securitypolicyviolation', (e) => {
        // @ts-expect-error -- exposed by the test harness above
        window.__reportViolation(`${e.violatedDirective}: ${e.blockedURI}`);
      });
    });

    await clickThroughInterview(page);

    expect(violations, `unexpected CSP violations: ${violations.join(', ')}`).toHaveLength(0);
  });

  test('blocks an injected external request instead of allowing it through', async ({
    page,
  }) => {
    await page.goto('/');

    const seenRequests: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('example.com')) seenRequests.push(r.url());
    });

    const violation = await page.evaluate(async () => {
      // The securitypolicyviolation event fires asynchronously, after the
      // fetch() rejection's microtask -- racing it against a fixed-order
      // "await fetch(); then read a variable" sequence is what made this
      // flaky. Wait on the event itself instead, with a timeout fallback.
      const violationPromise = new Promise<string>((resolve) => {
        document.addEventListener(
          'securitypolicyviolation',
          (e) => resolve(`${e.violatedDirective}: ${e.blockedURI}`),
          { once: true },
        );
        setTimeout(() => resolve(''), 2000);
      });

      // connect-src 'none' should block this before any network attempt.
      fetch('https://example.com/leak').catch(() => {
        // Expected: CSP makes fetch() reject. The assertion is on the
        // violation event and on Playwright never observing the request.
      });

      return violationPromise;
    });

    expect(violation).toContain('connect-src');
    expect(seenRequests, 'the blocked request should never reach the network').toHaveLength(0);
  });
});
