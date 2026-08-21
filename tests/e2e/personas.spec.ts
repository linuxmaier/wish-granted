import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Whole-interview tests through a real browser.
 *
 * These exist because the unit suite cannot see certain failures. The 211
 * Wisconsin bug is the motivating example: `matchAll` was behaving exactly as
 * written, every unit test passed, and the interview still ended by telling an
 * out-of-state user they qualified for a Wisconsin-only service. It took
 * walking a persona end to end to notice — and the "results are never empty"
 * assertion in the unit suite was passing *because* of the bug.
 *
 * So each persona here is a claim about what a real person should see, not
 * about what a function should return.
 */

type Action =
  | { radio: string }
  | { num: number }
  | { check: string[] }
  | { none: true };

/** Maps a question prompt (substring) to how this persona answers it. */
type Persona = Record<string, Action>;

const CRISIS_FAMILY: Persona = {
  'Where do you live': { radio: 'City of Madison' },
  'How many people': { num: 3 },
  'household income': { num: 18_000 },
  'Does your household include': { check: ['A child under 5', 'A school-age child'] },
  'best describes your housing': { radio: 'Renting' },
  'Is any of this happening': {
    check: ['Behind on rent', 'A utility shutoff notice', 'I pay a heating'],
  },
  'already receive any of these': { none: true },
};

const WELL_OFF_MADISON: Persona = {
  'Where do you live': { radio: 'City of Madison' },
  'How many people': { num: 2 },
  'household income': { num: 250_000 },
  'Does your household include': { none: true },
  'best describes your housing': { radio: 'I own my home' },
  'Is any of this happening': { check: ['I pay a heating'] },
  'already receive any of these': { none: true },
};

/** Answers whatever question is on screen, then advances. Returns when done. */
async function runInterview(page: Page, persona: Persona, maxScreens = 12) {
  for (let i = 0; i < maxScreens; i += 1) {
    if (await page.getByText(/that is everything we need to ask/i).isVisible()) return;

    const fieldsets = page.locator('fieldset.question');
    for (let f = 0; f < (await fieldsets.count()); f += 1) {
      const fieldset = fieldsets.nth(f);
      const prompt = (await fieldset.locator('legend').textContent()) ?? '';
      const key = Object.keys(persona).find((k) => prompt.includes(k));
      if (!key) continue;

      const action = persona[key]!;
      if ('num' in action) {
        await fieldset.locator('input[type=number]').fill(String(action.num));
      } else if ('none' in action) {
        await fieldset.locator('button.choice--none').click();
      } else if ('radio' in action) {
        await fieldset.locator('label.choice', { hasText: action.radio }).first().click();
      } else {
        for (const label of action.check) {
          const box = fieldset.locator('label.choice', { hasText: label }).first();
          if (await box.count()) await box.click();
        }
      }
    }

    await page.getByRole('button', { name: 'Continue' }).click();
  }
}

const results = (page: Page) => page.getByRole('region', { name: /matches so far|your results/i });

/** Program names in a given results bucket. */
async function bucket(page: Page, heading: RegExp): Promise<string[]> {
  const group = page.locator('.results__group').filter({ has: page.locator('h3', { hasText: heading }) });
  if (!(await group.count())) return [];
  return group.first().locator('.program__name').allTextContents();
}

test.describe('the interview end to end', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('a family in crisis sees the emergency programs', async ({ page }) => {
    await runInterview(page, CRISIS_FAMILY);

    const eligible = await bucket(page, /likely a match/i);
    for (const expected of [
      'FoodShare Wisconsin (SNAP)',
      'Wisconsin WIC',
      'WHEAP Crisis Assistance and Emergency Furnace Repair',
    ]) {
      expect(eligible, `expected ${expected} for a household in crisis`).toContain(expected);
    }

    // Eviction Prevention and Rent Assistance carries a `manualReview` leaf
    // (its income threshold could not be sourced from a current, citizen-facing
    // page -- see dane-eviction-prevention.ts) so it can never resolve to a
    // full match; it should still surface as a lead in "might qualify" rather
    // than being dropped or wrongly promised.
    const maybe = await bucket(page, /might qualify/i);
    expect(maybe).toContain('Eviction Prevention and Rent Assistance');
  });

  test('someone well off still gets the county-only options', async ({ page }) => {
    await runInterview(page, WELL_OFF_MADISON);

    const eligible = await bucket(page, /likely a match/i);
    expect(eligible).not.toContain('FoodShare Wisconsin (SNAP)');
    // The River Food Pantry's `eligibility` is Dane County residency only, so
    // nobody in the county leaves empty-handed. (The River does ask people to
    // self-attest to a TEFAP income guideline for groceries in practice --
    // see eligibilityCaveats on the record -- but that is not enforced by
    // this engine, deliberately, since it does not apply to all of their
    // services and a false "ruled out" is the worse failure here.)
    expect(eligible).toContain('The River Food Pantry');
  });

  test('enrolling in SSI overrides the income test', async ({ page }) => {
    await runInterview(page, { ...WELL_OFF_MADISON, 'already receive any of these': { check: ['SSI'] } });

    const eligible = await bucket(page, /likely a match/i);
    expect(eligible).toContain('FoodShare Wisconsin (SNAP)');
  });

  test('the interview is shorter out of state', async ({ page }) => {
    let localScreens = 0;
    await page.goto('/');
    // Count screens for a Wisconsin resident.
    for (let i = 0; i < 12; i += 1) {
      if (await page.getByText(/that is everything/i).isVisible()) break;
      localScreens += 1;
      await runOneScreen(page, CRISIS_FAMILY);
    }

    await page.goto('/');
    let awayScreens = 0;
    const away: Persona = { ...CRISIS_FAMILY, 'Where do you live': { radio: 'Outside Wisconsin' } };
    for (let i = 0; i < 12; i += 1) {
      if (await page.getByText(/that is everything/i).isVisible()) break;
      awayScreens += 1;
      await runOneScreen(page, away);
    }

    expect(awayScreens).toBeLessThan(localScreens);
  });
});

/** One screen's worth of answering, factored out for the length comparison. */
async function runOneScreen(page: Page, persona: Persona) {
  const fieldsets = page.locator('fieldset.question');
  for (let f = 0; f < (await fieldsets.count()); f += 1) {
    const fieldset = fieldsets.nth(f);
    const prompt = (await fieldset.locator('legend').textContent()) ?? '';
    const key = Object.keys(persona).find((k) => prompt.includes(k));
    if (!key) continue;
    const action = persona[key]!;
    if ('num' in action) await fieldset.locator('input[type=number]').fill(String(action.num));
    else if ('none' in action) await fieldset.locator('button.choice--none').click();
    else if ('radio' in action)
      await fieldset.locator('label.choice', { hasText: action.radio }).first().click();
    else
      for (const label of action.check) {
        const box = fieldset.locator('label.choice', { hasText: label }).first();
        if (await box.count()) await box.click();
      }
  }
  await page.getByRole('button', { name: 'Continue' }).click();
}

test.describe('honest empty states', () => {
  test('tells an out-of-state user this tool does not cover them', async ({ page }) => {
    await page.goto('/');
    await page.locator('label.choice', { hasText: 'Outside Wisconsin' }).first().click();

    await expect(results(page).getByText(/only covers Wisconsin/i)).toBeVisible();
    // And points somewhere genuinely useful instead. Note this asserts our own
    // link renders, NOT that the destination is live -- a network assertion
    // cannot live here, because two tests in this file guarantee the interview
    // makes *zero* network requests, and that guarantee is worth more than
    // link checking. Liveness is `npm run check:links` instead.
    await expect(
      results(page).getByRole('link', { name: 'USA.gov benefit finder' }),
    ).toBeVisible();
  });

  test('never claims a Wisconsin-only service applies out of state', async ({ page }) => {
    await page.goto('/');
    await page.locator('label.choice', { hasText: 'Outside Wisconsin' }).first().click();

    // The regression this suite was written for.
    const eligible = await bucket(page, /likely a match/i);
    expect(eligible).not.toContain('211 Wisconsin');
  });

  test('shows a real empty state rather than padding the results', async ({ page }) => {
    await page.goto('/');
    await runInterview(page, {
      ...WELL_OFF_MADISON,
      'Where do you live': { radio: 'Outside Wisconsin' },
    });

    expect(await bucket(page, /likely a match/i)).toHaveLength(0);
    expect(await bucket(page, /might qualify/i)).toHaveLength(0);
    await expect(results(page).getByText(/only covers Wisconsin/i)).toBeVisible();
  });
});

test.describe('the privacy guarantee', () => {
  test('makes no network request while the interview is answered', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });

    // Everything from here on is user input. Any request would carry it off-device.
    const requests: string[] = [];
    page.on('request', (r) => {
      // Vite's dev client keeps an HMR channel open; it does not exist in a build.
      if (!/@vite|__vite|node_modules|\.map$/.test(r.url())) requests.push(r.url());
    });

    await runInterview(page, CRISIS_FAMILY);
    expect(requests, `unexpected requests: ${requests.join(', ')}`).toHaveLength(0);
  });

  test('writes nothing to browser storage', async ({ page }) => {
    await page.goto('/');
    await runInterview(page, CRISIS_FAMILY);

    const stored = await page.evaluate(() => ({
      local: window.localStorage.length,
      session: window.sessionStorage.length,
      cookies: document.cookie,
      search: window.location.search,
    }));
    expect(stored).toEqual({ local: 0, session: 0, cookies: '', search: '' });
  });
});

test.describe('layout', () => {
  test('does not scroll sideways', async ({ page }) => {
    await page.goto('/');
    await page.locator('label.choice', { hasText: 'City of Madison' }).first().click();

    const { scrollW, clientW } = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }));
    expect(scrollW).toBeLessThanOrEqual(clientW);
  });

  /**
   * A real bug: at 360x640 the fixed mobile-summary strip painted directly
   * over the Continue button. The button was still `visible` -- Playwright's
   * default visibility check passed, and so did a naive "is it on screen"
   * assertion -- but it was not the topmost element at its own centre point,
   * so a real tap there would have hit the strip instead. Checking
   * `elementFromPoint` is the same check the browser itself does before
   * delivering a click, so this is "clickable," not "visible."
   *
   * This is deliberately not scoped to the `mobile-360` project: the
   * assertion is a general invariant (the primary action must always be the
   * thing a tap on it actually hits), and running it everywhere is what
   * would have caught the strip covering the button before it was reported.
   */
  test('the Continue button is not covered by anything, including the mobile summary strip', async ({
    page,
  }) => {
    await page.goto('/');
    await page.locator('label.choice', { hasText: 'City of Madison' }).first().click();

    const button = page.getByRole('button', { name: 'Continue' });
    await button.scrollIntoViewIfNeeded();

    const isOnTop = await button.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return top === el || el.contains(top);
    });
    expect(isOnTop, 'something is painted over the Continue button').toBe(true);

    // And the click actually has to land and do something -- a covered
    // button can still report "visible" while every click silently hits
    // whatever sits on top of it instead.
    const titleBefore = await page.locator('.interview__title').textContent();
    await button.click();
    await expect(page.locator('.interview__title')).not.toHaveText(titleBefore ?? '');
  });

  /**
   * WCAG 2.2's Focus Not Obscured (Minimum), and the keyboard counterpart to
   * the click-based test above. That test proves the mobile-summary strip
   * never sits on top of something a mouse would tap; it says nothing about
   * whether the browser's own scroll-into-view behavior for `Tab` keeps a
   * keyboard-focused element clear of the same strip. `scroll-padding-bottom`
   * (styles.css) is supposed to cover both cases -- this checks the second
   * one, by tabbing through a real result set (several program cards' worth
   * of controls) and confirming every stop that the browser actually brought
   * into the viewport is the topmost element at its own center point -- the
   * same test the browser itself runs before it would deliver a click or
   * paint a focus ring there.
   *
   * Deliberately narrower than "every tab stop must be on screen": a tab
   * stop the browser hasn't scrolled into view at all (top/bottom entirely
   * outside the viewport) is a reachability question, not this criterion --
   * Focus Not Obscured is about content that IS in the viewport being
   * covered by other author content, specifically the fixed strip here.
   * Conflating the two produced false failures on desktop, where a long
   * checkbox list inside the sticky `.interview` panel can be taller than
   * the viewport for reasons that have nothing to do with the mobile strip.
   */
  test('keyboard focus is never obscured by the mobile summary strip', async ({ page }) => {
    await page.goto('/');
    await page.locator('label.choice', { hasText: 'City of Madison' }).first().click();
    await page.getByRole('button', { name: 'Continue' }).click();

    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press('Tab');
      const result = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return { checked: false, obscured: false };
        const rect = el.getBoundingClientRect();
        const inViewport =
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom > 0 &&
          rect.right > 0 &&
          rect.top < window.innerHeight &&
          rect.left < window.innerWidth;
        if (!inViewport) return { checked: false, obscured: false };
        const cx = Math.min(Math.max(rect.left + rect.width / 2, 0), window.innerWidth - 1);
        const cy = Math.min(Math.max(rect.top + rect.height / 2, 0), window.innerHeight - 1);
        const top = document.elementFromPoint(cx, cy);
        const obscured = !(top === el || el.contains(top) || (top !== null && top.contains(el)));
        return { checked: true, obscured };
      });
      expect(result.obscured, `tab stop ${i} is obscured by something else`).toBe(false);
    }
  });
});
