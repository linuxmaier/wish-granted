import type { IncomeScale } from '@/domain/criteria';
import { DANE_AMI_2025, FPL_2025, WI_SMI_60_2025 } from '@/data/reference/income-tables';
import type { IncomeTable } from '@/data/reference/income-tables';

/**
 * Resolves "X% of <some income scale> for a household of N" to a dollar figure.
 * Isolated from the evaluator so the tables can be updated -- or swapped for a
 * fetched copy -- without touching rule evaluation.
 */

function fromTable(table: IncomeTable, householdSize: number): number {
  const clamped = Math.max(1, Math.floor(householdSize));
  const listed = table.bySize[clamped - 1];
  if (listed !== undefined) return listed;

  const last = table.bySize[table.bySize.length - 1];
  // A table is never empty in practice, but noUncheckedIndexedAccess makes the
  // compiler insist we say what happens if it were.
  if (last === undefined) throw new Error(`Income table ${table.id} has no entries`);
  return last + (clamped - table.bySize.length) * table.perAdditionalPerson;
}

function daneAmi(householdSize: number): number {
  const clamped = Math.max(1, Math.floor(householdSize));
  const { fourPersonMedian, sizeAdjustment, perAdditionalPersonFactor } = DANE_AMI_2025;
  const listed = sizeAdjustment[clamped - 1];
  const factor =
    listed ??
    sizeAdjustment[sizeAdjustment.length - 1]! +
      (clamped - sizeAdjustment.length) * perAdditionalPersonFactor;
  return Math.round(fourPersonMedian * factor);
}

/** The 100% figure for `scale` at a given household size, in annual dollars. */
export function baseAmount(scale: IncomeScale, householdSize: number): number {
  switch (scale) {
    case 'fpl':
      return fromTable(FPL_2025, householdSize);
    case 'wi-smi':
      // The stored table is already the 60% figure, so 100% of the scale that
      // rules refer to as "wi-smi" is that number. Rules therefore express the
      // WHEAP limit as `incomeAtOrBelow('wi-smi', 100)`.
      return fromTable(WI_SMI_60_2025, householdSize);
    case 'dane-ami':
      return daneAmi(householdSize);
  }
}

/** The dollar cutoff for `percent`% of `scale` at a given household size. */
export function incomeLimit(
  scale: IncomeScale,
  percent: number,
  householdSize: number,
): number {
  return Math.round((baseAmount(scale, householdSize) * percent) / 100);
}

export const SCALE_NAMES: Readonly<Record<IncomeScale, string>> = {
  fpl: 'the federal poverty level',
  'wi-smi': 'the Wisconsin energy-assistance income limit',
  'dane-ami': 'the Madison area median income',
};

/** True when every income table has been checked against its source. */
export function allIncomeTablesVerified(): boolean {
  return [FPL_2025, WI_SMI_60_2025, DANE_AMI_2025].every((t) => t.verified);
}
