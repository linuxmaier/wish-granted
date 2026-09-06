/**
 * Descriptive-field accuracy (docs/program-benchmark.md, "Descriptive
 * accuracy"). Lower stakes than eligibility and genuinely automatable (issue
 * #14). Exact string match is too strict for prose, so each field type gets a
 * comparison suited to it, and every one reports a three-way verdict rather
 * than a number:
 *
 *   match      indistinguishable for a reader's purposes
 *   near       same fact, differently worded / formatted
 *   miss       wrong, or missing where the verified record has a value
 *   not-scored the candidate did not emit this field (counts toward coverage
 *              of the field, not toward accuracy)
 *
 * Comparisons:
 *   - phone: reduce to digits, drop a leading US country code, compare exactly.
 *   - url:   lowercase, drop scheme / `www.` / trailing slash / fragment;
 *            `match` if equal, `near` if same host, else `miss`.
 *   - name, administeredBy: case/space/punctuation-insensitive equality for
 *     `match`; Dice coefficient over word tokens >= 0.6 for `near`.
 *   - summary, benefit: Dice coefficient over word tokens. >= 0.7 match,
 *     >= 0.4 near. This is a SIMILARITY proxy, not a correctness check: a
 *     fluent paraphrase scores match/near, and a subtly wrong benefit amount
 *     inside otherwise-correct prose can still score match. Stated plainly in
 *     the docs.
 *   - requiredDocuments: set overlap; `match` if the normalised sets are equal,
 *     `near` if Jaccard >= 0.5.
 */

export type DescriptiveVerdict = 'match' | 'near' | 'miss' | 'not-scored';

export interface DescriptiveFieldResult {
  readonly field: string;
  readonly verdict: DescriptiveVerdict;
  readonly detail: string;
}

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[‘’“”]/g, "'")
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s: string): string[] {
  const n = normalizeText(s);
  return n ? n.split(' ') : [];
}

/** Sørensen–Dice coefficient over a token multiset (bigrams for short fields). */
function dice(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const count = new Map<string, number>();
  for (const t of a) count.set(t, (count.get(t) ?? 0) + 1);
  let overlap = 0;
  for (const t of b) {
    const c = count.get(t) ?? 0;
    if (c > 0) {
      overlap += 1;
      count.set(t, c - 1);
    }
  }
  return (2 * overlap) / (a.length + b.length);
}

function wordBigrams(s: string): string[] {
  const t = tokens(s);
  if (t.length < 2) return t;
  const grams: string[] = [];
  for (let i = 0; i < t.length - 1; i++) grams.push(`${t[i]} ${t[i + 1]}`);
  return grams;
}

export function comparePhone(verified: string | undefined, candidate: string | undefined): DescriptiveFieldResult {
  return compareOptional('howToApply.phone', verified, candidate, (v, c) => {
    const digits = (x: string) => x.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
    const dv = digits(v);
    const dc = digits(c);
    if (dv === dc) return { verdict: 'match', detail: `${dc}` };
    return { verdict: 'miss', detail: `verified ${dv}, candidate ${dc}` };
  });
}

export function compareUrl(verified: string | undefined, candidate: string | undefined): DescriptiveFieldResult {
  return compareOptional('howToApply.url', verified, candidate, compareUrlValues);
}

export function compareUrlValues(v: string, c: string): { verdict: DescriptiveVerdict; detail: string } {
  const canon = (x: string) =>
    x
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/#.*$/, '')
      .replace(/\/+$/, '');
  const cv = canon(v);
  const cc = canon(c);
  if (cv === cc) return { verdict: 'match', detail: cc };
  const host = (x: string) => x.split('/')[0];
  if (host(cv) === host(cc)) return { verdict: 'near', detail: `same host, different path: verified ${cv}, candidate ${cc}` };
  return { verdict: 'miss', detail: `verified ${cv}, candidate ${cc}` };
}

export function compareShortText(field: string, verified: string | undefined, candidate: string | undefined): DescriptiveFieldResult {
  return compareOptional(field, verified, candidate, (v, c) => {
    if (normalizeText(v) === normalizeText(c)) return { verdict: 'match', detail: 'exact (normalised)' };
    const d = Math.max(dice(tokens(v), tokens(c)), dice(wordBigrams(v), wordBigrams(c)));
    if (d >= 0.6) return { verdict: 'near', detail: `Dice ${d.toFixed(2)}` };
    return { verdict: 'miss', detail: `Dice ${d.toFixed(2)}: verified "${v}", candidate "${c}"` };
  });
}

export function compareProse(field: string, verified: string | undefined, candidate: string | undefined): DescriptiveFieldResult {
  return compareOptional(field, verified, candidate, (v, c) => {
    const d = dice(tokens(v), tokens(c));
    if (d >= 0.7) return { verdict: 'match', detail: `token Dice ${d.toFixed(2)}` };
    if (d >= 0.4) return { verdict: 'near', detail: `token Dice ${d.toFixed(2)}` };
    return { verdict: 'miss', detail: `token Dice ${d.toFixed(2)}` };
  });
}

export function compareDocuments(
  verified: readonly string[] | undefined,
  candidate: readonly string[] | undefined,
): DescriptiveFieldResult {
  const field = 'requiredDocuments';
  if (candidate === undefined) {
    return { field, verdict: 'not-scored', detail: 'candidate did not emit this field' };
  }
  if (verified === undefined || verified.length === 0) {
    return {
      field,
      verdict: candidate.length === 0 ? 'match' : 'near',
      detail: 'verified record has no requiredDocuments',
    };
  }
  const vs = new Set(verified.map(normalizeText));
  const cs = new Set(candidate.map(normalizeText));
  const inter = [...vs].filter((x) => cs.has(x)).length;
  const union = new Set([...vs, ...cs]).size;
  const jaccard = union === 0 ? 1 : inter / union;
  if (jaccard === 1) return { field, verdict: 'match', detail: 'sets equal' };
  if (jaccard >= 0.5) return { field, verdict: 'near', detail: `Jaccard ${jaccard.toFixed(2)}` };
  return { field, verdict: 'miss', detail: `Jaccard ${jaccard.toFixed(2)}` };
}

function compareOptional(
  field: string,
  verified: string | undefined,
  candidate: string | undefined,
  cmp: (v: string, c: string) => { verdict: DescriptiveVerdict; detail: string },
): DescriptiveFieldResult {
  if (candidate === undefined || candidate.trim() === '') {
    return { field, verdict: 'not-scored', detail: 'candidate did not emit this field' };
  }
  if (verified === undefined || verified.trim() === '') {
    return { field, verdict: 'not-scored', detail: 'verified record has no value for this field' };
  }
  const { verdict, detail } = cmp(verified, candidate);
  return { field, verdict, detail };
}
