/** Type declarations for extract-income-tables.mjs, for the test suite's benefit. */

export interface HtmlTable {
  readonly rows: readonly string[][];
}

export function extractTables(html: string): HtmlTable[];

export interface IncomeTableSource {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly fixture: string;
  /** 0-indexed cell holding the dollar figure. */
  readonly valueCol: number;
  readonly selectTable: (tables: HtmlTable[]) => HtmlTable | undefined;
}

export type ExtractResult =
  | {
      readonly ok: true;
      readonly bySize: readonly (number | undefined)[];
      readonly perAdditionalPerson: number | null;
    }
  | { readonly ok: false; readonly reason: string };

export function extractIncomeTable(html: string, source: IncomeTableSource): ExtractResult;

export const HTML_TABLE_SOURCES: readonly IncomeTableSource[];

export interface NotAttemptedSource {
  readonly id: string;
  readonly name: string;
  readonly reason: string;
}

export const NOT_ATTEMPTED: readonly NotAttemptedSource[];
