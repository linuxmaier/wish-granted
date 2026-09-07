/**
 * Navigation over a `Fetcher`: fetch a page, follow the redirect it lands on,
 * and -- when the URL is dead -- try to recover the live page deterministically
 * before handing the problem to the model.
 *
 * The wizard-of-oz BadgerCare case turned on this: the URL in the brief
 * (`.../badgercareplus/income-limits.htm`) 404s, and a real pipeline hits dead
 * government URLs constantly (#5 §5 documents four moves). #7's `gone` / `moved`
 * classification is the input. Recovery here is conservative -- same host, same
 * directory neighbourhood, common index filenames -- and if none of that works
 * the caller surfaces the dead URL to the model, which has a `search_web` tool.
 *
 * Every page fetched is retained by URL (see PageStore) so a provenance span can
 * later be matched against the exact page it was read from, including a page
 * reached only via a cross-reference.
 */
import type { Fetcher, FetchOutcome } from './fetcher.ts';
import { renderStructured, flattenText } from './html-structure.ts';

export interface FetchedPage {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  /** Structure-preserving render fed to the model. */
  readonly structured: string;
  /** Flattened text, only for provenance span matching. */
  readonly flat: string;
  readonly redirected: boolean;
  /** True when recovered from a dead URL rather than fetched directly. */
  readonly recovered: boolean;
}

export type NavResult =
  | { readonly ok: true; readonly page: FetchedPage }
  | {
      readonly ok: false;
      readonly reason: 'gone' | 'moved-host' | 'blocked' | 'unreachable';
      readonly requestedUrl: string;
      readonly detail: string;
      /** For `gone`: URLs recovery tried and failed. Handy in the model prompt. */
      readonly triedRecovery?: readonly string[];
      /** For `moved`: where the host redirected to (still fetched, needs review). */
      readonly movedTo?: string;
      readonly page?: FetchedPage;
    };

/** Candidate URLs to probe when `url` is 404/410. Same host, same neighbourhood. */
export function recoveryCandidates(url: string): string[] {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return [];
  }
  const segments = u.pathname.split('/').filter(Boolean);
  const candidates = new Set<string>();
  const dir = segments.slice(0, -1);
  const base = `${u.origin}/${dir.join('/')}${dir.length ? '/' : ''}`;

  // The directory index, in the forms government CMS templates use.
  for (const idx of ['', 'index.htm', 'index.html', 'index.aspx', 'index.php']) {
    candidates.add(base + idx);
  }
  // Drop a trailing filename entirely (…/foo/bar.htm -> …/foo/).
  if (segments.length > 1) candidates.add(base);
  // One level up.
  if (dir.length > 0) {
    const up = dir.slice(0, -1);
    candidates.add(`${u.origin}/${up.join('/')}${up.length ? '/' : ''}`);
  }
  // Common filename swaps seen across WI DHS program pages.
  const last = segments[segments.length - 1] ?? '';
  if (/\.\w+$/.test(last)) {
    for (const alt of ['fpl.htm', 'eligibility.htm', 'income-limits.htm', 'index.htm']) {
      if (alt !== last) candidates.add(base + alt);
    }
  }
  candidates.delete(url);
  return [...candidates];
}

function toPage(outcome: Extract<FetchOutcome, { kind: 'ok' | 'moved' }>, requestedUrl: string, recovered: boolean): FetchedPage {
  return {
    requestedUrl,
    finalUrl: outcome.finalUrl,
    structured: renderStructured(outcome.body),
    flat: flattenText(outcome.body),
    redirected: outcome.kind === 'ok' ? outcome.redirected : true,
    recovered,
  };
}

export class Navigator {
  private readonly pages = new Map<string, FetchedPage>();
  private readonly fetcher: Fetcher;

  constructor(fetcher: Fetcher) {
    this.fetcher = fetcher;
  }

  /** Every page successfully fetched this run, keyed by its final URL. */
  store(): ReadonlyMap<string, FetchedPage> {
    return this.pages;
  }

  private remember(page: FetchedPage): void {
    this.pages.set(page.finalUrl, page);
    this.pages.set(page.requestedUrl, page);
  }

  async open(url: string, headers?: Readonly<Record<string, string>>): Promise<NavResult> {
    const outcome = await this.fetcher({ url, ...(headers ? { headers } : {}) });

    if (outcome.kind === 'ok') {
      const page = toPage(outcome, url, false);
      this.remember(page);
      return { ok: true, page };
    }

    if (outcome.kind === 'moved') {
      const page = toPage(outcome, url, false);
      this.remember(page);
      return {
        ok: false,
        reason: 'moved-host',
        requestedUrl: url,
        detail: `source host redirected to ${outcome.finalUrl} -- fetched, but a reviewer must confirm this is the same program`,
        movedTo: outcome.finalUrl,
        page,
      };
    }

    if (outcome.kind === 'blocked') {
      return { ok: false, reason: 'blocked', requestedUrl: url, detail: outcome.reason };
    }

    if (outcome.kind === 'unreachable') {
      return { ok: false, reason: 'unreachable', requestedUrl: url, detail: outcome.reason };
    }

    // gone -- attempt deterministic recovery.
    const tried: string[] = [];
    for (const candidate of recoveryCandidates(url)) {
      tried.push(candidate);
      const rec = await this.fetcher({ url: candidate, ...(headers ? { headers } : {}) });
      if (rec.kind === 'ok' || rec.kind === 'moved') {
        const page = toPage(rec, candidate, true);
        this.remember(page);
        return { ok: true, page };
      }
    }
    return {
      ok: false,
      reason: 'gone',
      requestedUrl: url,
      detail: `HTTP ${outcome.status} and no sibling/index page recovered it`,
      triedRecovery: tried,
    };
  }
}
