/**
 * Fetch one program's `source.url`, normalize it, and classify the result
 * against the stored baseline.
 *
 * The five outcomes are kept distinct on purpose (#7, and #14's "a 404 is not
 * an edit"):
 *
 *   - `new`         -- no baseline yet. First run, or a record whose URL changed.
 *   - `unchanged`   -- normalized text hashes to the stored value. Silent.
 *   - `changed`     -- reachable, 200, but the normalized text moved. Re-verify.
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
import { normalizeToResult, type ContentRegion } from './normalize.ts';
import { sha256, type SourceHashEntry } from './hashes-file.ts';

export type CheckStatus = 'new' | 'unchanged' | 'changed' | 'gone' | 'unreachable';

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
  if (r.status === 'gone' || r.status === 'changed') return true;
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

  const { text: normalized, region: contentRegion } = normalizeToResult(outcome.text);
  const hash = sha256(normalized);
  const chars = normalized.length;

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
