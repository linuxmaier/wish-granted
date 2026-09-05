import type { Program } from '@/domain/program';
import { factsReferenced } from '@/domain/criteria';
import type { FactKey } from '@/domain/facts';
import {
  SNAPSHOT_VERSION,
  validateSnapshot,
  type ProgramSnapshot,
} from './snapshot-schema';

/**
 * Pure snapshot assembly (issue #8). No I/O -- `scripts/build-snapshot` is the
 * thin CLI that reads `records.ts`, calls this, and writes / checks the file.
 * Kept in `src/` so the drift test (`tests/data/snapshot.test.ts`) can import it
 * through the `@/` alias without spinning up Vite.
 */

export const DEFAULT_GENERATOR = 'scripts/build-snapshot';

export interface BuildOptions {
  /** Wall clock for `generatedAt`. Injected so tests are deterministic. */
  readonly now: Date;
  /**
   * The previously committed snapshot, if any. When the freshly built records
   * are byte-for-byte identical to it, its `generatedAt` is carried forward so a
   * no-op rebuild produces no diff. Pass the parsed JSON or `undefined`.
   */
  readonly previous?: unknown;
  readonly generator?: string;
}

/**
 * Drop `undefined` fields and any non-JSON values, and give every object key a
 * deterministic (alphabetical) order so the serialized file only changes when
 * the data does. Arrays keep their order -- it is meaningful for `records`,
 * `categories`, `of`, and `steps`.
 */
function canonical<T>(value: T): T {
  if (Array.isArray(value)) return value.map(canonical) as unknown as T;
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] === undefined) continue;
      out[key] = canonical(source[key]);
    }
    return out as T;
  }
  return value;
}

function computeFactVocabulary(records: readonly Program[]): FactKey[] {
  const keys = new Set<FactKey>();
  for (const record of records) {
    for (const key of factsReferenced(record.eligibility)) keys.add(key);
  }
  return [...keys].sort();
}

/** The snapshot with `generatedAt` neutralised -- the part that decides drift. */
function contentFingerprint(snapshot: ProgramSnapshot): string {
  return JSON.stringify(canonical({ ...snapshot, generatedAt: '' }));
}

export function buildSnapshot(records: readonly Program[], options: BuildOptions): ProgramSnapshot {
  const canonicalRecords = canonical(records.map((r) => ({ ...r }))) as ProgramSnapshot['records'];

  const draft: ProgramSnapshot = {
    snapshotVersion: SNAPSHOT_VERSION,
    generatedAt: options.now.toISOString(),
    generator: options.generator ?? DEFAULT_GENERATOR,
    recordCount: canonicalRecords.length,
    factVocabulary: computeFactVocabulary(records),
    records: canonicalRecords,
  };

  const previous = options.previous;
  if (isSnapshotShaped(previous) && contentFingerprint(previous) === contentFingerprint(draft)) {
    return { ...draft, generatedAt: previous.generatedAt };
  }
  return draft;
}

function isSnapshotShaped(value: unknown): value is ProgramSnapshot {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ProgramSnapshot).generatedAt === 'string' &&
    Array.isArray((value as ProgramSnapshot).records)
  );
}

/**
 * The exact bytes written to `snapshot.json`. Two-space indent, trailing
 * newline, keys sorted. `scripts/build-snapshot` and the drift test both go
 * through here so "what the generator would write" is defined in one place.
 */
export function serializeSnapshot(snapshot: ProgramSnapshot): string {
  return `${JSON.stringify(canonical(snapshot), null, 2)}\n`;
}

/** Build + validate in one step; throws `SnapshotValidationError` on a bad result. */
export function buildValidatedSnapshot(
  records: readonly Program[],
  options: BuildOptions,
): { snapshot: ProgramSnapshot; serialized: string } {
  const snapshot = buildSnapshot(records, options);
  const problems = validateSnapshot(snapshot);
  if (problems.length) {
    throw new Error(
      `Generated snapshot failed validation -- this is a generator or source-record bug:\n` +
        problems.map((p) => `  - ${p}`).join('\n'),
    );
  }
  return { snapshot, serialized: serializeSnapshot(snapshot) };
}
