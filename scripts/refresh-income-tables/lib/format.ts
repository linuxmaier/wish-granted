/** Render an integer the way income-tables.ts writes numeric literals: `135300` -> `135_300`. */
export function formatNumberLiteral(n: number): string {
  if (!Number.isInteger(n)) {
    throw new Error(`formatNumberLiteral expects an integer, got ${n}`);
  }
  return n.toLocaleString('en-US').replaceAll(',', '_');
}

/** Parse a numeric literal in either style income-tables.ts might contain: `135_300` or `135300`. */
export function parseUnderscoredNumber(literal: string): number {
  const n = Number(literal.replace(/_/g, '').trim());
  if (!Number.isFinite(n)) {
    throw new Error(`Could not parse numeric literal: "${literal}"`);
  }
  return n;
}

/** Parse a dollar figure out of scraped text, e.g. `"$135,300"` or `"135300"`. */
export function parseDollarNumber(text: string): number {
  const n = Number(text.replace(/[$,]/g, '').trim());
  if (!Number.isFinite(n)) {
    throw new Error(`Could not parse dollar figure: "${text}"`);
  }
  return n;
}
