import { gzipSync } from 'node:zlib';

/**
 * The per-record size budget (issue #8). Reports real measured bytes, not
 * estimates -- run via `npm run build:snapshot -- --measure`.
 *
 * The number that matters for bundle cost is the *amortised* one: gzip the whole
 * records array once and divide by the count, because that is how the records
 * actually ship (one stream, shared dictionary). Gzipping each record alone
 * overcounts badly -- ~18 bytes of gzip framing per record plus a cold
 * dictionary -- so it is reported only as a spread (min/max), not as the budget.
 */

const gz = (s: string): number => gzipSync(Buffer.from(s, 'utf8'), { level: 9 }).length;

interface RecordLike {
  readonly summary?: unknown;
  readonly benefit?: unknown;
  readonly eligibility?: unknown;
  readonly eligibilityCaveats?: unknown;
  readonly seasonalNote?: unknown;
  readonly howToApply?: { readonly steps?: unknown };
}

function proseOf(record: RecordLike): string {
  const parts: unknown[] = [record.summary, record.benefit, record.seasonalNote];
  if (Array.isArray(record.eligibilityCaveats)) parts.push(...record.eligibilityCaveats);
  const steps = record.howToApply?.steps;
  if (Array.isArray(steps)) parts.push(...steps);
  return parts.filter((p) => typeof p === 'string').join('\n');
}

export interface SizeBudget {
  readonly recordCount: number;
  readonly fullFileRaw: number;
  readonly fullFileGz: number;
  readonly recordsArrayGz: number;
  readonly perRecordAmortisedGz: number;
  readonly perRecordEligibilityGz: number;
  readonly perRecordProseGz: number;
  readonly perRecordMinGz: number;
  readonly perRecordMaxGz: number;
}

export function measureSnapshot(serialized: string, snapshot: { records: readonly RecordLike[] }): SizeBudget {
  const records = snapshot.records;
  const n = records.length;
  const recordsJson = JSON.stringify(records);
  const eligibilityJson = JSON.stringify(records.map((r) => r.eligibility));
  const proseJoined = records.map(proseOf).join('\n');
  const individualGz = records.map((r) => gz(JSON.stringify(r)));

  return {
    recordCount: n,
    fullFileRaw: Buffer.byteLength(serialized, 'utf8'),
    fullFileGz: gz(serialized),
    recordsArrayGz: gz(recordsJson),
    perRecordAmortisedGz: Math.round(gz(recordsJson) / n),
    perRecordEligibilityGz: Math.round(gz(eligibilityJson) / n),
    perRecordProseGz: Math.round(gz(proseJoined) / n),
    perRecordMinGz: Math.min(...individualGz),
    perRecordMaxGz: Math.max(...individualGz),
  };
}

export function formatBudget(b: SizeBudget): string {
  return [
    `  records:                    ${b.recordCount}`,
    `  full snapshot.json:         ${b.fullFileRaw} B raw / ${b.fullFileGz} B gzipped`,
    `  records array (gzipped):    ${b.recordsArrayGz} B`,
    ``,
    `  per record, amortised:      ${b.perRecordAmortisedGz} B gzipped   <- the budget number`,
    `    of which eligibility:     ${b.perRecordEligibilityGz} B gzipped`,
    `    of which prose:           ${b.perRecordProseGz} B gzipped`,
    `  per record, standalone:     ${b.perRecordMinGz}-${b.perRecordMaxGz} B gzipped (spread; includes framing)`,
    ``,
    `  projection at this amortised rate:`,
    `    100 programs:             ~${Math.round((b.perRecordAmortisedGz * 100) / 1024)} KB gzipped`,
    `    1,000 programs:           ~${Math.round((b.perRecordAmortisedGz * 1000) / 1024)} KB gzipped`,
  ].join('\n');
}
