import type { Program } from '@/domain/program';
import type { FactKey } from '@/domain/facts';
import rawSnapshot from './snapshot.json';
import { assertValidSnapshot } from './snapshot-schema';
import type { ProgramSnapshot } from './snapshot-schema';

/**
 * The program dataset, as the app consumes it.
 *
 * The source of truth is the hand-authored records in `./records.ts`, one file
 * per program. The app does not import those directly -- `npm run build:snapshot`
 * serializes them into `./snapshot.json`, a build-time artifact committed to the
 * repo and compiled into the bundle here. There is no runtime fetch: the whole
 * corpus ships eagerly, which keeps the privacy guarantee (issue #1: "what the
 * client requests must not depend on the user's answers") trivially true. See
 * `./snapshot-schema.ts` and docs/design.md, "The shippable snapshot".
 *
 * `assertValidSnapshot` runs at module load, so a malformed snapshot fails every
 * path that executes this file -- `npm test`, `npm run dev`, the jsdom smoke
 * test. `npm run build` additionally runs `build:snapshot -- --check`, because
 * `vite build` bundles this module without executing it.
 */

// The runtime assertion above is the real gate; the cast only tells the compiler
// what `assertValidSnapshot` has already proven about the parsed JSON.
assertValidSnapshot(rawSnapshot);
export const SNAPSHOT = rawSnapshot as unknown as ProgramSnapshot;

export const PROGRAMS: readonly Program[] = SNAPSHOT.records;

/** ISO 8601 UTC instant the snapshot was assembled. Feeds issue #44's "data as of" indicator. */
export const SNAPSHOT_GENERATED_AT: string = SNAPSHOT.generatedAt;
/** Snapshot format version (`snapshot-schema.ts`), for a loader that needs to branch on it. */
export const SNAPSHOT_VERSION: number = SNAPSHOT.snapshotVersion;
/** Every fact key the shipped rules reference, sorted. The pipeline↔interview seam (issue #8). */
export const SNAPSHOT_FACT_VOCABULARY: readonly FactKey[] = SNAPSHOT.factVocabulary;

export function programById(id: string): Program | undefined {
  return PROGRAMS.find((p) => p.id === id);
}

/** Records still awaiting a human check against their source. */
export function unverifiedPrograms(): readonly Program[] {
  return PROGRAMS.filter((p) => p.source.lastVerified === null);
}

/**
 * Records whose last check is older than `days`. Curation debt is invisible
 * unless something surfaces it, so this drives both the data test and the
 * staleness notice in the UI.
 */
export function stalePrograms(days = 180, now: Date = new Date()): readonly Program[] {
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  return PROGRAMS.filter((p) => {
    if (p.source.lastVerified === null) return true;
    return new Date(p.source.lastVerified).getTime() < cutoff;
  });
}
