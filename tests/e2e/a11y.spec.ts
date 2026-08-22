import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Automated accessibility coverage for issue #13, wired into the same e2e
 * suite (and the same three viewport projects) as the persona tests, so a
 * regression fails the build rather than waiting for the next manual pass.
 *
 * Important limits on what this file proves:
 *
 * - axe-core is a dev dependency only, exercised from Playwright against a
 *   running page. It is never imported from `src/`, so it cannot reach the
 *   production bundle -- verified separately by comparing `dist/` output
 *   before and after this package was added (see the PR description).
 * - axe-core catches roughly a third of real accessibility issues by
 *   published estimates. A clean run here is evidence, not proof: it is
 *   deliberately not the whole of issue #13's audit. Everything in this file
 *   is the *automated* slice; the live-region rewrite, the focus-management
 *   change on screen transition, the `.link-button` target-size fix, and the
 *   contrast/reflow/focus-not-obscured checks were all found and verified by
 *   hand (see the PR description and docs/design.md) -- axe does not check
 *   any of those well, if at all, and none of those fixes are re-derived by
 *   this file passing.
 */

async function runAxe(page: Page) {
  return new AxeBuilder({ page })
    // WCAG 2.2 A/AA is this project's stated target.
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
}

function expectClean(results: Awaited<ReturnType<typeof runAxe>>) {
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

test.describe('axe-core: automated WCAG 2.2 AA scan', () => {
  test('the opening screen', async ({ page }) => {
    await page.goto('/');
    expectClean(await runAxe(page));
  });

  // This is also the coverage for issue #11's default state: every program
  // card's details disclosure starts collapsed (see ProgramCard.tsx for why
  // -- measured, not assumed), so a plain mid-interview scan already exercises
  // fifteen collapsed cards across all three buckets without any extra click.
  test('mid-interview, with all three result buckets present', async ({ page }) => {
    await page.goto('/');
    await page.locator('label.choice', { hasText: 'City of Madison' }).first().click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.locator('.number input').first().fill('3');
    expectClean(await runAxe(page));
  });

  // Issue #11: a program card's own details disclosure ("Show details"),
  // independent of and in addition to the "why this result?" disclosure
  // below. Each button's accessible name includes the program name (see
  // ProgramCard.tsx) so this also stands as coverage that axe sees no
  // duplicate/ambiguous accessible names among the many identical-looking
  // buttons a set of results produces.
  test('a program card\'s details disclosure expanded', async ({ page }) => {
    await page.goto('/');
    await page.locator('label.choice', { hasText: 'City of Madison' }).first().click();
    await page.getByRole('button', { name: /^show details/i }).first().click();
    expectClean(await runAxe(page));
  });

  test('a "why this result?" disclosure expanded', async ({ page }) => {
    await page.goto('/');
    await page.locator('label.choice', { hasText: 'City of Madison' }).first().click();
    await page.getByRole('button', { name: /why this result/i }).first().click();
    expectClean(await runAxe(page));
  });

  // Both of a card's disclosures open at once -- a real state (the two are
  // independent controls, per issue #11), and the one most likely to surface
  // any spacing/overlap issue between them.
  test('a card with both its details and "why this result?" disclosures expanded', async ({
    page,
  }) => {
    await page.goto('/');
    await page.locator('label.choice', { hasText: 'City of Madison' }).first().click();
    await page.getByRole('button', { name: /^show details/i }).first().click();
    await page.getByRole('button', { name: /^why this result/i }).first().click();
    expectClean(await runAxe(page));
  });

  test('the ruled-out group expanded', async ({ page }) => {
    await page.goto('/');
    await page.locator('label.choice', { hasText: 'Outside Wisconsin' }).first().click();
    await page.getByRole('button', { name: /show \d+ ruled out/i }).click();
    expectClean(await runAxe(page));
  });

  test('the out-of-scope fallback state', async ({ page }) => {
    await page.goto('/');
    await page.locator('label.choice', { hasText: 'Outside Wisconsin' }).first().click();
    expectClean(await runAxe(page));
  });

  test('the "everything we need to ask" completion screen', async ({ page }) => {
    await page.goto('/');
    await page.locator('label.choice', { hasText: 'Outside Wisconsin' }).first().click();
    for (let i = 0; i < 8; i += 1) {
      const button = page.getByRole('button', { name: 'Continue' });
      if (!(await button.isVisible())) break;
      await button.click();
    }
    await expect(page.getByText(/that is everything we need to ask/i)).toBeVisible();
    expectClean(await runAxe(page));
  });

  // Issue #30's fix (max-height + overflow-y: auto on .interview at desktop
  // widths) makes it a scrollable region for the first time whenever its
  // content overflows a short viewport. Axe's scrollable-region-focusable
  // rule exists for exactly that shape: a scrollable container a
  // keyboard-only user cannot get into. Every state below is confirmed
  // (personas.spec.ts's "layout" describe block) to overflow this viewport,
  // so this isn't a viewport that merely could exercise the rule -- it does.
  test.describe('at a short desktop viewport where .interview scrolls internally', () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 400 });
    });

    test('the opening screen', async ({ page }) => {
      await page.goto('/');
      expectClean(await runAxe(page));
    });

    test('mid-interview, with all three result buckets present', async ({ page }) => {
      await page.goto('/');
      await page.locator('label.choice', { hasText: 'City of Madison' }).first().click();
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.locator('.number input').first().fill('3');
      expectClean(await runAxe(page));
    });

    test('the "everything we need to ask" completion screen', async ({ page }) => {
      await page.goto('/');
      await page.locator('label.choice', { hasText: 'Outside Wisconsin' }).first().click();
      for (let i = 0; i < 8; i += 1) {
        const button = page.getByRole('button', { name: 'Continue' });
        if (!(await button.isVisible())) break;
        await button.click();
      }
      await expect(page.getByText(/that is everything we need to ask/i)).toBeVisible();
      expectClean(await runAxe(page));
    });
  });
});
