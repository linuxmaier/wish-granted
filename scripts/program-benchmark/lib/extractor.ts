import type { Program } from '../../../src/domain/program.ts';
import type { Criterion } from '../../../src/domain/criteria.ts';

/**
 * The pipeline-agnostic seam. The benchmark takes an `Extractor` as an
 * argument; it knows nothing about how the record was produced. The
 * deterministic path, the triage path (#68), and the agentic path (#67) each
 * implement this and are scored by the same harness.
 *
 * An extractor is given a source URL and context and returns either a
 * `CandidateRecord` (its best attempt at the program) or an `Abstention` (it
 * declines to produce a record at all -- distinct from emitting a
 * `manualReview` *inside* an eligibility rule, which is a real, scored output).
 */

export interface ExtractionContext {
  readonly programId: string;
  readonly sourceUrl: string;
  readonly sourceName: string;
  /**
   * Whether an ANTHROPIC_API_KEY is present in the environment. An extractor
   * that needs the API MUST check this and throw `MissingApiKeyError` when it
   * is false, so the harness reports SKIPPED rather than a fabricated result
   * (docs/program-benchmark.md, "Honest SKIPPED"; the convention exists because
   * of #5 §4.3 and #63).
   */
  readonly hasApiKey: boolean;
  readonly signal?: AbortSignal;
}

export interface CandidateRecord {
  readonly eligibility: Criterion;
  readonly name?: string;
  readonly administeredBy?: string;
  readonly summary?: string;
  readonly benefit?: string;
  readonly howToApply?: { readonly url?: string; readonly phone?: string };
  readonly requiredDocuments?: readonly string[];
  /** Free-text the extractor wants a reviewer to see. Not scored. */
  readonly notes?: string;
}

export interface Abstention {
  readonly abstained: true;
  readonly reason: string;
}

export type ExtractionResult = CandidateRecord | Abstention;

export type Extractor = (context: ExtractionContext) => Promise<ExtractionResult>;

export function isAbstention(r: ExtractionResult): r is Abstention {
  return (r as Abstention).abstained === true;
}

/** Thrown by an extractor that needs the API when no key is present. */
export class MissingApiKeyError extends Error {
  constructor() {
    super('no ANTHROPIC_API_KEY');
    this.name = 'MissingApiKeyError';
  }
}

/** Thrown by the default extractor: no real pipeline is attached to the harness yet. */
export class ExtractorNotWiredError extends Error {
  constructor() {
    super('no extraction pipeline is wired to this benchmark (see #67 / #68)');
    this.name = 'ExtractorNotWiredError';
  }
}

/**
 * The default. There is no real extractor in this repo yet -- #66 builds the
 * measuring stick, #67/#68 build the things it measures. With no key this
 * throws `MissingApiKeyError` (-> SKIPPED); with a key it throws
 * `ExtractorNotWiredError` (-> reported as NOT WIRED, nothing measured). It
 * never invents an answer.
 */
export const notWiredExtractor: Extractor = async (ctx) => {
  if (!ctx.hasApiKey) throw new MissingApiKeyError();
  throw new ExtractorNotWiredError();
};

/**
 * DIAGNOSTIC ONLY. Returns the ground-truth record for the id. Running the
 * benchmark with this MUST produce zero divergent, zero dangerous, full
 * coverage and all-`match` descriptive -- it is the harness's own identity
 * test, exercised in --self-test and the unit suite. It is not a model and its
 * output is not a measurement of anything.
 */
export function verifiedEchoExtractor(programs: readonly Program[]): Extractor {
  const byId = new Map(programs.map((p) => [p.id, p]));
  return async (ctx) => {
    const p = byId.get(ctx.programId);
    if (!p) return { abstained: true, reason: `no program with id ${ctx.programId}` };
    return {
      eligibility: p.eligibility,
      name: p.name,
      administeredBy: p.administeredBy,
      summary: p.summary,
      benefit: p.benefit,
      howToApply: { url: p.howToApply.url, phone: p.howToApply.phone },
      requiredDocuments: p.requiredDocuments,
    };
  };
}

/**
 * DIAGNOSTIC ONLY. Always abstains. The floor: a pipeline that produces nothing
 * scores zero dangerous wrongness, zero correct extractions, and (because a
 * top-level abstention is still an honest output) full coverage. Useful as a
 * baseline the coordinator can eyeball before spending tokens.
 */
export const abstainAllExtractor: Extractor = async () => ({
  abstained: true,
  reason: 'diagnostic extractor: abstains on everything',
});

export const DIAGNOSTIC_EXTRACTORS = ['not-wired', 'verified-echo', 'abstain-all'] as const;
export type DiagnosticExtractorName = (typeof DIAGNOSTIC_EXTRACTORS)[number];
