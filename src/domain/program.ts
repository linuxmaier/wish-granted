import type { Criterion } from './criteria';

/**
 * The shape of one assistance program record.
 *
 * Designed so a future ingestion pipeline (Grants.gov, Benefits.gov, WI DHS,
 * Dane County / City of Madison open data, 211 Wisconsin) can populate it
 * without a schema rewrite: everything is flat, serializable, and source-cited.
 * The only field that resists automation is `eligibility`, which is why the
 * criteria language is small and declarative rather than free text.
 */

export type Jurisdiction = 'city' | 'county' | 'state' | 'federal';

export type Provider = 'government' | 'nonprofit';

/**
 * v1 ships the first two. The rest are declared now so adding them later is a
 * data change, not a schema change -- the brief calls for exactly this.
 */
export const CATEGORIES = [
  'housing-utilities',
  'food-basic-needs',
  'childcare-education',
  'health-disability',
  'veterans',
  'small-business',
] as const;

export type Category = (typeof CATEGORIES)[number];

export const V1_CATEGORIES: readonly Category[] = ['housing-utilities', 'food-basic-needs'];

export type ProgramStatus =
  | 'open'
  /** Accepting applications only during part of the year; see `seasonalNote`. */
  | 'seasonal'
  /** Open, but applicants are placed on a waiting list. */
  | 'waitlist'
  /** Not currently accepting applications. Kept in the dataset for the record. */
  | 'closed';

export interface SourceCitation {
  /** The authoritative page these facts were read from. */
  readonly url: string;
  /** Human name of the source, e.g. "Wisconsin DHS -- FoodShare". */
  readonly name: string;
  /**
   * ISO date (YYYY-MM-DD) a human last checked this record against `url`, or
   * null if it has never been verified. Surfaced in the UI: the brief treats
   * data accuracy as a launch requirement, so "we don't know how fresh this is"
   * has to be visible rather than hidden behind a plausible-looking date.
   */
  readonly lastVerified: string | null;
}

export interface HowToApply {
  readonly url: string;
  readonly phone?: string;
  /** Short, ordered, plain-language steps. Two to four is the useful range. */
  readonly steps?: readonly string[];
}

export interface Program {
  /** Stable kebab-case slug. Used in URLs and test fixtures; never reuse one. */
  readonly id: string;
  readonly name: string;
  /** Who actually runs it, e.g. "Wisconsin Department of Health Services". */
  readonly administeredBy: string;
  readonly jurisdiction: Jurisdiction;
  readonly provider: Provider;
  readonly categories: readonly Category[];

  /** One or two plain sentences: what this is, in the applicant's words. */
  readonly summary: string;
  /** What the applicant actually receives -- money, food, a service. */
  readonly benefit: string;

  readonly eligibility: Criterion;
  /**
   * Eligibility conditions the rules engine deliberately does not model --
   * asset tests, work requirements with many exemptions, documentation rules.
   * Always shown alongside a match so a "you qualify" is never overstated.
   */
  readonly eligibilityCaveats?: readonly string[];

  readonly howToApply: HowToApply;
  readonly requiredDocuments?: readonly string[];

  readonly status: ProgramStatus;
  readonly seasonalNote?: string;

  readonly source: SourceCitation;
}

/** Display labels. Kept next to the type so new values are hard to forget. */
export const CATEGORY_LABELS: Readonly<Record<Category, string>> = {
  'housing-utilities': 'Housing & utilities',
  'food-basic-needs': 'Food & basic needs',
  'childcare-education': 'Childcare & education',
  'health-disability': 'Health & disability',
  veterans: 'Veterans',
  'small-business': 'Small business',
};

export const JURISDICTION_LABELS: Readonly<Record<Jurisdiction, string>> = {
  city: 'City of Madison',
  county: 'Dane County',
  state: 'Wisconsin',
  federal: 'Federal',
};
