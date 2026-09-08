/**
 * A prompt fragment telling the model which facts the interview actually asks
 * and which are RESERVED (declared in the vocabulary but never supplied by any
 * question). Built from `src/domain/facts.ts` at call time -- exactly the
 * approach `scripts/llm-extraction/enum-vocab.ts` takes for enum slugs -- so it
 * can never drift from the real vocabulary.
 *
 * Why this exists: PR #72's live run emitted `[age lte 64]` and
 * `[citizenshipStatus includesAny ...]` rules against facts no question
 * supplied; a rule testing an unasked fact can never be satisfied and silently
 * rules everyone out. (`age` is asked now -- issue #88 -- so only the
 * citizenship case still applies, but the convention is unchanged.) The
 * wizard-of-oz agents avoided it precisely
 * because they read `facts.ts` and reasoned about which facts were answerable,
 * then routed those conditions to `manualReview`. The production prompt did not
 * convey the convention; this closes that gap. The schema gate
 * (`schema-gate.ts`) is the belt to this suspenders -- #51: a prompt-only fix
 * for a systematic error is not trustworthy.
 */
import { FACT_KEYS, FACTS, RESERVED_FACT_KEYS, type FactKey } from '../../../src/domain/facts.ts';

/** Facts a question actually supplies -- the only ones a rule may test. */
export function askableFactKeys(): FactKey[] {
  return FACT_KEYS.filter((k) => !RESERVED_FACT_KEYS.includes(k));
}

export function describeAskableFacts(): string {
  const lines: string[] = [
    'ASKABLE vs RESERVED FACTS. A `compare` or `set` node may ONLY reference a fact the interview actually asks. The facts below marked RESERVED are declared in the vocabulary but no question ever supplies them, so a rule that tests one can never be satisfied -- inside an allOf it silently rules everyone out, which is the worst error this system can make. If the source makes eligibility turn on a reserved fact (immigration/citizenship status, employment status, veteran or disability status), that condition belongs in a manualReview note (which may name the fact in prose), never in a compare/set node. Age IS askable -- it is asked as a band (under-60 / 60-64 / 65-plus), so an age boundary belongs in the rule. The schema gate rejects any rule that violates this.',
    '',
    'Askable (a rule may test these):',
  ];
  for (const key of askableFactKeys()) {
    lines.push(`    - ${key} (${FACTS[key].type}): ${FACTS[key].label}`);
  }
  lines.push('', 'RESERVED -- never put these in a compare/set node; use manualReview:');
  for (const key of RESERVED_FACT_KEYS) {
    lines.push(`    - ${key} (${FACTS[key].type}): ${FACTS[key].label}`);
  }
  return lines.join('\n');
}
