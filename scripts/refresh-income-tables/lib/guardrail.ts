/**
 * "flag anything over ~10% for human review rather than applying it" (issue #6). A
 * refresher that trips this on a legitimate, large, correct move is not a bug in the
 * guardrail -- it is the guardrail doing its job. What has to be right is the message: name
 * the figure, the old and new values, the percentage change, and the source, and say
 * plainly this may be legitimate. See docs/data-authoring.md.
 *
 * Calibration: started at 10%, raised to 25% after the two real runs while building this
 * script showed normal annual movement already sits close to or above that band -- FPL
 * moves ~3-4%/year, Dane AMI's actual 2026 correction (#3) was 9.1%, and WI SMI's was
 * 15-20%. A band that sits below normal movement stops being a signal and becomes noise:
 * it would trip on every correct run, which trains people to click through it -- worse than
 * no guardrail, because it also fires on the one run that matters. The guardrail's actual
 * job is catching a *parse* error (a misread column, a footnote captured as a value, a row
 * offset) -- those produce grossly wrong numbers, not 12% ones. 25% still catches that
 * comfortably while letting real annual updates through, and it is not the only safety net:
 * every run that changes anything still produces a diff a human reads before it merges. If
 * you're considering tightening this again, get real observed annual movement for all three
 * tables across a few more years first -- one year of data calibrated this number once
 * already and should not be assumed to generalize on its own.
 */
export const GUARDRAIL_PERCENT = 25;

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
