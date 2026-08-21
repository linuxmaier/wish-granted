/**
 * "flag anything over ~10% for human review rather than applying it" (issue #6). A
 * refresher that trips this on a legitimate, large, correct move (Dane AMI moved 9.1% in
 * the #3 correction; WI SMI moved 15-20%) is not a bug in the guardrail -- it is the
 * guardrail doing its job. What has to be right is the message: name the figure, the old
 * and new values, the percentage change, and the source, and say plainly this may be
 * legitimate. See docs/data-authoring.md.
 */
export const GUARDRAIL_PERCENT = 10;

export interface GuardrailViolation {
  readonly label: string;
  readonly oldValue: number;
  readonly newValue: number;
  readonly percentChange: number;
}

export function checkGuardrail(
  labelFor: (index: number) => string,
  oldValues: readonly number[],
  newValues: readonly number[],
): GuardrailViolation[] {
  const violations: GuardrailViolation[] = [];
  for (let i = 0; i < newValues.length; i++) {
    const oldValue = oldValues[i];
    const newValue = newValues[i]!;
    if (oldValue === undefined) continue; // a newly-tracked size has nothing to compare against
    const percentChange = ((newValue - oldValue) / oldValue) * 100;
    if (Math.abs(percentChange) > GUARDRAIL_PERCENT) {
      violations.push({ label: labelFor(i), oldValue, newValue, percentChange });
    }
  }
  return violations;
}
