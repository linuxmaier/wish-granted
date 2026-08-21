import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * public/privacy.css hand-copies a subset of the "Quiet civic" tokens from
 * src/ui/styles.css, because public/privacy.html is a standalone page (see
 * its own docblock) that deliberately doesn't import the app's CSS pipeline.
 * A hand copy drifts silently if the palette ever moves, so this test pins
 * the handful of tokens the two files share -- not full CSS equality, just
 * the values a design change would actually touch.
 */

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

function extractToken(css: string, name: string, block: 'root' | 'dark'): string {
  // Light-mode value comes from the bare :root block; dark comes from the
  // first `@media (prefers-color-scheme: dark)` block in each file. Both
  // files put the token declarations one per line, so a scoped regex over
  // the right slice is enough -- no CSS parser needed for this.
  const section =
    block === 'root'
      ? css.slice(0, css.indexOf('@media'))
      : css.slice(css.indexOf('@media (prefers-color-scheme: dark)'));
  const match = section.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]+)`));
  if (!match?.[1]) throw new Error(`--${name} (${block}) not found`);
  return match[1].toLowerCase();
}

describe('privacy.css color tokens stay in sync with the app palette', () => {
  const appCss = read('../../src/ui/styles.css');
  const privacyCss = read('../../public/privacy.css');

  it.each(['bg', 'ink', 'ink-soft', 'line', 'accent'] as const)(
    '--%s matches in light mode',
    (name) => {
      expect(extractToken(privacyCss, name, 'root')).toBe(extractToken(appCss, name, 'root'));
    },
  );

  it.each(['bg', 'ink', 'ink-soft', 'line', 'accent'] as const)(
    '--%s matches in dark mode',
    (name) => {
      expect(extractToken(privacyCss, name, 'dark')).toBe(extractToken(appCss, name, 'dark'));
    },
  );
});
