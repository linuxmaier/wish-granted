/**
 * Cross-reference resolution.
 *
 * "Notwithstanding the provisions of paragraph (a) of this section" has to be
 * followable -- #61 proved self-report could not resolve a `notwithstanding`
 * clause, and the SNAP wizard-of-oz case only got the answer right by reading
 * paragraphs (a), (b)(1) and (b)(2) together.
 *
 * Two pieces:
 *   1. `detectReferences(text)` -- a heuristic scan for the reference shapes
 *      that actually appear in this dataset's sources (eCFR paragraph refs,
 *      "§ 273.9", "s. 49.45 (3)", "Wis. Admin. Code § DHS 103"). It classifies
 *      but does not resolve non-eCFR refs -- see the candour note in the PR.
 *   2. `resolveEcfrSection(...)` -- the one class fully wired: the eCFR
 *      *versioner API*. The web UI redirects Claude Code subagents to an unblock
 *      page; the versioner API returns the section XML directly. It requires an
 *      `Accept-Encoding` header permitting compression -- HTTP 406 without one
 *      (verified against the live endpoint). The provenance URL recorded is the
 *      API URL, not the entry page.
 */
import type { Fetcher } from './fetcher.ts';
import { renderStructured, flattenText } from './html-structure.ts';

export interface DetectedReference {
  readonly raw: string;
  readonly kind: 'cfr-paragraph' | 'cfr-section' | 'wis-stat' | 'wis-admin-code' | 'other';
  /** Parsed hint for the resolvable kinds. */
  readonly cfr?: { readonly title?: number; readonly part?: number; readonly section?: string; readonly paragraph?: string };
  readonly resolvable: boolean;
}

const REF_PATTERNS: readonly { re: RegExp; kind: DetectedReference['kind'] }[] = [
  { re: /\bparagraph\s*\(([a-z0-9]+)\)(?:\s*\(([a-z0-9]+)\))?(?:\s+of\s+this\s+section)?/gi, kind: 'cfr-paragraph' },
  { re: /(?:§|\bsection)\s*(\d+)\.(\d+)(?:\s*\(([a-z0-9]+)\))?/gi, kind: 'cfr-section' },
  { re: /\bs\.?\s*(\d+)\.(\d+)\s*(?:\(([0-9a-z]+)\))?/gi, kind: 'wis-stat' },
  { re: /\bWis\.?\s*Admin\.?\s*Code\s*(?:§|ch\.?|section)?\s*([A-Z]{2,4}\s*\d+(?:\.\d+)?)/gi, kind: 'wis-admin-code' },
];

/** Scan text for cross-references. Deduplicated by raw match. */
export function detectReferences(
  text: string,
  context?: { readonly cfrTitle?: number; readonly cfrPart?: number; readonly cfrSection?: string },
): DetectedReference[] {
  const found = new Map<string, DetectedReference>();
  for (const { re, kind } of REF_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const raw = m[0].trim();
      if (found.has(raw)) continue;
      if (kind === 'cfr-paragraph') {
        found.set(raw, {
          raw,
          kind,
          resolvable: Boolean(context?.cfrTitle && context?.cfrPart && context?.cfrSection),
          cfr: {
            ...(context?.cfrTitle !== undefined ? { title: context.cfrTitle } : {}),
            ...(context?.cfrPart !== undefined ? { part: context.cfrPart } : {}),
            ...(context?.cfrSection !== undefined ? { section: context.cfrSection } : {}),
            paragraph: m[2] ? `${m[1]}/${m[2]}` : m[1]!,
          },
        });
      } else if (kind === 'cfr-section') {
        const part = Number(m[1]);
        const section = `${m[1]}.${m[2]}`;
        found.set(raw, {
          raw,
          kind,
          resolvable: Boolean(context?.cfrTitle),
          cfr: {
            ...(context?.cfrTitle !== undefined ? { title: context.cfrTitle } : {}),
            part,
            section,
          },
        });
      } else {
        found.set(raw, { raw, kind, resolvable: false });
      }
    }
  }
  return [...found.values()];
}

export interface EcfrSectionArgs {
  readonly title: number;
  readonly part: number;
  readonly section: string;
  /** ISO date; the versioner needs a point in time. Defaults to today (UTC). */
  readonly date?: string;
}

export interface ResolvedReference {
  readonly ok: true;
  /** The exact URL the span was fetched from -- record THIS as provenance. */
  readonly url: string;
  readonly structured: string;
  readonly flat: string;
}

export interface ResolveFailure {
  readonly ok: false;
  readonly url: string;
  readonly reason: string;
}

const ECFR_API = 'https://www.ecfr.gov/api/versioner/v1/full';

export function ecfrSectionUrl(args: EcfrSectionArgs): string {
  const date = args.date ?? new Date().toISOString().slice(0, 10);
  return `${ECFR_API}/${date}/title-${args.title}.xml?part=${args.part}&section=${args.section}`;
}

/**
 * The header that makes the versioner API answer. `br, gzip` mirrors what a
 * browser sends; undici transparently decompresses the response. Without it the
 * endpoint returns 406 (verified).
 */
export const ECFR_HEADERS: Readonly<Record<string, string>> = {
  'Accept-Encoding': 'gzip, deflate, br',
  Accept: 'application/xml, text/xml',
};

export async function resolveEcfrSection(
  fetcher: Fetcher,
  args: EcfrSectionArgs,
): Promise<ResolvedReference | ResolveFailure> {
  const url = ecfrSectionUrl(args);
  const outcome = await fetcher({ url, headers: ECFR_HEADERS });
  if (outcome.kind !== 'ok' && outcome.kind !== 'moved') {
    const reason =
      outcome.kind === 'unreachable'
        ? outcome.reason
        : outcome.kind === 'blocked'
          ? outcome.reason
          : `HTTP ${'status' in outcome ? outcome.status : '?'}`;
    return { ok: false, url, reason };
  }
  const body = outcome.body;
  // eCFR XML uses <P>, <HEAD>, <DIV*> -- parseStructure treats unknown tags as
  // inline containers, which flattens each <P> into its own paragraph. Good
  // enough to read paragraph (a) vs (b); the flat text is what spans match on.
  const structured = renderStructured(body);
  const flat = flattenText(body);
  if (flat.length < 40) {
    return { ok: false, url, reason: 'response had no readable body' };
  }
  return { ok: true, url, structured, flat };
}

/** Pull the labelled sub-paragraphs out of a resolved CFR section's flat text. */
export function splitCfrParagraphs(flat: string): { label: string; text: string }[] {
  const out: { label: string; text: string }[] = [];
  const re = /\(([a-z]|\d+)\)\s/gi;
  const marks: { label: string; index: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(flat)) !== null) marks.push({ label: m[1]!, index: m.index });
  for (let i = 0; i < marks.length; i += 1) {
    const start = marks[i]!.index;
    const end = i + 1 < marks.length ? marks[i + 1]!.index : flat.length;
    out.push({ label: marks[i]!.label, text: flat.slice(start, end).trim() });
  }
  return out;
}
