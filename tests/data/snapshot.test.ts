import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  PROGRAMS,
  SNAPSHOT,
  SNAPSHOT_FACT_VOCABULARY,
  SNAPSHOT_GENERATED_AT,
  SNAPSHOT_VERSION,
} from '@/data/programs';
import { HAND_AUTHORED_PROGRAMS } from '@/data/programs/records';
import {
  buildSnapshot,
  buildValidatedSnapshot,
  serializeSnapshot,
} from '@/data/programs/build-snapshot';
import {
  SNAPSHOT_VERSION as SCHEMA_VERSION,
  validateSnapshot,
} from '@/data/programs/snapshot-schema';
import { factsReferenced } from '@/domain/criteria';
import { FACT_KEYS } from '@/domain/facts';
import { ASKED_FACTS } from '@/interview/screens';
import { measureSnapshot } from '../../scripts/build-snapshot/measure';

/**
 * Guards the shippable snapshot (issue #8). The point of this file is the
 * "no behaviour change" acceptance criterion: the generator must reproduce the
 * committed snapshot from the current records exactly, and the app must load
 * that snapshot without any existing suite noticing.
 */

const SNAPSHOT_FILE = path.join(process.cwd(), 'src/data/programs/snapshot.json');
// Normalise line endings: .gitattributes pins the file to LF and the generator
// writes LF, but a Windows checkout can still hand us CRLF here.
const committedText = fs.readFileSync(SNAPSHOT_FILE, 'utf8').replace(/\r\n/g, '\n');

describe('the committed snapshot is valid', () => {
  it('passes schema validation with no problems', () => {
    expect(validateSnapshot(SNAPSHOT)).toEqual([]);
  });

  it('declares the format version the schema expects', () => {
    expect(SNAPSHOT_VERSION).toBe(SCHEMA_VERSION);
  });

  it('carries an ISO 8601 UTC generatedAt that parses', () => {
    expect(SNAPSHOT_GENERATED_AT).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/);
    expect(Number.isNaN(Date.parse(SNAPSHOT_GENERATED_AT))).toBe(false);
  });

  it('gives every record a source citation and a verification field', () => {
    for (const record of SNAPSHOT.records) {
      expect(record.source.url, record.id).toMatch(/^https?:\/\//);
      const lv = record.source.lastVerified;
      expect(lv === null || /^\d{4}-\d{2}-\d{2}$/.test(lv), record.id).toBe(true);
    }
  });
});

describe('the generator reproduces the committed snapshot (no drift)', () => {
  it('serialises to byte-for-byte the committed file', () => {
    const { serialized } = buildValidatedSnapshot(HAND_AUTHORED_PROGRAMS, {
      now: new Date(),
      previous: SNAPSHOT,
    });
    // If this fails: run `npm run build:snapshot` and commit the result.
    expect(serialized).toBe(committedText);
  });

  it('preserves generatedAt across a no-op rebuild with a different clock', () => {
    const rebuilt = buildSnapshot(HAND_AUTHORED_PROGRAMS, {
      now: new Date('2099-01-01T00:00:00.000Z'),
      previous: SNAPSHOT,
    });
    expect(rebuilt.generatedAt).toBe(SNAPSHOT.generatedAt);
  });

  it('moves generatedAt when a record actually changes', () => {
    const changed = HAND_AUTHORED_PROGRAMS.map((p, i) =>
      i === 0 ? { ...p, summary: `${p.summary} (edited)` } : p,
    );
    const rebuilt = buildSnapshot(changed, {
      now: new Date('2099-01-01T00:00:00.000Z'),
      previous: SNAPSHOT,
    });
    expect(rebuilt.generatedAt).toBe('2099-01-01T00:00:00.000Z');
  });
});

describe('the app loads the snapshot, not the hand-authored records', () => {
  it('exposes the same programs, in the same order', () => {
    expect(PROGRAMS.map((p) => p.id)).toEqual(HAND_AUTHORED_PROGRAMS.map((p) => p.id));
  });

  it('round-trips every record losslessly', () => {
    // toEqual ignores key order and undefined-valued keys, which is exactly the
    // difference JSON serialisation introduces and the engine does not observe.
    expect(SNAPSHOT.records).toEqual(JSON.parse(JSON.stringify(HAND_AUTHORED_PROGRAMS)));
  });
});

describe('the fact vocabulary seam (issue #8)', () => {
  const referenced = new Set(
    HAND_AUTHORED_PROGRAMS.flatMap((p) => [...factsReferenced(p.eligibility)]),
  );

  it('declares exactly the facts the shipped rules reference, sorted', () => {
    expect([...SNAPSHOT_FACT_VOCABULARY]).toEqual([...referenced].sort());
  });

  it('declares only real fact keys', () => {
    for (const fact of SNAPSHOT_FACT_VOCABULARY) {
      expect(FACT_KEYS).toContain(fact);
    }
  });

  it('declares nothing the interview cannot ask (would strand a program in "might qualify")', () => {
    const unaskable = SNAPSHOT_FACT_VOCABULARY.filter((f) => !ASKED_FACTS.includes(f));
    expect(unaskable).toEqual([]);
  });
});

describe('per-record size budget (issue #8)', () => {
  /**
   * Measured 2026-09-05 on the 17-record seed dataset:
   *   full snapshot.json      46,693 B raw / 9,785 B gzipped
   *   per record, amortised   524 B gzipped  (eligibility ~63, prose ~364)
   *
   * These ceilings are ~1.5x current -- loose enough that ordinary record edits
   * do not trip them, tight enough to catch a serialisation regression (comments
   * leaking in, indentation blowing up, prose ballooning). Update the numbers
   * above and the ceilings together if the dataset genuinely grows.
   */
  const budget = measureSnapshot(committedText, SNAPSHOT);

  it('keeps the amortised gzipped cost per record under budget', () => {
    expect(budget.perRecordAmortisedGz).toBeLessThan(800);
  });

  it('keeps the whole gzipped file well inside the "serve everything" envelope', () => {
    expect(budget.fullFileGz).toBeLessThan(16_000);
  });
});
