import type { Program } from '@/domain/program';
import { CATEGORIES } from '@/domain/program';
import type { Criterion } from '@/domain/criteria';
import { FACT_KEYS } from '@/domain/facts';
import type { FactKey } from '@/domain/facts';

/**
 * The shippable snapshot format (issue #8).
 *
 * Programs are hand-authored TypeScript modules today (`./records.ts`). The app,
 * however, does not load them directly: `npm run build:snapshot` serializes them
 * into `./snapshot.json`, a build-time artifact that is committed to the repo and
 * compiled into the bundle by Vite like any other module. There is no runtime
 * fetch and no code-split boundary -- the whole corpus ships eagerly, which is
 * what keeps the privacy guarantee ("what the client requests must not depend on
 * the user's answers", issue #1) trivially true.
 *
 * Why a compiled artifact rather than just importing `records.ts`:
 *
 * - It is the seam the automated pipeline (#1, #14) writes to. Once records are
 *   ingested rather than hand-typed, the snapshot is still the only thing the app
 *   consumes, so the app never changes shape again.
 * - It carries provenance the raw modules cannot: when it was assembled
 *   (`generatedAt`, consumed by the #44 "data as of" indicator), which format
 *   version produced it (`snapshotVersion`), and -- declared explicitly rather
 *   than left to be re-derived -- the fact vocabulary its rules touch
 *   (`factVocabulary`). That last one is the seam between the pipeline and the
 *   interview model: a rule referencing a fact no question asks strands its
 *   program in "might qualify" forever, so the set is pinned here and checked at
 *   build time.
 * - It is validated as data. `assertValidSnapshot` runs whenever the app, a test,
 *   or the dev server loads `./index.ts`, and `npm run build:snapshot -- --check`
 *   runs it in the build itself, so a malformed snapshot fails the build rather
 *   than shipping.
 *
 * The record shape is `Program` unchanged -- `Program` is already flat and
 * serializable (no closures; `Criterion` is a data tree), so it round-trips
 * through JSON losslessly. `SnapshotRecord` is kept as a distinct name so a
 * later divergence (e.g. an abbreviated-prose variant, or per-record ingestion
 * provenance for #14) is a change here and not a churn across the app.
 */

export const SNAPSHOT_VERSION = 1;

/** One program as it ships. Identical to `Program` in v1; see the note above. */
export type SnapshotRecord = Program;

export interface ProgramSnapshot {
  /**
   * Format version. Bumped only on a breaking change to this schema, so a loader
   * can refuse a snapshot it does not understand rather than mis-read it.
   */
  readonly snapshotVersion: number;
  /**
   * ISO 8601 UTC instant the snapshot was assembled from the source records.
   *
   * This is the field issue #44's "data as of" indicator reads. It means
   * *assembled*, not *verified* -- a fresh build says nothing about whether a
   * human has re-read any source page. Verification is per-record
   * (`source.lastVerified`) and `stalePrograms()` covers that half.
   *
   * The generator preserves the previous value when the records are byte-for-byte
   * unchanged, so regeneration is a fixed point and a no-op rebuild produces no
   * diff. It only moves when a record actually changed.
   */
  readonly generatedAt: string;
  /** What produced this file. Provenance, not used programmatically. */
  readonly generator: string;
  /** `records.length`, cross-checked by the validator against the array. */
  readonly recordCount: number;
  /**
   * Every fact key any record's `eligibility` rule references, sorted and unique.
   * Declared rather than derived so the build can validate the pipeline↔interview
   * seam (`tests/data/vocabulary.test.ts`, and `--check`) without walking
   * criterion internals, and so a future compiled-criteria record format can
   * still state its vocabulary.
   */
  readonly factVocabulary: readonly FactKey[];
  readonly records: readonly SnapshotRecord[];
}

export class SnapshotValidationError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(
      `Invalid program snapshot (${problems.length} problem${problems.length === 1 ? '' : 's'}):\n` +
        problems.map((p) => `  - ${p}`).join('\n'),
    );
    this.name = 'SnapshotValidationError';
    this.problems = problems;
  }
}

const JURISDICTIONS = ['city', 'county', 'state', 'federal'] as const;
const PROVIDERS = ['government', 'nonprofit'] as const;
const STATUSES = ['open', 'seasonal', 'waitlist', 'closed'] as const;
const INCOME_SCALES = ['fpl', 'wi-smi', 'dane-ami'] as const;
const COMPARISON_OPS = ['eq', 'neq', 'lt', 'lte', 'gt', 'gte'] as const;
const SET_OPS = ['in', 'notIn', 'includesAny', 'includesAll', 'excludes'] as const;
const FACT_KEY_SET = new Set<string>(FACT_KEYS);
const CATEGORY_SET = new Set<string>(CATEGORIES);

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString);
const HTTP_URL = /^https?:\/\//;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validateCriterion(node: unknown, at: string, out: string[]): void {
  if (!isObject(node)) {
    out.push(`${at}: expected a criterion object, got ${node === null ? 'null' : typeof node}`);
    return;
  }
  const kind = node.kind;
  switch (kind) {
    case 'always':
      return;
    case 'manualReview':
      if (!isNonEmptyString(node.note)) out.push(`${at}: manualReview needs a non-empty "note"`);
      return;
    case 'compare': {
      if (!FACT_KEY_SET.has(node.fact as string)) out.push(`${at}: unknown fact ${JSON.stringify(node.fact)}`);
      if (!COMPARISON_OPS.includes(node.op as never)) out.push(`${at}: bad compare op ${JSON.stringify(node.op)}`);
      const t = typeof node.value;
      if (t !== 'string' && t !== 'number' && t !== 'boolean') {
        out.push(`${at}: compare "value" must be string | number | boolean, got ${t}`);
      }
      return;
    }
    case 'set': {
      if (!FACT_KEY_SET.has(node.fact as string)) out.push(`${at}: unknown fact ${JSON.stringify(node.fact)}`);
      if (!SET_OPS.includes(node.op as never)) out.push(`${at}: bad set op ${JSON.stringify(node.op)}`);
      if (!isStringArray(node.values) || node.values.length === 0) {
        out.push(`${at}: set "values" must be a non-empty string array`);
      }
      return;
    }
    case 'incomeAtOrBelow': {
      if (!INCOME_SCALES.includes(node.scale as never)) out.push(`${at}: bad income scale ${JSON.stringify(node.scale)}`);
      if (!isFiniteNumber(node.percent) || node.percent <= 0) out.push(`${at}: incomeAtOrBelow needs a positive "percent"`);
      return;
    }
    case 'allOf':
    case 'anyOf': {
      if (!Array.isArray(node.of) || node.of.length === 0) {
        out.push(`${at}: ${kind} needs a non-empty "of" array`);
        return;
      }
      node.of.forEach((child, i) => validateCriterion(child, `${at}.${kind}[${i}]`, out));
      return;
    }
    case 'not':
      validateCriterion(node.of, `${at}.not`, out);
      return;
    default:
      out.push(`${at}: unknown criterion kind ${JSON.stringify(kind)}`);
  }
}

function validateRecord(rec: unknown, at: string, out: string[]): void {
  if (!isObject(rec)) {
    out.push(`${at}: expected a record object`);
    return;
  }
  const label = isString(rec.id) ? `${at} (${rec.id})` : at;

  if (!isNonEmptyString(rec.id) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(rec.id)) {
    out.push(`${label}: "id" must be a non-empty kebab-case slug`);
  }
  if (!isNonEmptyString(rec.name)) out.push(`${label}: "name" is required`);
  if (!isNonEmptyString(rec.administeredBy)) out.push(`${label}: "administeredBy" is required`);
  if (!JURISDICTIONS.includes(rec.jurisdiction as never)) out.push(`${label}: bad "jurisdiction" ${JSON.stringify(rec.jurisdiction)}`);
  if (!PROVIDERS.includes(rec.provider as never)) out.push(`${label}: bad "provider" ${JSON.stringify(rec.provider)}`);
  if (!STATUSES.includes(rec.status as never)) out.push(`${label}: bad "status" ${JSON.stringify(rec.status)}`);

  if (!Array.isArray(rec.categories) || rec.categories.length === 0) {
    out.push(`${label}: "categories" must have at least one entry`);
  } else {
    for (const c of rec.categories) {
      if (!CATEGORY_SET.has(c as string)) out.push(`${label}: unknown category ${JSON.stringify(c)}`);
    }
  }

  // Prose thresholds mirror tests/data/vocabulary.test.ts so an ingested record
  // with an empty summary cannot slip through the build.
  if (!isString(rec.summary) || rec.summary.length <= 20) out.push(`${label}: "summary" is too short (> 20 chars)`);
  if (!isString(rec.benefit) || rec.benefit.length <= 10) out.push(`${label}: "benefit" is too short (> 10 chars)`);

  validateCriterion(rec.eligibility, `${label}.eligibility`, out);

  if (rec.eligibilityCaveats !== undefined && !isStringArray(rec.eligibilityCaveats)) {
    out.push(`${label}: "eligibilityCaveats" must be a string array when present`);
  }
  if (rec.requiredDocuments !== undefined && !isStringArray(rec.requiredDocuments)) {
    out.push(`${label}: "requiredDocuments" must be a string array when present`);
  }
  if (rec.seasonalNote !== undefined && !isString(rec.seasonalNote)) {
    out.push(`${label}: "seasonalNote" must be a string when present`);
  }
  if (rec.status === 'seasonal' && !isNonEmptyString(rec.seasonalNote)) {
    out.push(`${label}: a seasonal program must explain the restriction in "seasonalNote"`);
  }

  if (!isObject(rec.howToApply)) {
    out.push(`${label}: "howToApply" object is required`);
  } else {
    if (!isString(rec.howToApply.url) || !HTTP_URL.test(rec.howToApply.url)) {
      out.push(`${label}: "howToApply.url" must be an http(s) URL`);
    }
    if (rec.howToApply.phone !== undefined && !isNonEmptyString(rec.howToApply.phone)) {
      out.push(`${label}: "howToApply.phone" must be a non-empty string when present`);
    }
    if (rec.howToApply.steps !== undefined && !isStringArray(rec.howToApply.steps)) {
      out.push(`${label}: "howToApply.steps" must be a string array when present`);
    }
  }

  if (!isObject(rec.source)) {
    out.push(`${label}: "source" object is required`);
  } else {
    if (!isString(rec.source.url) || !HTTP_URL.test(rec.source.url)) {
      out.push(`${label}: "source.url" must be an http(s) URL`);
    }
    if (!isNonEmptyString(rec.source.name)) out.push(`${label}: "source.name" is required`);
    const lv = rec.source.lastVerified;
    if (lv !== null && (!isString(lv) || !ISO_DATE.test(lv))) {
      out.push(`${label}: "source.lastVerified" must be a YYYY-MM-DD string or null`);
    }
  }
}

/** Walks a plain (already-parsed) criterion object, yielding every node. */
function* criterionNodes(node: Record<string, unknown>): Generator<Record<string, unknown>> {
  yield node;
  if ((node.kind === 'allOf' || node.kind === 'anyOf') && Array.isArray(node.of)) {
    for (const child of node.of) if (isObject(child)) yield* criterionNodes(child);
  }
  if (node.kind === 'not' && isObject(node.of)) yield* criterionNodes(node.of);
}

/** Every fact key a parsed criterion object could consult. Mirrors `factsReferenced`. */
export function factsInParsedCriterion(node: Record<string, unknown>): Set<string> {
  const keys = new Set<string>();
  for (const n of criterionNodes(node)) {
    if ((n.kind === 'compare' || n.kind === 'set') && isString(n.fact)) keys.add(n.fact);
    if (n.kind === 'incomeAtOrBelow') {
      keys.add('annualHouseholdIncome');
      keys.add('householdSize');
    }
  }
  return keys;
}

/**
 * Returns a list of everything wrong with `data` as a snapshot. Empty means valid.
 * Pure and side-effect free -- `assertValidSnapshot` is the throwing wrapper.
 */
export function validateSnapshot(data: unknown): string[] {
  const out: string[] = [];
  if (!isObject(data)) return ['snapshot is not an object'];

  if (data.snapshotVersion !== SNAPSHOT_VERSION) {
    out.push(`snapshotVersion is ${JSON.stringify(data.snapshotVersion)}, expected ${SNAPSHOT_VERSION}`);
  }
  if (!isString(data.generatedAt) || !ISO_INSTANT.test(data.generatedAt) || Number.isNaN(Date.parse(data.generatedAt))) {
    out.push(`generatedAt must be an ISO 8601 UTC instant (got ${JSON.stringify(data.generatedAt)})`);
  }
  if (!isNonEmptyString(data.generator)) out.push('generator must be a non-empty string');

  if (!isStringArray(data.factVocabulary)) {
    out.push('factVocabulary must be a string array');
  } else {
    const unknown = data.factVocabulary.filter((f) => !FACT_KEY_SET.has(f));
    if (unknown.length) out.push(`factVocabulary has unknown fact keys: ${unknown.join(', ')}`);
    const sorted = [...data.factVocabulary].sort();
    if (JSON.stringify(sorted) !== JSON.stringify(data.factVocabulary)) {
      out.push('factVocabulary must be sorted');
    }
    if (new Set(data.factVocabulary).size !== data.factVocabulary.length) {
      out.push('factVocabulary has duplicate entries');
    }
  }

  if (!Array.isArray(data.records) || data.records.length === 0) {
    out.push('records must be a non-empty array');
    return out;
  }

  data.records.forEach((rec, i) => validateRecord(rec, `records[${i}]`, out));

  const ids = data.records.filter(isObject).map((r) => r.id).filter(isString);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) out.push(`duplicate record ids: ${[...new Set(dupes)].join(', ')}`);

  if (data.recordCount !== data.records.length) {
    out.push(`recordCount is ${JSON.stringify(data.recordCount)} but there are ${data.records.length} records`);
  }

  // Cross-check the declared vocabulary against what the rules actually touch.
  if (isStringArray(data.factVocabulary)) {
    const referenced = new Set<string>();
    for (const rec of data.records) {
      if (isObject(rec) && isObject(rec.eligibility)) {
        for (const f of factsInParsedCriterion(rec.eligibility)) referenced.add(f);
      }
    }
    const declared = new Set(data.factVocabulary);
    const missing = [...referenced].filter((f) => !declared.has(f)).sort();
    const extra = [...declared].filter((f) => !referenced.has(f)).sort();
    if (missing.length) out.push(`factVocabulary is missing facts the rules reference: ${missing.join(', ')}`);
    if (extra.length) out.push(`factVocabulary declares facts no rule references: ${extra.join(', ')}`);
  }

  return out;
}

export function assertValidSnapshot(data: unknown): asserts data is ProgramSnapshot {
  const problems = validateSnapshot(data);
  if (problems.length) throw new SnapshotValidationError(problems);
}
