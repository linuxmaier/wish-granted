/** Type declarations for scripts/tier3-extract/*.mjs, for the test suite. */

export type Tier3Decision = 'extract' | 'abstain';

export interface Tier3Expected {
  readonly decision: Tier3Decision;
  readonly mustMatch?: (criterion: unknown) => boolean;
  readonly why: string;
}

export interface Tier3Source {
  readonly id: string;
  readonly kind: 'html' | 'ecfr';
  readonly file: string;
  readonly url: string;
  readonly fetchedOn: string;
  readonly sections?: readonly string[];
  readonly paragraphFilter?: string;
  readonly citationName: string;
  readonly tierAssigned: 1 | 2 | 3 | 4;
  readonly expected: Tier3Expected;
  readonly groundedIn: string;
}

export const TIER3_SOURCES: readonly Tier3Source[];
export const TIER3_HELDOUT: readonly Tier3Source[];

export type Tier3Outcome =
  | 'correct-abstention'
  | 'correct-extraction'
  | 'dangerous-over-claim'
  | 'over-cautious'
  | 'parse-failure';

export interface Tier3Result {
  readonly decision: Tier3Decision;
  readonly code: string;
  readonly reason: string;
  readonly criterion: unknown;
  readonly citation: string | null;
  readonly notes: readonly string[];
  readonly verdicts: readonly { decision: string; code: string; reason: string }[];
}

export interface Tier3Row {
  readonly id: string;
  readonly outcome: Tier3Outcome;
  readonly detail: string;
  readonly result: Tier3Result | null;
}

export function scoreSource(src: Tier3Source, text: string): Tier3Row;
export function evaluate(opts?: {
  live?: boolean;
  split?: 'tuning' | 'heldout';
}): Promise<Tier3Row[]>;

export function extractFromHtml(html: string, source: Tier3Source): Tier3Result;
export function extractFromEcfr(xml: string, source: Tier3Source): Tier3Result;
