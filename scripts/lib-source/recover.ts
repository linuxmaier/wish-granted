/**
 * Shared "the page came back empty" recovery, used by BOTH
 * the ingestion and extraction suites deleted in the unwind (issue #76); it is
 * kept because recovering an unreadable page is a capability, not a design bet.
 *
 * ## The contract
 *
 * A caller does its normal plain fetch, runs its own reducer
 * (`normalize` for ingest-descriptive, `renderStructured` for agentic-extract),
 * and -- only if that reduced text is (near-)empty -- hands the raw HTML here.
 * This is a **fallback, not a default**: on a page that reduced fine, the caller
 * never calls, and even when it does, step 1 below is a cheap string transform.
 *
 * The caller injects its own `measure(html) => reducedTextLength` so this module
 * decides "did recovery actually help?" using the *same* reducer the caller
 * trusts, rather than a second, divergent notion of "empty".
 *
 * ## The ladder
 *
 *   1. `unwrapContentShell` -- neutralise an ASP.NET WebForms / SharePoint
 *      `<form>` wrapper that the caller's reducer would otherwise delete whole.
 *      This is what fixes the #76 pages. Cheap, deterministic, no network.
 *   2. Headless Chromium (`browser.ts`) -- only if `allowBrowser` is set AND
 *      step 1 did not get there. For a genuinely client-rendered page. Slow;
 *      opt-in. Degrades to "not recovered" when no browser is available.
 *      The rendered DOM is run back through step 1, since a WebForms SPA still
 *      emits the wrapper `<form>` after hydration.
 *
 * Anything that does not clear `minUsefulText` leaves `recovered: false` and the
 * caller keeps its original (empty) result -- e.g. ingest-descriptive still
 * files a `source-text-review` flag. A page that truly states nothing readable
 * stays hand-authored, and that is a fine outcome to report.
 */
import { unwrapContentShell } from './unwrap-shell.ts';
import { playwrightRenderer, type BrowserRenderer } from './browser.ts';

export type RecoveryMethod = 'none' | 'unwrap-shell' | 'browser-render' | 'browser-render+unwrap-shell';

export interface RecoveryInput {
  /** The URL that was fetched (used only if a browser render is attempted). */
  readonly url: string;
  /** The raw HTML body from the caller's plain fetch. */
  readonly html: string;
}

export interface RecoverOptions {
  /**
   * The caller's own reducer, as a length. Usually
   * `(h) => normalize(h).length` or `(h) => renderStructured(h).length`.
   */
  readonly measure: (html: string) => number;
  /** Reduced-text length at or above which the page counts as recovered. */
  readonly minUsefulText?: number;
  /** Attempt a headless-browser render if the deterministic step is not enough. */
  readonly allowBrowser?: boolean;
  /** Injected for tests; defaults to the real Playwright renderer. */
  readonly renderer?: BrowserRenderer;
}

export interface RecoveryResult {
  readonly recovered: boolean;
  readonly method: RecoveryMethod;
  /** HTML to re-reduce downstream. Equals `input.html` when `!recovered`. */
  readonly html: string;
  /** Reduced-text length of `html` under the caller's `measure`. */
  readonly textLength: number;
  /** One-line explanation for a report / trace. */
  readonly note: string;
}

const DEFAULT_MIN_USEFUL_TEXT = 200;

export async function recoverEmptyPage(
  input: RecoveryInput,
  opts: RecoverOptions,
): Promise<RecoveryResult> {
  const min = opts.minUsefulText ?? DEFAULT_MIN_USEFUL_TEXT;
  const baseline = opts.measure(input.html);

  const noChange = (note: string): RecoveryResult => ({
    recovered: false,
    method: 'none',
    html: input.html,
    textLength: baseline,
    note,
  });

  if (baseline >= min) {
    // Caller should not have called us, but never make a fine page worse.
    return noChange(`already ${baseline} chars of usable text -- nothing to recover`);
  }

  // --- Step 1: deterministic shell unwrap -------------------------------------
  const unwrapped = unwrapContentShell(input.html);
  if (unwrapped.unwrapped) {
    const len = opts.measure(unwrapped.html);
    if (len >= min && len > baseline) {
      return {
        recovered: true,
        method: 'unwrap-shell',
        html: unwrapped.html,
        textLength: len,
        note: `${unwrapped.note}; ${baseline} -> ${len} chars of usable text`,
      };
    }
  }

  // --- Step 2: headless browser (opt-in) ------------------------------------
  if (opts.allowBrowser) {
    const renderer = opts.renderer ?? playwrightRenderer();
    const outcome = await renderer.render(input.url);
    if (outcome.ok) {
      const direct = opts.measure(outcome.html);
      const reUnwrapped = unwrapContentShell(outcome.html);
      const viaUnwrap = reUnwrapped.unwrapped ? opts.measure(reUnwrapped.html) : -1;

      if (viaUnwrap >= min && viaUnwrap >= direct) {
        return {
          recovered: true,
          method: 'browser-render+unwrap-shell',
          html: reUnwrapped.html,
          textLength: viaUnwrap,
          note: `rendered in headless Chromium, then ${reUnwrapped.note}; ${baseline} -> ${viaUnwrap} chars`,
        };
      }
      if (direct >= min && direct > baseline) {
        return {
          recovered: true,
          method: 'browser-render',
          html: outcome.html,
          textLength: direct,
          note: `rendered in headless Chromium; ${baseline} -> ${direct} chars of usable text`,
        };
      }
      return noChange(
        `headless render reached the page but it still reduced to ${Math.max(direct, viaUnwrap, 0)} chars ` +
          `(<= ${min}) -- content is not in the DOM; treat as hand-authored`,
      );
    }
    return noChange(`deterministic unwrap did not help and the browser fallback could not run (${outcome.reason})`);
  }

  return noChange(
    unwrapped.unwrapped
      ? `unwrap ran but text is still ${opts.measure(unwrapped.html)} chars (<= ${min}); pass allowBrowser to try a render`
      : `${unwrapped.note}; nothing to unwrap and no browser fallback requested`,
  );
}
