import { findBlock, readScalarField, readArrayField } from './table-source.ts';
import { parseUnderscoredNumber } from './format.ts';

export interface CurrentBySizeTable {
  readonly bySize: number[];
  readonly perAdditionalPerson: number;
  readonly effectiveYear: number;
  readonly source: string;
  readonly verified: boolean;
  readonly lastVerified: string | null;
}

export interface CurrentDaneAmi {
  readonly fourPersonMedian: number;
  readonly effectiveYear: number;
  readonly source: string;
  readonly verified: boolean;
  readonly lastVerified: string | null;
}

function parseSource(literal: string): string {
  return literal.slice(1, -1);
}

function parseVerified(literal: string): boolean {
  return literal === 'true';
}

function parseLastVerified(literal: string): string | null {
  return literal === 'null' ? null : literal.slice(1, -1);
}

/** Reads FPL or WI_SMI_60 (both `bySize` + `perAdditionalPerson` shaped) as currently written. */
export function readCurrentBySizeTable(fileText: string, exportName: string): CurrentBySizeTable {
  const { body } = findBlock(fileText, exportName);
  const bySize = readArrayField(body, exportName, 'bySize')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(parseUnderscoredNumber);
  return {
    bySize,
    perAdditionalPerson: parseUnderscoredNumber(readScalarField(body, exportName, 'perAdditionalPerson')),
    effectiveYear: parseUnderscoredNumber(readScalarField(body, exportName, 'effectiveYear')),
    source: parseSource(readScalarField(body, exportName, 'source')),
    verified: parseVerified(readScalarField(body, exportName, 'verified')),
    lastVerified: parseLastVerified(readScalarField(body, exportName, 'lastVerified')),
  };
}

/** Reads DANE_AMI (`fourPersonMedian` shaped) as currently written. */
export function readCurrentDaneAmi(fileText: string, exportName: string): CurrentDaneAmi {
  const { body } = findBlock(fileText, exportName);
  return {
    fourPersonMedian: parseUnderscoredNumber(readScalarField(body, exportName, 'fourPersonMedian')),
    effectiveYear: parseUnderscoredNumber(readScalarField(body, exportName, 'effectiveYear')),
    source: parseSource(readScalarField(body, exportName, 'source')),
    verified: parseVerified(readScalarField(body, exportName, 'verified')),
    lastVerified: parseLastVerified(readScalarField(body, exportName, 'lastVerified')),
  };
}
