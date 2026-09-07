/**
 * Provenance enforcement.
 *
 * The issue is unambiguous: "Every emitted rule carries the verbatim source
 * span it came from and the URL that span was fetched from -- including when
 * the span came from a followed cross-reference, in which case record THAT URL,
 * not the entry page."
 *
 * So an emitted record is only accepted if every claimed span verifies verbatim
 * against the text of some page actually fetched this run, and the URL recorded
 * is the page it matched -- picked by the matcher, not asserted by the model.
 * A span that matches nothing is a hard rejection: the model is sent back to
 * quote real text or to abstain.
 */

export interface ClaimedSpan {
  readonly quote: string;
  /** The model's claim about where it read this. Verified, not trusted. */
  readonly url?: string;
}

export interface VerifiedSpan {
  readonly quote: string;
  /** The URL whose fetched text actually contains the quote. */
  readonly url: string;
  /** True when the resolved URL differs from what the model claimed. */
  readonly urlCorrected: boolean;
}

export interface SpanSource {
  /** Final URL of a fetched page (or a resolved cross-reference URL). */
  readonly url: string;
  /** Flattened text of that page. */
  readonly flat: string;
}

/** Whitespace-insensitive, case-insensitive contains check. */
function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function spanAppearsIn(quote: string, haystack: string): boolean {
  const q = normalize(quote);
  if (q.length < 8) return false; // too short to be meaningful provenance
  return normalize(haystack).includes(q);
}

export type SpanVerification =
  | { readonly ok: true; readonly span: VerifiedSpan }
  | { readonly ok: false; readonly quote: string; readonly reason: string };

/**
 * Verify one claimed span against every page fetched this run. Prefers the URL
 * the model claimed when the quote genuinely appears there; otherwise falls
 * back to whichever fetched page does contain it, and flags the correction.
 */
export function verifySpan(claim: ClaimedSpan, sources: readonly SpanSource[]): SpanVerification {
  if (normalize(claim.quote).length < 8) {
    return { ok: false, quote: claim.quote, reason: 'span too short to be provenance (need >= 8 non-space chars)' };
  }

  if (claim.url) {
    const claimed = sources.find((s) => s.url === claim.url);
    if (claimed && spanAppearsIn(claim.quote, claimed.flat)) {
      return { ok: true, span: { quote: claim.quote, url: claimed.url, urlCorrected: false } };
    }
  }

  const match = sources.find((s) => spanAppearsIn(claim.quote, s.flat));
  if (match) {
    return {
      ok: true,
      span: { quote: claim.quote, url: match.url, urlCorrected: claim.url !== undefined && claim.url !== match.url },
    };
  }

  return {
    ok: false,
    quote: claim.quote,
    reason: claim.url
      ? `span not found verbatim on ${claim.url} or any other page fetched this run`
      : 'span not found verbatim on any page fetched this run',
  };
}

export interface ProvenanceResult {
  readonly ok: boolean;
  readonly verified: readonly VerifiedSpan[];
  readonly failures: readonly { readonly quote: string; readonly reason: string }[];
}

export function verifyAllSpans(claims: readonly ClaimedSpan[], sources: readonly SpanSource[]): ProvenanceResult {
  if (claims.length === 0) {
    return { ok: false, verified: [], failures: [{ quote: '', reason: 'no provenance spans supplied' }] };
  }
  const verified: VerifiedSpan[] = [];
  const failures: { quote: string; reason: string }[] = [];
  for (const claim of claims) {
    const r = verifySpan(claim, sources);
    if (r.ok) verified.push(r.span);
    else failures.push({ quote: r.quote, reason: r.reason });
  }
  return { ok: failures.length === 0, verified, failures };
}
