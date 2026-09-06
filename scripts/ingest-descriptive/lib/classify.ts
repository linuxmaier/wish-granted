/**
 * Turn one program record plus one fetched source page into a `RecordFinding`:
 * concrete descriptive-field *proposals* (a value a human can accept as-is) and
 * *review flags* (something a human should look at, no value proposed).
 *
 * The outcomes are kept distinct on purpose -- issue #14's "New / changed / gone
 * handled distinctly. A 404 is not an edit." -- and the spike adds a fourth:
 * "the source domain moved" (FNS->FNA) is neither `changed` nor `gone`.
 *
 *   ok          -- fetched, 200, same URL. Extract descriptive candidates.
 *   redirected  -- 200, but the final URL's path changed on the same host.
 *   moved       -- 200, but the final URL is on a different host. Propose the
 *                  new source URL; do NOT touch anything else automatically.
 *   gone        -- 404 / 410. The page was removed. Finding the new page is a
 *                  human job (which official page? is the program even alive?),
 *                  so this proposes nothing -- it only flags.
 *   unreachable -- timeout / 5xx / network error. Often transient; flag only.
 *   blocked     -- hard-deny host or robots.txt. Flag, never fetch again.
 *
 * This module never reads, extracts, proposes, or writes an `eligibility` rule.
 * See ../eligibility-seam.ts for why that is deliberate and where an extractor
 * would attach if one ever passes its held-out eval (it has not -- issue #51).
 */
import type { FetchOutcome } from './fetch.ts';
import { sha256 } from '../../check-sources/lib/hashes-file.ts';
import { extractPhones, excerptAround, detectStatusSignals, normalizePhone, type StatusSignal } from './extract.ts';

export type UrlHealth = 'ok' | 'redirected' | 'moved' | 'gone' | 'unreachable' | 'blocked';

/** The descriptive fields this pipeline is allowed to touch. Not `eligibility`. */
export type DescriptiveField = 'source.url' | 'howToApply.phone';

export interface Provenance {
  /** The `source.url` from the record -- what we asked for. */
  readonly sourceUrl: string;
  /** Where the response actually came from, after redirects. */
  readonly finalUrl: string;
  /** Verbatim span of normalized page text the proposed value was read from. */
  readonly excerpt: string;
}

export interface FieldProposal {
  readonly field: DescriptiveField;
  /** Current value in the record, or `null` for an empty field. */
  readonly current: string | null;
  readonly proposed: string;
  readonly classification: 'new' | 'changed' | 'moved';
  readonly confidence: 'low' | 'medium';
  readonly provenance: Provenance;
}

export type ReviewKind =
  | 'gone'
  | 'unreachable'
  | 'blocked'
  | 'phone-missing-from-page'
  | 'phone-candidates'
  | 'status-signal'
  | 'source-text-review';

export interface ReviewFlag {
  readonly kind: ReviewKind;
  readonly message: string;
  readonly excerpt: string;
}

export interface RecordFinding {
  readonly id: string;
  readonly sourceUrl: string;
  readonly finalUrl: string;
  readonly urlHealth: UrlHealth;
  readonly detail: string;
  readonly proposals: readonly FieldProposal[];
  readonly reviews: readonly ReviewFlag[];
  /**
   * `sha256:<hex>` of the normalized page text -- the SAME hash
   * `scripts/check-sources` stores in `source-hashes.json` (same `normalize`,
   * same `sha256`). `null` when the page could not be fetched/read this run.
   * A "reviewed, no change needed" acknowledgement on a proposals.json entry is
   * keyed to this, so it is invalidated the moment the page text moves (#49).
   */
  readonly sourceHash: string | null;
}

export interface RecordInput {
  readonly id: string;
  readonly sourceUrl: string;
  readonly currentPhone: string | null;
  /** From the record. Used only to phrase the status-signal review flag. */
  readonly currentStatus: string;
}

export interface ClassifyOptions {
  /** Normalizer for the fetched HTML -- injected so tests need no fixtures. */
  readonly normalize: (raw: string) => string;
  /** Minimum normalized-text length before phone-absence is worth flagging. */
  readonly minTextForPhoneCheck?: number;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url;
  }
}

const STATUS_LABEL: Record<StatusSignal, string> = {
  closed: 'closed / not accepting applications',
  waitlist: 'a waiting list',
  seasonal: 'a seasonal application window',
};

export function classify(input: RecordInput, outcome: FetchOutcome, opts: ClassifyOptions): RecordFinding {
  const base = { id: input.id, sourceUrl: input.sourceUrl, finalUrl: outcome.finalUrl, sourceHash: null as string | null };
  const minText = opts.minTextForPhoneCheck ?? 400;

  if (outcome.kind === 'gone') {
    return {
      ...base,
      urlHealth: 'gone',
      detail: `HTTP ${outcome.httpStatus} -- page removed, not edited`,
      proposals: [],
      reviews: [
        {
          kind: 'gone',
          message:
            `${input.sourceUrl} returned HTTP ${outcome.httpStatus}. Find the current official page, decide ` +
            `"moved" vs "never correct" (docs/data-authoring.md), fix source.url in the record, then re-verify.`,
          excerpt: '',
        },
      ],
    };
  }

  if (outcome.kind === 'unreachable' || outcome.kind === 'blocked') {
    return {
      ...base,
      urlHealth: outcome.kind,
      detail: outcome.kind === 'blocked' ? `blocked -- ${outcome.reason}` : `unreachable -- ${outcome.reason}`,
      proposals: [],
      reviews: [
        {
          kind: outcome.kind,
          message:
            outcome.kind === 'blocked'
              ? `Not fetched: ${outcome.reason}. This source stays hand-authored; nothing to ingest here.`
              : `Could not fetch ${input.sourceUrl}: ${outcome.reason}. Usually transient -- if it persists across runs, treat as gone.`,
          excerpt: '',
        },
      ],
    };
  }

  // outcome.kind === 'ok'
  const text = opts.normalize(outcome.text);
  base.sourceHash = sha256(text);
  const proposals: FieldProposal[] = [];
  const reviews: ReviewFlag[] = [];

  const sameHost = hostOf(outcome.finalUrl) === hostOf(input.sourceUrl);
  const redirected = outcome.finalUrl !== input.sourceUrl;
  let urlHealth: UrlHealth = 'ok';
  let detail = `${text.length} chars of normalized text`;

  if (redirected && !sameHost) {
    urlHealth = 'moved';
    detail = `source domain moved: ${hostOf(input.sourceUrl)} -> ${hostOf(outcome.finalUrl)}`;
    proposals.push({
      field: 'source.url',
      current: input.sourceUrl,
      proposed: outcome.finalUrl,
      classification: 'moved',
      confidence: 'medium',
      provenance: {
        sourceUrl: input.sourceUrl,
        finalUrl: outcome.finalUrl,
        excerpt: `HTTP redirect to a different host (${hostOf(outcome.finalUrl)}). Confirm this is the official replacement page, not a catch-all landing page, before accepting.`,
      },
    });
  } else if (redirected) {
    urlHealth = 'redirected';
    detail = `source URL redirected (same host): ${input.sourceUrl} -> ${outcome.finalUrl}`;
    proposals.push({
      field: 'source.url',
      current: input.sourceUrl,
      proposed: outcome.finalUrl,
      classification: 'changed',
      confidence: 'medium',
      provenance: {
        sourceUrl: input.sourceUrl,
        finalUrl: outcome.finalUrl,
        excerpt: `HTTP redirect on the same host. Record the destination, not the redirector (docs/data-authoring.md).`,
      },
    });
  }

  // If the page barely normalized to anything (SharePoint's energyandhousing.wi.gov
  // reduces to zero characters -- a real, recorded limitation), there is nothing
  // to extract and a phone-absence flag would be a false positive.
  if (text.length < minText) {
    if (text.length === 0) {
      reviews.push({
        kind: 'source-text-review',
        message:
          `${outcome.finalUrl} fetched OK but normalized to no readable text (JS-rendered or a template ` +
          `this normalizer cannot reduce). Descriptive ingestion from this source is not currently possible; ` +
          `it stays hand-authored.`,
        excerpt: '',
      });
    }
    return { ...base, urlHealth, detail, proposals, reviews };
  }

  // --- howToApply.phone ---------------------------------------------------
  const phones = extractPhones(text);
  const currentNorm = input.currentPhone ? normalizePhone(input.currentPhone) : null;

  if (currentNorm) {
    const stillThere = phones.some((p) => p.normalized === currentNorm);
    if (!stillThere && phones.length > 0) {
      const first = phones[0]!;
      reviews.push({
        kind: 'phone-missing-from-page',
        message:
          `The record's phone (${input.currentPhone}) no longer appears on ${outcome.finalUrl}. ` +
          `Numbers now on the page: ${phones.map((p) => p.raw).join(', ')}. Verify against the source.`,
        excerpt: excerptAround(text, first.index, first.raw.length),
      });
    }
  } else if (phones.length === 1) {
    const only = phones[0]!;
    proposals.push({
      field: 'howToApply.phone',
      current: null,
      proposed: only.raw,
      classification: 'new',
      confidence: 'low',
      provenance: {
        sourceUrl: input.sourceUrl,
        finalUrl: outcome.finalUrl,
        excerpt: excerptAround(text, only.index, only.raw.length),
      },
    });
  } else if (phones.length > 1) {
    reviews.push({
      kind: 'phone-candidates',
      message:
        `The record has no phone and ${outcome.finalUrl} lists ${phones.length}: ${phones
          .map((p) => p.raw)
          .join(', ')}. Pick the application/help line by hand if one belongs in the record.`,
      excerpt: excerptAround(text, phones[0]!.index, phones[0]!.raw.length),
    });
  }

  // --- status -----------------------------------------------------------
  // Only flag a signal that disagrees with the recorded status. The signal
  // slugs ('closed' / 'waitlist' / 'seasonal') are chosen to match ProgramStatus
  // values, so a page that says "closed" on an already-`closed` record is quiet.
  for (const sig of detectStatusSignals(text)) {
    if (sig.signal === input.currentStatus) continue;
    reviews.push({
      kind: 'status-signal',
      message:
        `Page text suggests ${STATUS_LABEL[sig.signal]}; the record's status is "${input.currentStatus}". ` +
        `Confirm the current status against the source.`,
      excerpt: sig.excerpt,
    });
  }

  return { ...base, urlHealth, detail, proposals, reviews };
}

/** True when a finding is worth putting in front of a human. */
export function isActionable(f: RecordFinding): boolean {
  return f.proposals.length > 0 || f.reviews.length > 0;
}
