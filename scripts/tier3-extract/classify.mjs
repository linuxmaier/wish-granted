/**
 * Decision logic for the Tier-3 deterministic-parse spike (issue #62, exp 3).
 *
 * Given the *structured* reading of a source (heading stack, run-in headings,
 * list stems, table column headers, CFR paragraph path) this decides, for each
 * income figure it finds, whether that figure is an eligibility ceiling whose
 * governing scope is fully recoverable -- in which case it emits a `Criterion`
 * -- or whether the scope is missing, undecidable, or the figure governs
 * something other than eligibility, in which case it abstains.
 *
 * The bar (from the issue): an extraction is only correct if it carries the
 * figure's governing scope. Pulling "200% FPL" out of a survivor-only branch
 * without the survivor condition is a *dangerous over-claim*, scored as a
 * failure exactly as the LLM's would be. Abstention is a correct answer.
 *
 * Every rule below keys on a structural signal (a heading word, a column
 * header, a list stem, a CFR paragraph letter / run-in heading, a
 * cross-reference), never on the identity of the page. The point of the
 * experiment is to see how far structure alone gets you.
 */

// --- vocabulary the app can actually decide (src/domain/facts.ts) ----------
// Kept as plain strings so this module has zero imports and runs under node
// directly, like scripts/extract-income-tables.mjs.

const SCALE_WORDS = [
  [/area median income|\bAMI\b/i, 'dane-ami'],
  [/state median income|\bSMI\b|wisconsin['’]?s median income|median income/i, 'wi-smi'],
  [/federal poverty (level|guideline|line)s?|poverty (level|guideline|line)s?|\bFPL\b|poverty/i, 'fpl'],
];

function scaleOf(text) {
  for (const [re, scale] of SCALE_WORDS) if (re.test(text)) return scale;
  return null;
}

/** Find every income figure in a chunk of text, with the clause around it. */
export function findCandidates(text) {
  const out = [];
  const sentences = text.split(/(?<=[.:;])\s+(?=[A-Z(])/);

  for (const clause of sentences) {
    // "<n> percent of ... poverty / median income"
    for (const m of clause.matchAll(
      /(\d{2,3}(?:\.\d+)?)\s*(?:percent|%)\s*(?:or (?:less|below|fewer)\s+)?(?:of\s+(?:the\s+)?|than (?:the\s+)?)?([\w'’ ,.-]{0,40}?(?:poverty|median income|\bSMI\b|\bFPL\b|\bAMI\b))/gi,
    )) {
      out.push({
        kind: 'percent-of-scale',
        percent: Number(m[1]),
        scale: scaleOf(m[2]) ?? scaleOf(clause),
        clause: clause.trim(),
      });
    }
    // "at or below the poverty line" (== 100% FPL, no explicit percent)
    if (/\b(at or below|equal to or below|below)\b[^.]*\bpoverty (line|level|guidelines?)\b/i.test(clause)
        && !/\bpercent|%/.test(clause)) {
      out.push({ kind: 'poverty-line', percent: 100, scale: 'fpl', clause: clause.trim() });
    }
    // bare dollar figure presented as an income limit, no percent, no scale
    if (/\$\s?[\d,]{3,}/.test(clause) && /\bincome\b/i.test(clause) && !/percent|%/.test(clause)
        && scaleOf(clause) === null) {
      const d = clause.match(/\$\s?([\d,]{3,})/);
      out.push({
        kind: 'bare-dollar',
        dollar: Number(d[1].replace(/,/g, '')),
        percent: null,
        scale: null,
        clause: clause.trim(),
      });
    }
  }
  return out;
}

// --- signal detectors -----------------------------------------------------

const RE = {
  eligibilityContext:
    /\beligib|to qualify|you (can|may) (get|qualify)|qualify for|who is eligible|income (limit|test)|gross income test|may be able to get|you meet .* income requirements/i,
  costSharing:
    /coverage level|participation level|cost.?sharing|co-?pay|deductible|spenddown|premium (level|threshold)|how much (of )?your .* (costs?|drugs?) .* (cover|pay)|out-of-pocket|by participation level/i,
  composition:
    /separate household|household composition|considered .* a (separate )?household|counted as (its own|a separate) household/i,
  processingReporting:
    /expedited (service|processing)|reporting limit|after (you|they) enroll|report (it |any )?(changes? )?to|recert|renewal|processed (more )?quickly|7 days|thirty days|after you have been determined eligible|remain (financially )?eligible|continue to be eligible|to (stay|remain) (enrolled|on the program)/i,
  dualTest:
    /shall meet both the net .* and .* gross|shall meet both the gross .* and .* net|meet both the gross and net income (eligibility )?standards|both the gross or net income eligibility standards/i,
  exceptionAllowance:
    /notwithstanding|additional allowance|over-?income|except as (otherwise )?provided|extended eligibility|a program may enroll an additional|discretion|may also apply on behalf|up to \d+ percent of (a |the )?program|state agency may (prescribe|establish|set)|may prescribe income guidelines|state option/i,
  deductionStack:
    /after (certain )?(credits|deductions) (are |have been )?(applied|allowed)|net income (eligibility )?standard|standard deduction|excess shelter|shelter deduction|after all other deductions|earned income (deduction|disregard)|adjusted (family|gross|net) income/i,
  floorNotCeiling:
    /(shall |must )?not (establish|be|set) .{0,40}less than \d+ ?(percent|%)|no less than \d+ ?(percent|%)|at least \d+ ?(percent|%) of (the )?(revised )?poverty|between \d+ ?(percent|%)? ?and \d+ ?(percent|%) of the (federal )?poverty/i,
  ageBandGate:
    /\bages?\s+\d{2}\s*(?:to|through|-|and|[-])\s*\d{2}\b|\b\d{2}\s*-\s*\d{2}\s+age\b|\b(?:aged?\s+)?\d{2}\s+(?:years?\s+)?(?:of age\s+)?or older\b|\bunder age\s+\d{2}\b|\b60 years of age or older\b/i,
  disabilityGate:
    /determined disabled|meet the definition of ["']?disabled["']?|disability determination bureau|be (determined |found )?disabled|functional level of care|level of care eligibility/i,
  crossReferenceTree:
    /(§|section)\s*\d[\d.]*(\([a-z0-9]+\))*.{0,60}(§|section)\s*\d|time limit for able-bodied|ineligible under §|exemption (tree|from the)|as (defined|provided|described) in §\s*\d/i,
  undecidableGate:
    /entitled to medicare|facing a (setback|hardship|emergency)|domestic violence|human trafficking|natural disaster|energy crisis|line separation request|financial hardship|asset (test|limit)|limited assets|individual assets of|must be a (parent|relative) caring for a child|survivor|work requirement|be (working|employed)|meet the .{0,20}work requirement|uninsured|not (be )?(eligible for|enrolled in|covered by) (medicare|medicaid|health)|no health insurance|not able to pay the (deductible|co-?payment)/i,
  listStemAddsConditions:
    /(meet|satisfy) (all of |one of |any of )?the following|you must:?\s*$|to qualify.*you must|if you:?\s*$|following (requirements|conditions)/i,
};

/** phrases in a table column header / heading that mark a population carve-out */
function populationOf(text) {
  if (/pregnant/i.test(text) && /child/i.test(text))
    return { label: 'pregnant people and children', anyOf: ['isPregnantOrPostpartum', 'hasChildUnder5', 'hasSchoolAgeChild'] };
  if (/pregnant/i.test(text)) return { label: 'pregnant or postpartum', anyOf: ['isPregnantOrPostpartum'] };
  if (/child(ren)?/i.test(text)) return { label: 'children in the household', anyOf: ['hasChildUnder5', 'hasSchoolAgeChild'] };
  if (/\badults?\b/i.test(text)) return { label: 'adults', anyOf: [] }; // no age fact -> unscoped base
  return null;
}

// --- Criterion builders (plain objects; shape matches src/domain/criteria.ts) --

const income = (scale, percent) => ({ kind: 'incomeAtOrBelow', scale, percent });
const review = (note) => ({ kind: 'manualReview', note });
const anyOf = (...of) => ({ kind: 'anyOf', of });
const allOf = (...of) => ({ kind: 'allOf', of });
const hasAnyOf = (fact, values) => ({ kind: 'set', fact, op: 'includesAny', values });
const isTrue = (fact) => ({ kind: 'compare', fact, op: 'eq', value: true });

const ABSTAIN = (code, reason) => ({ decision: 'abstain', code, reason });
const EXTRACT = (criterion, reason) => ({ decision: 'extract', code: 'EXTRACT', reason, criterion });

/**
 * Decide the outcome for a single income figure given the structural context
 * that governs it: `scope` is a single string concatenating every structural
 * ancestor (heading path, run-in heading, list stem, column header) plus the
 * figure's own clause; `ctx` carries structured extras.
 */
export function classifyCandidate(cand, scope, ctx = {}) {
  const hay = `${scope} ${cand.clause}`;

  if (cand.kind === 'bare-dollar') {
    if (RE.processingReporting.test(hay)) {
      return ABSTAIN('PROCESSING_OR_REPORTING', `$${cand.dollar} sits under a processing/reporting signal (${firstMatch(RE.processingReporting, hay)}), not an eligibility bar`);
    }
    if (RE.crossReferenceTree.test(ctx.crossRefHay ?? hay)) {
      return ABSTAIN('CROSS_REFERENCE_TREE', `$${cand.dollar} appears in a clause that defers to other sections; the operative rule is not here`);
    }
    return ABSTAIN('NO_SCALE', `bare dollar figure ($${cand.dollar}) with no percent and no named income scale -- cannot become incomeAtOrBelow without inventing a yardstick`);
  }
  if (!cand.scale) {
    return ABSTAIN('NO_SCALE', `"${cand.percent}%" with no resolvable income scale in scope`);
  }

  const gateHay = `${hay} ${ctx.gateHay ?? ''}`;

  if (RE.composition.test(hay) && !RE.eligibilityContext.test(cand.clause)) {
    return ABSTAIN('COMPOSITION_NOT_ELIGIBILITY', `${cand.percent}% governs household composition (${firstMatch(RE.composition, hay)}), not program eligibility`);
  }
  // Co-condition gates first: a scope-defining condition on the figure is a
  // more specific signal than a stray cost/processing word in the context.
  if (RE.floorNotCeiling.test(hay)) {
    return ABSTAIN('FLOOR_OR_RANGE', `${cand.percent}% is a lower bound or one end of a range (${firstMatch(RE.floorNotCeiling, hay)}), not a "<= X" eligibility ceiling`);
  }
  if (RE.ageBandGate.test(gateHay) || RE.disabilityGate.test(gateHay)) {
    const which = RE.disabilityGate.test(gateHay) ? RE.disabilityGate : RE.ageBandGate;
    return ABSTAIN('UNDECIDABLE_COCONDITION', `${cand.percent}% is gated by an age band or a disability/level-of-care determination (${firstMatch(which, gateHay)}) -- age and disability are reserved, unasked facts`);
  }
  if (RE.undecidableGate.test(gateHay)) {
    return ABSTAIN('UNDECIDABLE_COCONDITION', `${cand.percent}% is gated by a co-condition with no fact in the vocabulary (${firstMatch(RE.undecidableGate, gateHay)})`);
  }
  if (RE.exceptionAllowance.test(hay)) {
    return ABSTAIN('EXCEPTION_ALLOWANCE_BRANCH', `${cand.percent}% is inside an exception / additional-allowance branch (${firstMatch(RE.exceptionAllowance, hay)}) and does not carry the base rule's scope`);
  }
  if (RE.processingReporting.test(hay)) {
    return ABSTAIN('PROCESSING_OR_REPORTING', `${cand.percent}% sits under a processing/reporting signal (${firstMatch(RE.processingReporting, hay)}), not an eligibility bar`);
  }
  if (RE.costSharing.test(scope)) {
    return ABSTAIN('COST_SHARING_TIER', `${cand.percent}% is a cost-sharing tier boundary (${firstMatch(RE.costSharing, scope)}); the source sets no income ceiling to enroll`);
  }
  if (RE.dualTest.test(hay)) {
    return ABSTAIN('DUAL_TEST', `${cand.percent}% is only one of two required income tests here (gross AND net); the net test runs through a deduction stack the fact vocabulary cannot represent`);
  }
  if (RE.deductionStack.test(hay)) {
    return ABSTAIN('DEDUCTION_STACK', `${cand.percent}% is entangled with a deduction/net-income computation (${firstMatch(RE.deductionStack, hay)}) the fact vocabulary cannot represent`);
  }
  if (RE.crossReferenceTree.test(ctx.crossRefHay ?? hay)) {
    return ABSTAIN('CROSS_REFERENCE_TREE', `the governing clause defers to other sections (${firstMatch(RE.crossReferenceTree, ctx.crossRefHay ?? hay)}); the real rule is not in this text`);
  }
  if (RE.undecidableGate.test(hay)) {
    return ABSTAIN('UNDECIDABLE_COCONDITION', `${cand.percent}% is gated by a condition with no fact in the vocabulary (${firstMatch(RE.undecidableGate, hay)})`);
  }

  // Clean ceiling in an eligibility context.
  if (RE.eligibilityContext.test(hay)) {
    let node = income(cand.scale, cand.percent);
    const extras = ctx.adminGates ?? [];
    if (extras.length === 1) {
      node = allOf(node, review(extras[0]));
    } else if (extras.length > 1) {
      return ABSTAIN('MULTIPLE_ADMIN_GATES', `income ceiling is clean but ${extras.length} co-conditions have no fact: ${extras.join('; ')}`);
    }
    if (ctx.categoricalSlugs?.length) {
      node = anyOf(node, hasAnyOf('currentBenefits', ctx.categoricalSlugs));
    }
    return EXTRACT(node, `${cand.percent}% of ${cand.scale} under an eligibility heading, scope intact`);
  }

  return ABSTAIN('NO_ELIGIBILITY_CONTEXT', `${cand.percent}% of ${cand.scale} found, but no structural signal ties it to "who is eligible" (could be context, a benefit level, a statistic)`);
}

function firstMatch(re, s) {
  const m = s.match(re);
  return m ? `"${m[0].slice(0, 48).trim()}"` : 'signal';
}

export { income, review, anyOf, allOf, hasAnyOf, isTrue, ABSTAIN, EXTRACT, RE, populationOf, scaleOf };
