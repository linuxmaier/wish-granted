/**
 * Deterministic descriptive-field extraction from a page's *normalized* text.
 *
 * "Normalized" means the output of scripts/check-sources/lib/normalize.ts -- the
 * same reduction #7 uses: scripts/styles/forms/nav/footer stripped, entities
 * decoded, dates and opaque tokens scrubbed, whitespace collapsed. Running the
 * extractors over that instead of raw HTML is what makes them usable at all:
 * against raw HTML a phone regex matches New Relic application IDs and analytics
 * blobs (verified while building this -- see the PR description). Against
 * normalized text it matches phone numbers.
 *
 * The bar here is deliberately low and honest. This module does NOT try to pick
 * "the" application phone number off a page with five of them, or rewrite a
 * summary. It finds candidates, records exactly where each came from, and lets
 * classify.ts decide whether that is a proposal a human should see or noise to
 * drop. docs/eligibility-extraction.md's tiering calls descriptive fields "the
 * automatable half" -- automatable, not automatic.
 */

/**
 * Requires real separators (a hyphen, dot, or space) between groups so a bare
 * 10-digit identifier does not match. Accepts an optional leading `1`, and
 * `(608)` or `608` for the area code.
 */
const PHONE_RE =
  /(?:\+?1[-.\s])?(?:\(\d{3}\)|\d{3})[-.\s]\d{3}[-.\s]\d{4}(?![-.\s]?\d)/g;

export interface PhoneMatch {
  /** As it appeared on the page, e.g. `(608) 266-3509`. */
  readonly raw: string;
  /** Digits only, leading country `1` dropped -- the comparison key. */
  readonly normalized: string;
  /** Character offset into the normalized text, for excerpting. */
  readonly index: number;
}

export function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

export function extractPhones(text: string): PhoneMatch[] {
  const out: PhoneMatch[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(PHONE_RE)) {
    const raw = m[0].trim();
    const normalized = normalizePhone(raw);
    if (normalized.length !== 10) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push({ raw, normalized, index: m.index ?? 0 });
  }
  return out;
}

/**
 * A window of surrounding text, for provenance. `radius` characters either side
 * of the match, snapped to word boundaries, newlines flattened to spaces.
 */
export function excerptAround(text: string, index: number, matchLength: number, radius = 140): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + matchLength + radius);
  let slice = text.slice(start, end).replace(/\s+/g, ' ').trim();
  if (start > 0) slice = `...${slice}`;
  if (end < text.length) slice = `${slice}...`;
  return slice;
}

export type StatusSignal = 'closed' | 'waitlist' | 'seasonal';

interface StatusPattern {
  readonly signal: StatusSignal;
  readonly re: RegExp;
}

/**
 * Phrases that, on a program's own page, suggest its `status` may not be `open`.
 * Intentionally high-precision and low-recall: a false "go check the status"
 * flag every month is worse than missing one, because it trains the reviewer to
 * skip the section (the same reasoning normalize.ts's docstring gives).
 */
const STATUS_PATTERNS: readonly StatusPattern[] = [
  { signal: 'closed', re: /\b(not (currently )?accepting (new )?applications|no longer accept(ing)?|applications are closed|program (has ended|is closed|has been discontinued)|currently closed to new)\b/i },
  { signal: 'waitlist', re: /\b(placed on a wait[- ]?list|added to (the |a )?wait[- ]?list|wait[- ]?list is (currently )?(open|closed)|join the wait[- ]?list)\b/i },
  { signal: 'seasonal', re: /\b(heating season|applications? (open|accepted) (from|between) \w+ \d|available (only )?(during|between) \w+ (and|through) \w+)\b/i },
];

export interface StatusMatch {
  readonly signal: StatusSignal;
  readonly excerpt: string;
}

export function detectStatusSignals(text: string): StatusMatch[] {
  const out: StatusMatch[] = [];
  const seen = new Set<StatusSignal>();
  for (const { signal, re } of STATUS_PATTERNS) {
    const m = re.exec(text);
    if (!m || seen.has(signal)) continue;
    seen.add(signal);
    out.push({ signal, excerpt: excerptAround(text, m.index, m[0].length) });
  }
  return out;
}
