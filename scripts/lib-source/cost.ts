/**
 * Per-source cost instrumentation.
 *
 * The issue requires the real per-source cost be *measured, not estimated*.
 * This pipeline never runs a model in this repo's CI, so what we can do here is
 * make the measurement fall out for free the moment the coordinator runs it
 * live: every model response's `usage` block is fed to a `CostMeter`, one meter
 * per source, and the run report prints calls / tokens / cache hits / dollars
 * per source and in total.
 *
 * Price table carried over from the retired eval harness (Sonnet 5, the
 * model this pipeline calls -- see anthropic-client.ts), which cites
 * docs/archive/eligibility-extraction.md Section 6.1. If that file's rates move, move
 * these with them.
 */

export interface ModelUsage {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly cache_creation_input_tokens?: number;
  readonly cache_read_input_tokens?: number;
}

export const PRICE = {
  inputPerMTok: 2.0,
  outputPerMTok: 10.0,
  cacheWritePerMTok: 2.5,
  cacheReadPerMTok: 0.2,
} as const;

export interface CostSummary {
  readonly calls: number;
  readonly cacheHits: number;
  readonly freshInputTokens: number;
  readonly cacheWriteTokens: number;
  readonly cacheReadTokens: number;
  readonly outputTokens: number;
  readonly usd: number;
  /** What it would have cost with no prompt caching -- the counterfactual. */
  readonly usdNoCaching: number;
}

export class CostMeter {
  private calls = 0;
  private cacheHits = 0;
  private freshInput = 0;
  private cacheWrite = 0;
  private cacheRead = 0;
  private output = 0;

  record(usage: ModelUsage): void {
    this.calls += 1;
    this.freshInput += usage.input_tokens ?? 0;
    this.cacheWrite += usage.cache_creation_input_tokens ?? 0;
    this.cacheRead += usage.cache_read_input_tokens ?? 0;
    this.output += usage.output_tokens ?? 0;
    if ((usage.cache_read_input_tokens ?? 0) > 0) this.cacheHits += 1;
  }

  summary(): CostSummary {
    const perM = (n: number, price: number) => (n / 1_000_000) * price;
    const usd =
      perM(this.freshInput, PRICE.inputPerMTok) +
      perM(this.cacheWrite, PRICE.cacheWritePerMTok) +
      perM(this.cacheRead, PRICE.cacheReadPerMTok) +
      perM(this.output, PRICE.outputPerMTok);
    const usdNoCaching =
      perM(this.freshInput + this.cacheWrite + this.cacheRead, PRICE.inputPerMTok) +
      perM(this.output, PRICE.outputPerMTok);
    return {
      calls: this.calls,
      cacheHits: this.cacheHits,
      freshInputTokens: this.freshInput,
      cacheWriteTokens: this.cacheWrite,
      cacheReadTokens: this.cacheRead,
      outputTokens: this.output,
      usd,
      usdNoCaching,
    };
  }
}

export function sumCost(summaries: readonly CostSummary[]): CostSummary {
  const acc = {
    calls: 0, cacheHits: 0, freshInputTokens: 0, cacheWriteTokens: 0,
    cacheReadTokens: 0, outputTokens: 0, usd: 0, usdNoCaching: 0,
  };
  for (const s of summaries) {
    acc.calls += s.calls;
    acc.cacheHits += s.cacheHits;
    acc.freshInputTokens += s.freshInputTokens;
    acc.cacheWriteTokens += s.cacheWriteTokens;
    acc.cacheReadTokens += s.cacheReadTokens;
    acc.outputTokens += s.outputTokens;
    acc.usd += s.usd;
    acc.usdNoCaching += s.usdNoCaching;
  }
  return acc;
}
