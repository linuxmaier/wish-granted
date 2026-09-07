/**
 * Fetch one program's `source.url`, normalize it, and classify the result
 * against the stored baseline.
 *
 * The outcomes are kept distinct on purpose (#7, and #14's "a 404 is not
 * an edit"):
 *
 *   - `new`         -- no baseline yet. First run, or a record whose URL changed.
 *   - `unchanged`   -- normalized text hashes to the stored value. Silent.
 *   - `changed`     -- reachable, 200, but the normalized text moved. Re-verify.
 *   - `unreadable`  -- reachable, 200, but the page reduced to no usable text
 *                      (empty, or below MIN_PLAUSIBLE_CHARS). Never folded into
 *                      `unchanged`: an empty normalization hashes consistently,
 *                      so an empty baseline would compare nothing to nothing
 *                      forever and never report a real change (issue #82). This
 *                      is a reducer bug signal -- a wrapper element eating the
 *                      page, a template the landmark chain misses -- not an
 *                      edit. Escalates on the first run; the stored hash (if any)
 *                      is kept so it is not mistaken for a valid baseline.
 *   - `gone`        -- 404 or 410. The page was removed, not edited. Different
 *                      fix (find the new URL) and different reviewer. Escalates
 *                      on the first run -- a retry counter must never hide a
 *                      vanished program (issue #49, #7, #14).
 *   - `unreachable` -- network error, timeout, 403/5xx, redirect loop. Could be
 *                      transient; not evidence of anything yet. Only becomes an
 *                      actionable finding after ESCALATE_AFTER_FAILURES
 *                      back-to-back failed runs (issue #49).
 *
 * The fetcher is injected so the classifier can be tested without a network.
 */
import { fetchText } from '../../refresh-income-tables/lib/http.ts';
import { errMsg } from '../../refresh-income-tables/lib/errors.ts';
import { unwrapContentShell } from '../../render-fallback/lib/unwrap-shell.ts';
import { normalizeToResult, type ContentRegion, type NormalizeResult } from './normalize.ts';
import { sha256, type SourceHashEntry } from './hashes-file.ts';

export type CheckStatus = 'new' | 'unchanged' | 'changed' | 'gone' | 'unreachable' | 'unreadable';

/**
 * Below this many normalized characters, the reduction is treated as "the strip
 * step ate the page" and retried once with any content-bearing `<form>` wrapper
 * neutralised (issue #82: ASP.NET WebForms / SharePoint wraps the whole `<body>`
 * in one `<form id="aspnetForm">`, and `normalize()` strips `<form>` wholesale).
 * The unwrap is `unwrapContentShell` -- the exact transform the ingestion path
 * runs (`scripts/render-fallback/lib/unwrap-shell.ts`), reused, not reimplemented.
 * It matches `recoverEmptyPage`'s DEFAULT_MIN_USEFUL_TEXT and sits well below the
 * smallest real source page (wi-211, ~350 chars), so a legitimately terse page
 * never triggers the retry -- and when it does, the retry is a no-op unless a
 * page-wrapping `<form>` is actually found. CSRF/nonce/session inputs the wrapper
 * was hiding are still dropped: `normalize()` strips every remaining tag (and its
 * attributes) and scrubs opaque tokens.
 */
const UNWRAP_RETRY_FLOOR = 200;

/**
 * Normalize `html`, and if that comes back near-empty, retry once with a
 * content-bearing `<form>` wrapper unwrapped. Returns whichever reduction found
 * more text.
 */
export function normalizeWithUnwrap(html: string): NormalizeResult {
  const direct = normalizeToResult(html);
  if (direct.text.length >= UNWRAP_RETRY_FLOOR) return direct;

  const unwrapped = unwrapContentShell(html);
  if (!unwrapped.unwrapped) return direct;

  const retry = normalizeToResult(unwrapped.html);
  return retry.text.length > direct.text.length ? retry : direct;
}

/**
 * A 200 response whose normalized text is shorter than this is reported as
 * `unreadable`, not `new` / `unchanged` / `changed`. Justification for the
 * floor: every one of the 17 live source pages normalizes to >= ~350 characters
 * (the smallest, wi-211, is 350; the next is ~1,165), so 50 sits a full 7x below
 * the smallest real page and cannot fire on a legitimately terse one. And 50
 * characters cannot carry even one eligibility sentence -- a threshold, a
 * household-size qualifier, a program name -- so a reduction that small is the
 * reducer failing, not the page being brief. A zero-length normalization is
 * never a valid baseline (issue #82).
 */
export const MIN_PLAUSIBLE_CHARS = 50;

/**
 * How many consecutive failed fetches it takes for an `unreachable` source to
 * escalate from "silent bookkeeping" to an actionable, PR-opening finding.
 * Runs are monthly, so 2 means: first failure is recorded and ignored, a second
 * failure the next run opens the re-verification PR. `gone` (404/410) ignores
 * this entirely and escalates immediately.
 */
export const ESCALATE_AFTER_FAILURES = 2;

export interface CheckResult {
  readonly id: string;
  readonly url: string;
  readonly status: CheckStatus;
  /** One line of context for the report (old/new size, http status, error). */
  readonly detail: string;
  /** The entry to persist for this id. */
  readonly entry: SourceHashEntry;
  /** For `unreachable`: how many back-to-back runs have now failed (>= 1). */
  readonly consecutiveFailures?: number;
  /** For a fetched page: which content-region fallback normalize() landed on. */
  readonly contentRegion?: ContentRegion;
}

/** An `unreachable` result is only worth a human's time once it has persisted. */
export function isEscalated(r: CheckResult): boolean {
  if (r.status === 'gone' || r.status === 'changed' || r.status === 'unreadable') return true;
  return r.status === 'unreachable' && (r.consecutiveFailures ?? 0) >= ESCALATE_AFTER_FAILURES;
}

export type FetchOutcome =
  | { kind: 'ok'; text: string }
  | { kind: 'gone'; httpStatus: number }
  | { kind: 'unreachable'; reason: string };

export type Fetcher = (url: string) => Promise<FetchOutcome>;

const DEFAULT_TIMEOUT_MS = 30_000;

export const liveFetcher: Fetcher = async (url) => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const res = await fetchText(url, { signal: controller.signal });
      if (res.status === 404 || res.status === 410) return { kind: 'gone', httpStatus: res.status };
      if (!res.ok) return { kind: 'unreachable', reason: `HTTP ${res.status}` };
      return { kind: 'ok', text: res.text };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return { kind: 'unreachable', reason: errMsg(err) };
  }
};

export interface CheckInput {
  readonly id: string;
  readonly url: string;
  readonly previous: SourceHashEntry | undefined;
  readonly today: string;
}

export async function checkSource(input: CheckInput, fetcher: Fetcher = liveFetcher): Promise<CheckResult> {
  const { id, url, previous, today } = input;
  const outcome = await fetcher(url);

  if (outcome.kind === 'gone') {
    return {
      id,
      url,
      status: 'gone',
      detail: `HTTP ${outcome.httpStatus} -- page removed, not edited`,
      entry: {
        url,
        // Keep the last good hash so re-verification has something to diff against.
        normalizedSha256: previous?.normalizedSha256 ?? null,
        normalizedChars: previous?.normalizedChars ?? null,
        status: 'gone',
        firstSeen: previous?.firstSeen ?? today,
        lastChanged: previous?.lastChanged ?? today,
        // A removed page is not a flaky fetch -- drop any transient-failure count.
      },
    };
  }

  if (outcome.kind === 'unreachable') {
    const consecutiveFailures = (previous?.consecutiveFailures ?? 0) + 1;
    const escalated = consecutiveFailures >= ESCALATE_AFTER_FAILURES;
    return {
      id,
      url,
      status: 'unreachable',
      detail: escalated
        ? `unreachable ${consecutiveFailures} runs running -- ${outcome.reason}`
        : `unreachable -- ${outcome.reason} (failure ${consecutiveFailures} of ${ESCALATE_AFTER_FAILURES}, not yet escalated)`,
      consecutiveFailures,
      entry: {
        url,
        // Keep the last good hash so a transient failure doesn't lose the baseline.
        normalizedSha256: previous?.normalizedSha256 ?? null,
        normalizedChars: previous?.normalizedChars ?? null,
        status: 'unreachable',
        firstSeen: previous?.firstSeen ?? today,
        lastChanged: previous?.lastChanged ?? today,
        consecutiveFailures,
      },
    };
  }

  const { text: normalized, region: contentRegion } = normalizeWithUnwrap(outcome.text);
  const hash = sha256(normalized);
  const chars = normalized.length;

  if (chars < MIN_PLAUSIBLE_CHARS) {
    return {
      id,
      url,
      status: 'unreadable',
      detail:
        `normalized to ${chars} chars (< ${MIN_PLAUSIBLE_CHARS}) -- the page fetched 200 but the ` +
        `reducer produced no usable text. A reducer bug, not an edit; do NOT re-baseline this ` +
        `until it sees real text (issue #82).`,
      contentRegion,
      entry: {
        url,
        // Keep the last good hash (if any) so this is never mistaken for a
        // valid baseline -- and so a persistent `unreadable` reproduces the
        // file byte-for-byte across runs.
        normalizedSha256: previous?.normalizedSha256 ?? null,
        normalizedChars: previous?.normalizedChars ?? null,
        status: 'unreadable',
        firstSeen: previous?.firstSeen ?? today,
        lastChanged: previous?.lastChanged ?? today,
      },
    };
  }

  if (!previous || previous.normalizedSha256 === null) {
    return {
      id,
      url,
      status: 'new',
      detail: `baseline recorded (${chars} chars)`,
      contentRegion,
      entry: {
        url,
        normalizedSha256: hash,
        normalizedChars: chars,
        status: 'ok',
        firstSeen: previous?.firstSeen ?? today,
        lastChanged: today,
      },
    };
  }

  if (previous.normalizedSha256 === hash) {
    return {
      id,
      url,
      status: 'unchanged',
      detail: `${chars} chars`,
      contentRegion,
      // Rebuilt field-by-field (not `...previous`) so a recovery from a prior
      // gone/unreachable drops `status` and `consecutiveFailures` -- an
      // unchanged, healthy run reproduces source-hashes.json exactly and opens
      // nothing.
      entry: {
        url,
        normalizedSha256: previous.normalizedSha256,
        normalizedChars: previous.normalizedChars,
        status: 'ok',
        firstSeen: previous.firstSeen,
        lastChanged: previous.lastChanged,
      },
    };
  }

  return {
    id,
    url,
    status: 'changed',
    detail: `normalized text ${previous.normalizedChars ?? '?'} -> ${chars} chars`,
    contentRegion,
    entry: {
      url,
      normalizedSha256: hash,
      normalizedChars: chars,
      status: 'ok',
      firstSeen: previous.firstSeen,
      lastChanged: today,
    },
  };
}
