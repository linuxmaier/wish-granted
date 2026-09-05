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
 *                      fix (find the new URL) and different reviewer.
 *   - `unreachable` -- network error, timeout, 403/5xx, redirect loop. Could be
 *                      transient; not evidence of anything yet.
 *
 * The fetcher is injected so the classifier can be tested without a network.
 */
import { fetchText } from '../../refresh-income-tables/lib/http.ts';
import { errMsg } from '../../refresh-income-tables/lib/errors.ts';
import { normalize } from './normalize.ts';
import { sha256, type SourceHashEntry } from './hashes-file.ts';

export type CheckStatus = 'new' | 'unchanged' | 'changed' | 'gone' | 'unreachable';

export interface CheckResult {
  readonly id: string;
  readonly url: string;
  readonly status: CheckStatus;
  /** One line of context for the report (old/new size, http status, error). */
  readonly detail: string;
  /** The entry to persist for this id. */
  readonly entry: SourceHashEntry;
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

  if (outcome.kind === 'gone' || outcome.kind === 'unreachable') {
    const status: CheckStatus = outcome.kind;
    const detail =
      outcome.kind === 'gone'
        ? `HTTP ${outcome.httpStatus} -- page removed, not edited`
        : `unreachable -- ${outcome.reason}`;
    return {
      id,
      url,
      status,
      detail,
      entry: {
        url,
        // Keep the last good hash so a transient failure doesn't lose the baseline.
        normalizedSha256: previous?.normalizedSha256 ?? null,
        normalizedChars: previous?.normalizedChars ?? null,
        status: outcome.kind,
        firstSeen: previous?.firstSeen ?? today,
        lastChanged: previous?.lastChanged ?? today,
      },
    };
  }

  const normalized = normalize(outcome.text);
  const hash = sha256(normalized);
  const chars = normalized.length;

  if (!previous || previous.normalizedSha256 === null) {
    return {
      id,
      url,
      status: 'new',
      detail: `baseline recorded (${chars} chars)`,
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
      // Byte-identical to the stored entry (unless the page recovered from a
      // prior gone/unreachable, which is worth showing) -- so an unchanged run
      // reproduces source-hashes.json exactly and opens nothing.
      entry: { ...previous, url, status: 'ok' },
    };
  }

  return {
    id,
    url,
    status: 'changed',
    detail: `normalized text ${previous.normalizedChars ?? '?'} -> ${chars} chars`,
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
