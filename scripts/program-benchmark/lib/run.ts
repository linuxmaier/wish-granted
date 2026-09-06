import type { Program } from '../../../src/domain/program.ts';
import { partitionPrograms, type CasePartition } from './cases.ts';
import {
  MissingApiKeyError,
  ExtractorNotWiredError,
  type Extractor,
  type ExtractionContext,
} from './extractor.ts';
import { scoreCase, type CaseScore } from './score.ts';

/**
 * The benchmark loop. Pipeline-agnostic: it is handed an `Extractor` and a set
 * of `Program` records and does not care how the extractor works. #67 (agentic)
 * and #68 (triage) and the deterministic path all plug in here.
 *
 * It NEVER calls a model itself. If the extractor throws `MissingApiKeyError`
 * the case is recorded as `skipped-no-key`; the run reports SKIPPED and
 * measures nothing (docs/program-benchmark.md, "Honest SKIPPED").
 */

export interface RunOptions {
  readonly extractor: Extractor;
  readonly programs: readonly Program[];
  readonly hasApiKey: boolean;
  /** Label for the report header, e.g. the extractor's name. */
  readonly extractorLabel?: string;
  /** Max extractor calls in flight. Default 4 -- polite if the extractor fetches. */
  readonly concurrency?: number;
  readonly onCase?: (score: CaseScore) => void;
}

export interface BenchmarkRun {
  readonly extractorLabel: string;
  readonly hasApiKey: boolean;
  readonly scores: readonly CaseScore[];
  readonly partition: CasePartition;
}

async function pool<T>(items: readonly T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  const run = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      await worker(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, run));
}

export async function runBenchmark(opts: RunOptions): Promise<BenchmarkRun> {
  const partition = partitionPrograms(opts.programs);
  const work: { kind: 'scored' | 'abstention-only'; case: CasePartition['scored'][number] }[] = [
    ...partition.scored.map((c) => ({ kind: 'scored' as const, case: c })),
    ...partition.abstentionOnly.map((c) => ({ kind: 'abstention-only' as const, case: c })),
  ];

  const scores: CaseScore[] = new Array(work.length);

  await pool(work, opts.concurrency ?? 4, async (item, index) => {
    const ctx: ExtractionContext = {
      programId: item.case.programId,
      sourceUrl: item.case.sourceUrl,
      sourceName: item.case.sourceName,
      hasApiKey: opts.hasApiKey,
    };

    let result: Parameters<typeof scoreCase>[0]['result'];
    try {
      result = await opts.extractor(ctx);
    } catch (err) {
      if (err instanceof MissingApiKeyError) {
        result = { error: 'skipped-no-key', message: 'no ANTHROPIC_API_KEY' };
      } else if (err instanceof ExtractorNotWiredError) {
        result = { error: 'not-wired', message: err.message };
      } else {
        result = { error: 'extractor-error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    const score = scoreCase({ case: item.case, kind: item.kind, result });
    scores[index] = score;
    opts.onCase?.(score);
  });

  return {
    extractorLabel: opts.extractorLabel ?? 'unnamed extractor',
    hasApiKey: opts.hasApiKey,
    scores,
    partition,
  };
}
