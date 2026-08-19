/**
 * Income yardsticks the eligibility rules measure against.
 *
 * ============================ VERIFY BEFORE LAUNCH ==========================
 * Every table below carries a `verified` flag. Tables with `verified: false`
 * were drafted from secondary knowledge and have NOT been checked against the
 * cited source. They are structurally correct and good enough to develop and
 * test against, but they must be confirmed against `source` before this app is
 * shown to the public -- a wrong threshold here silently produces a wrong
 * eligibility answer for a real person.
 *
 * See docs/data-authoring.md for the verification procedure. The UI surfaces an
 * "unverified data" banner for as long as any table or program record here is
 * unverified, so this cannot be forgotten by accident.
 * ============================================================================
 */

export interface IncomeTable {
  readonly id: string;
  readonly name: string;
  /** Annual dollars, indexed by household size 1..8. */
  readonly bySize: readonly number[];
  /** Added per household member beyond 8. */
  readonly perAdditionalPerson: number;
  /** Program year these figures apply to. */
  readonly effectiveYear: number;
  readonly source: string;
  readonly verified: boolean;
}

/**
 * HHS Poverty Guidelines, 48 contiguous states and DC. The base for SNAP
 * (130% FPL), WIC and reduced-price school meals (185% FPL), and free school
 * meals (130% FPL).
 */
export const FPL_2025: IncomeTable = {
  id: 'fpl',
  name: 'Federal Poverty Level',
  bySize: [15_650, 21_150, 26_650, 32_150, 37_650, 43_150, 48_650, 54_150],
  perAdditionalPerson: 5_500,
  effectiveYear: 2025,
  source: 'https://aspe.hhs.gov/topics/poverty-economic-mobility/poverty-guidelines',
  verified: false,
};

/**
 * Wisconsin State Median Income. WHEAP (Wisconsin's LIHEAP) sets its limit at
 * 60% SMI, so these figures are already the 60% values, not full SMI.
 */
export const WI_SMI_60_2025: IncomeTable = {
  id: 'wi-smi',
  name: '60% of Wisconsin State Median Income',
  bySize: [32_400, 42_400, 52_300, 62_300, 72_200, 82_100, 84_000, 85_900],
  perAdditionalPerson: 1_900,
  effectiveYear: 2025,
  source: 'https://energyandhousing.wi.gov/Pages/AgencyResources/EnergyAssistance.aspx',
  verified: false,
};

/**
 * HUD Area Median Income for the Madison, WI HUD Metro FMR Area (Dane County).
 *
 * HUD publishes a four-person median and derives other household sizes from it
 * with fixed adjustment factors, so that is how it is modelled here rather than
 * as a flat table -- it keeps the derivation correct even when only the base
 * figure is updated.
 */
export const DANE_AMI_2025 = {
  id: 'dane-ami',
  name: 'Madison, WI area median income',
  fourPersonMedian: 124_000,
  /** HUD household-size adjustment, as a fraction of the four-person figure. */
  sizeAdjustment: [0.7, 0.8, 0.9, 1.0, 1.08, 1.16, 1.24, 1.32] as const,
  /** Beyond 8 people HUD adds 8 percentage points per person. */
  perAdditionalPersonFactor: 0.08,
  effectiveYear: 2025,
  source: 'https://www.huduser.gov/portal/datasets/il.html',
  verified: false,
} as const;

/** Every table in this file, for the "is our data verified?" check. */
export const ALL_INCOME_TABLES = [FPL_2025, WI_SMI_60_2025, DANE_AMI_2025] as const;
