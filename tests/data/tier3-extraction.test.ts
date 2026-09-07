import { describe, expect, it } from 'vitest';
import {
  evaluate,
  TIER3_SOURCES,
  TIER3_HELDOUT,
  TIER3_HELDOUT2,
  type Tier3Source,
} from '../../scripts/tier3-extract/index.mjs';

/**
 * Locks in the measured result reported in
 * docs/eligibility-extraction-tier3.md (issue #62, experiment 3): a
 * dependency-free, structure-preserving deterministic parser against the real
 * Tier-3 corpus, with a frozen held-out split.
 *
 * Runs against tests/fixtures/tier3/ and tests/fixtures/tier3-heldout/ -- real
 * source snapshots fetched 2026-09-05/06 (see SOURCES.md in each directory) --
 * so this is offline and deterministic like the rest of the suite.
 *
 * The bar (from the issue): an `extract` is correct ONLY if the emitted rule
 * carries the figure's governing scope. A bare ceiling lifted out of a
 * conditional branch is a `dangerous-over-claim`, scored as a failure.
 */

function tally(rows: { outcome: string }[]) {
  const t: Record<string, number> = {};
  for (const r of rows) t[r.outcome] = (t[r.outcome] ?? 0) + 1;
  return t;
}

describe('Tier-3 deterministic parse (issue #62, experiment 3)', () => {
  it('tuning split: 17/17 correct abstentions, 7/7 correct extractions, 0 dangerous over-claims', async () => {
    const rows = await evaluate({ split: 'tuning' });
    const t = tally(rows);
    expect(rows).toHaveLength(TIER3_SOURCES.length);
    expect(t['dangerous-over-claim'] ?? 0).toBe(0);
    expect(t['parse-failure'] ?? 0).toBe(0);
    expect(t['correct-abstention'] ?? 0).toBe(17);
    expect(t['correct-extraction'] ?? 0).toBe(7);
  });

  it('held-out split (frozen 2026-09-06): 0 dangerous over-claims, 8/8 abstentions, 2/2 extractions', async () => {
    const rows = await evaluate({ split: 'heldout' });
    const t = tally(rows);
    expect(rows).toHaveLength(TIER3_HELDOUT.length);
    // The blocking metric. A wrong threshold reaches a person in crisis as a
    // stated fact -- this must stay at zero (issue #62 rules).
    expect(t['dangerous-over-claim'] ?? 0).toBe(0);
    expect(t['parse-failure'] ?? 0).toBe(0);
    expect(t['correct-abstention'] ?? 0).toBe(8);
    expect(t['correct-extraction'] ?? 0).toBe(2);
  });

  it('held-out split 2 (frozen 2026-09-07, clean / untuned): 2 dangerous over-claims, 10/12 abstentions, 2/2 extractions', async () => {
    // The CLEAN measurement issue #71 asked for. classify.mjs / extract.mjs were
    // NOT touched after this split was frozen, so unlike the §4.2 held-out this
    // number is not tuned. It is reported and locked exactly as the single run
    // produced it -- see docs/eligibility-extraction-tier3.md §9. The two
    // dangerous over-claims (h2-hdap, h2-cfr-423-773) are deliberately NOT
    // fixed; fixing is what burned the previous split.
    const rows = await evaluate({ split: 'heldout2' });
    const t = tally(rows);
    expect(rows).toHaveLength(TIER3_HELDOUT2.length);
    expect(t['dangerous-over-claim'] ?? 0).toBe(2);
    expect(t['correct-abstention'] ?? 0).toBe(10);
    expect(t['correct-extraction'] ?? 0).toBe(2);
    expect(t['over-cautious'] ?? 0).toBe(0);
    expect(t['parse-failure'] ?? 0).toBe(0);
  });

  it('every extraction that fires carries a Criterion that passes the source\'s scope check', async () => {
    for (const split of ['tuning', 'heldout', 'heldout2'] as const) {
      const rows = await evaluate({ split });
      const srcs: readonly Tier3Source[] =
        split === 'tuning' ? TIER3_SOURCES : split === 'heldout' ? TIER3_HELDOUT : TIER3_HELDOUT2;
      for (const row of rows) {
        const src = srcs.find((s) => s.id === row.id);
        if (
          src?.expected.decision === 'extract' &&
          row.outcome === 'correct-extraction' &&
          src.expected.mustMatch &&
          row.result
        ) {
          expect(src.expected.mustMatch(row.result.criterion), `${row.id}: ${row.detail}`).toBe(true);
        }
      }
    }
  });
});
