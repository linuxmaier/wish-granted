/**
 * "Unextractable" vs "unextractable *with the current vocabulary*" (issue #68).
 *
 * When the deterministic parser abstains because a clean income ceiling is
 * gated by a co-condition it cannot represent (`UNDECIDABLE_COCONDITION`), that
 * co-condition is one of two things:
 *
 *   - a condition the interview already asks about (age is now an askable band,
 *     #89) -- the agentic extractor can encode the branch, so this is just a
 *     hard parse, route it to extraction;
 *   - a condition on a RESERVED fact (`src/domain/facts.ts` RESERVED_FACT_KEYS:
 *     currently isVeteran, hasDisability, citizenshipStatus, employmentStatus)
 *     -- no question supplies it, so no extractor can produce an enforceable
 *     rule from it. That is a *coverage* signal: per docs/data-authoring.md
 *     ("When a fact earns a question"), a fact earns a question when it unlocks
 *     programs worth including, so "this source needs a fact we do not ask" may
 *     be a reason to add a question rather than a dead end.
 *
 * This module detects the second case and names the reserved fact. Triage still
 * routes these to the agentic extractor (it can extract the income branch and
 * leave the reserved gate as a `manualReview` leaf), but the gap is recorded so
 * a degenerate "everything needs a fact we don't have" outcome is visible.
 *
 * The reserved list is read from RESERVED_FACT_KEYS at module load -- never
 * hardcoded -- which is exactly what let #89 move `age` out cleanly: the schema
 * gate and the agentic reserved-fact gate both derive from that constant, and
 * so does this.
 */
import { FACTS, RESERVED_FACT_KEYS, type FactKey } from '../../../src/domain/facts.ts';

/**
 * Phrases that point at a reserved fact, keyed by fact. Kept narrow: the goal is
 * to recognise a co-condition the parser already flagged, not to re-detect
 * every gate from scratch.
 */
const RESERVED_FACT_PHRASES: Partial<Record<FactKey, RegExp>> = {
  hasDisability:
    /\b(?:disab(?:led|ility)|determined disabled|disability determination|blind|functional (?:level of care|eligib)|long-term care condition|frail elder)\b/i,
  isVeteran: /\b(?:veteran|active[- ]duty|served in the (?:armed forces|military)|VA (?:benefits|health))\b/i,
  citizenshipStatus:
    /\b(?:citizen(?:ship)?|immigration status|qualified (?:immigrant|alien)|lawfully present|noncitizen|alien status|40 qualifying quarters)\b/i,
  employmentStatus:
    /\b(?:unemploy|not (?:currently )?(?:working|employed)|employment status|work requirement|able-bodied adult|must be (?:working|employed)|engage in .{0,20}work activit)\b/i,
};

export interface VocabularyGap {
  readonly fact: FactKey;
  readonly quote: string;
}

const RESERVED_SET = new Set<FactKey>(RESERVED_FACT_KEYS);

/** The reserved facts, with their human labels, for reporting. */
export function reservedFactLabels(): ReadonlyArray<{ fact: FactKey; label: string }> {
  return RESERVED_FACT_KEYS.map((fact) => ({ fact, label: FACTS[fact].label }));
}

/**
 * Given the parser's abstention reason text (and, optionally, the source's
 * meaningful text), name any RESERVED fact the co-condition turns on. Empty when
 * the gate is on an askable fact (e.g. age) or on nothing reserved.
 */
export function detectVocabularyGap(reasonText: string, sourceText = ''): VocabularyGap[] {
  const hay = `${reasonText}\n${sourceText}`;
  const gaps: VocabularyGap[] = [];
  for (const fact of RESERVED_FACT_KEYS) {
    const re = RESERVED_FACT_PHRASES[fact];
    if (!re) continue;
    const m = re.exec(hay);
    if (!m || m.index === undefined) continue;
    const start = Math.max(0, m.index - 40);
    const end = Math.min(hay.length, m.index + m[0].length + 40);
    gaps.push({ fact, quote: hay.slice(start, end).trim().replace(/\s+/g, ' ') });
  }
  return gaps;
}

export function isReservedFact(fact: string): fact is FactKey {
  return RESERVED_SET.has(fact as FactKey);
}
