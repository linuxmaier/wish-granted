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
import { extractPdf } from './pdf.ts';
import { recoverEmptyPage, type RecoveryMethod } from '../../render-fallback/lib/recover.ts';

/** Below this many chars of structured text, a 200 page is treated as "empty"
 *  and handed to the #76 recovery ladder (form-shell unwrap, then optionally a
 *  headless render). energyandhousing.wi.gov's SharePoint pages render to 0.
 *  Only ever applied to HTML -- a PDF outcome is decided by `extractPdf` before
 *  this check is reached. */
const THIN_STRUCTURED_TEXT = 200;

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
  /** `'pdf'` when the source was a fetched PDF read via lib/pdf.ts. */
  readonly format?: 'html' | 'pdf';
  /** #76: how a 200-but-empty page was made readable, if it was. Always
   *  `'none'` for a PDF -- the thin-text recovery ladder is HTML-only. */
  readonly hydration: RecoveryMethod;
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

type OkOrMoved = Extract<FetchOutcome, { kind: 'ok' | 'moved' }>;

/** `FetchedPage`, or -- for a PDF whose text cannot be read -- an abstain reason. */
type PageOrPdfError = { readonly page: FetchedPage } | { readonly pdfError: string };

/**
 * Turn a successful fetch into a `FetchedPage`.
 *
 * Format is decided first: a PDF outcome (#77) is read via `extractPdf` and
 * short-circuits here -- an unreadable PDF becomes an abstain reason, and a
 * short-but-valid PDF extraction is never mistaken for an empty HTML page. Only
 * once we know the outcome is HTML does the #76 thin-text recovery ladder run;
 * unwrapping a form shell inside a PDF would be meaningless.
 */
async function toPage(
  outcome: OkOrMoved,
  requestedUrl: string,
  recovered: boolean,
  allowBrowserRender: boolean,
): Promise<PageOrPdfError> {
  const redirected = outcome.kind === 'ok' ? outcome.redirected : true;

  if (outcome.contentType === 'pdf') {
    const result = extractPdf(outcome.bytes ?? new Uint8Array());
    if (!result.ok) {
      return { pdfError: `fetched the PDF at ${outcome.finalUrl} but its text is not machine-extractable (${result.reason})` };
    }
    return {
      page: {
        requestedUrl,
        finalUrl: outcome.finalUrl,
        structured: result.structured,
        flat: result.flat,
        redirected,
        recovered,
        format: 'pdf',
        hydration: 'none',
      },
    };
  }

  let body = outcome.body;
  let structured = renderStructured(body);
  let hydration: RecoveryMethod = 'none';

  // #76: some 200 pages (SharePoint / ASP.NET WebForms) reduce to nothing
  // because the structure renderer strips the wrapping <form>. Recover before
  // the model ever sees the page -- structure-preserving, same renderer.
  if (structured.length < THIN_STRUCTURED_TEXT) {
    const rec = await recoverEmptyPage(
      { url: outcome.finalUrl, html: body },
      { measure: (h) => renderStructured(h).length, allowBrowser: allowBrowserRender },
    );
    if (rec.recovered) {
      body = rec.html;
      structured = renderStructured(body);
      hydration = rec.method;
    }
  }

  return {
    page: {
      requestedUrl,
      finalUrl: outcome.finalUrl,
      structured,
      flat: flattenText(body),
      redirected,
      recovered,
      format: 'html',
      hydration,
    },
  };
}

export interface NavigatorOptions {
  /** #76: allow a headless-browser render as the last recovery step for a
   *  200-but-empty page. Off by default -- the deterministic form-shell unwrap
   *  handles every source in the dataset today, and a browser is slow. */
  readonly allowBrowserRender?: boolean;
}

export class Navigator {
  private readonly pages = new Map<string, FetchedPage>();
  private readonly fetcher: Fetcher;
  private readonly allowBrowserRender: boolean;

  constructor(fetcher: Fetcher, options: NavigatorOptions = {}) {
    this.fetcher = fetcher;
    this.allowBrowserRender = options.allowBrowserRender ?? false;
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
      const r = await toPage(outcome, url, false, this.allowBrowserRender);
      if ('pdfError' in r) {
        return { ok: false, reason: 'unreachable', requestedUrl: url, detail: r.pdfError };
      }
      this.remember(r.page);
      return { ok: true, page: r.page };
    }

    if (outcome.kind === 'moved') {
      const r = await toPage(outcome, url, false, this.allowBrowserRender);
      if ('pdfError' in r) {
        return { ok: false, reason: 'unreachable', requestedUrl: url, detail: r.pdfError };
      }
      this.remember(r.page);
      return {
        ok: false,
        reason: 'moved-host',
        requestedUrl: url,
        detail: `source host redirected to ${outcome.finalUrl} -- fetched, but a reviewer must confirm this is the same program`,
        movedTo: outcome.finalUrl,
        page: r.page,
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
        const r = await toPage(rec, candidate, true, this.allowBrowserRender);
        if ('pdfError' in r) continue;
        this.remember(r.page);
        return { ok: true, page: r.page };
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
