/**
 * Deterministic, model-free rule-presence detection for triage (issue #68).
 *
 * Triage answers "does this source state eligibility at all, and if so is it
 * worth an extraction attempt?" The deterministic Tier-3 parser
 * (scripts/tier3-extract) already answers a narrower question at zero token
 * cost -- "is there a cleanly parseable income/categorical rule here?" -- and
 * emits a reason code when it abstains. This module supplies the other half: a
 * scan of the source's meaningful text for two kinds of signal, each quoting
 * the governing span the way scripts/llm-extraction/framing/classify-role.ts
 * does when its scope-signal detection fires (#64):
 *
 *   - RULE-PRESENT signals: the page states an eligibility condition of some
 *     kind -- an income ceiling, a categorical enrolment route, a "you qualify
 *     if", a "must be", an "income limit" table. The rule may be unparseable by
 *     the deterministic path (on a subpage, in a linked PDF, scoped by a table
 *     column) -- that is exactly what the agentic extractor is for.
 *
 *   - NO-RULE signals: the source explicitly declines to state a rule -- "this
 *     is not an application", "no guarantee", "we do not determine
 *     eligibility", "no income requirement", "no documentation required", "open
 *     to anyone", a bare "call 211 / a referral specialist will help you". This
 *     is Tier 4 of docs/eligibility-extraction.md Section 2 (~24% of the
 *     surveyed corpus).
 *
 * The router (./route.ts) combines these with the parser's outcome. The bar for
 * routing to `no-rule-published` is deliberately high -- a NO-RULE signal AND no
 * countervailing RULE-PRESENT signal AND the parser found nothing -- because a
 * false "no rule here" is a silent loss (the program is never extracted and
 * nobody notices), while a false "worth extracting" costs a few cents and
 * produces a visible abstention (#68, the asymmetry).
 *
 * NO MODEL. Pure regex over normalised text. The optional live classifier in
 * ./classify-source.ts is a separate, key-gated confirmation step.
 */

export type SignalKind = 'rule-present' | 'no-rule';

export interface Signal {
  readonly kind: SignalKind;
  /** Short tag for the pattern that fired, for aggregate reporting. */
  readonly tag: string;
  /** The matched span plus a little context, quoted verbatim from the source. */
  readonly quote: string;
}

export interface SignalScan {
  readonly rulePresent: readonly Signal[];
  readonly noRule: readonly Signal[];
}

interface Pattern {
  readonly tag: string;
  readonly re: RegExp;
}

/**
 * The source states an eligibility condition. These are intentionally broad:
 * the question here is "is there a rule to extract", not "can we parse it".
 */
const RULE_PRESENT_PATTERNS: readonly Pattern[] = [
  { tag: 'percent-of-scale', re: /\b\d{2,3}\s?(?:percent|%)\s+of\s+(?:the\s+)?(?:federal\s+)?(?:poverty|median income|fpl|smi|ami)\b/i },
  { tag: 'poverty-line', re: /\b(?:at or below|under|below|within|up to)\b[^.]{0,40}\bpoverty (?:line|level|guidelines?)\b/i },
  // "income limit" only counts as a rule-present signal when a concrete
  // follow-on makes it an actual bound -- not "income limits are not published"
  // or "income limits change", which are Tier-4 declines.
  { tag: 'income-limit-phrase', re: /\bincome (?:limit|limits|guidelines?|threshold|cap|ceiling)\b[^.]{0,40}(?:\$\s?\d|\b\d{2,}\b|\d\s?(?:percent|%)|of (?:the )?(?:federal )?poverty|by (?:household|family) size|as follows|(?:are|is) shown|:)/i },
  { tag: 'income-requirement', re: /\b(?:meet|meets|meeting|satisfy) (?:the )?income (?:requirements?|guidelines?|limits?|test|criteria)\b/i },
  { tag: 'monthly-income-figure', re: /\bincome\b[^.]{0,40}\$\s?[\d,]{3,}\b|\$\s?[\d,]{3,}[^.]{0,20}\b(?:per month|monthly|a month|per year|annually)\b/i },
  { tag: 'eligible-if', re: /\byou (?:are|may be|might be|could be) eligible\b|\byou (?:can|may) (?:get|receive|qualify for)\b|(?<!need )(?<!have )\bto (?:be eligible|qualify)(?:,|:| you must| for [a-z])|\bwho (?:is|may be) eligible\b|\bqualify for [\w -]{3,40} if\b|\byou qualify if\b/i },
  { tag: 'must-be', re: /\byou must (?:be |have |meet |earn |make )\b|\bmust (?:meet|have|satisfy) (?:all|one|any) of the following\b|\bmust be (?:a |an )?(?:wisconsin|dane county|city of madison|state) resident\b/i },
  { tag: 'categorical-enrolment', re: /\bif you (?:\(or [^)]+\) )?(?:already )?(?:get|receive|use|participate in|are enrolled in|have)\b[^.]{0,80}\b(?:snap|foodshare|medicaid|badgercare|ssi|tanf|w-?2|wic|section 8|housing choice voucher)\b/i },
  { tag: 'adjunctive', re: /\b(?:adjunctive|categorical(?:ly)?)\s+eligib/i },
  { tag: 'age-band-gate', re: /\bages?\s+\d{2}\s*(?:to|through|-|and)\s*\d{2}\b|\b\d{1,2}\s*(?:through|to)\s*\d{2}\b\s*(?:who|with)\b|\b(?:age|aged)\s+\d{2}\s+(?:years?\s+)?or older\b|\bunder (?:age )?\d{2}\b/i },
  { tag: 'low-income-served', re: /\blow[- ]income\b[^.]{0,60}\b(?:famil|household|people|person|resident|individual|jobs?|worker|senior)/i },
  { tag: 'income-based', re: /\bincome[- ]based (?:program|eligibility)\b|\beligibility is (?:based on|determined by)\b[^.]{0,40}\bincome\b/i },
];

/**
 * The source declines to state a rule. A NO-RULE hit only matters when the
 * parser also found nothing and no RULE-PRESENT signal competes with it -- the
 * router enforces that.
 */
const NO_RULE_PATTERNS: readonly Pattern[] = [
  { tag: 'not-an-application', re: /\b(?:this is |it is )?not an application\b|\bdoes not (?:constitute|serve as) an application\b/i },
  { tag: 'no-guarantee', re: /\bno guarantee\b|\bdoes not guarantee\b|\bdoesn'?t guarantee\b/i },
  // NOTE: "the only way to know is to apply" is deliberately NOT a no-rule
  // signal. BadgerCare Plus says exactly that and it publishes an income + age
  // rule -- the phrase hedges the complexity, it does not decline to have a
  // rule. Treating it as Tier 4 is the silent-loss error #68 warns about.
  { tag: 'we-dont-determine', re: /\bwe do not (?:determine|decide|assess) (?:your )?eligibility\b|\beligibility is (?:not|never) (?:determined|decided) (?:here|on this page)\b/i },
  { tag: 'not-published', re: /\b(?:limits?|guidelines?|thresholds?|criteria|requirements?) (?:change and )?are not published\b|\bnot published (?:here|publicly)\b|\bare not published (?:in a way|anywhere)\b/i },
  { tag: 'screening-tool', re: /\b(?:pre-?)?screening (?:tool|questionnaire|form)\b|\bthis (?:tool|questionnaire) (?:does not|will not)\b/i },
  { tag: 'no-income-test', re: /\bno income (?:test|requirement|limit|guidelines?|verification|check)\b|\bincome is not (?:a factor|checked|verified|required)\b|\bregardless of income\b/i },
  { tag: 'no-documentation', re: /\bno (?:identification|proof of income|documentation|paperwork|proof|referral)\b[^.]{0,40}\b(?:is )?(?:required|needed)\b|\bno documentation (?:is )?(?:required|needed)\b|\bno questions asked\b/i },
  { tag: 'open-to-anyone', re: /\b(?:open to|available to|serves|welcomes|help) (?:anyone|everyone|all)\b[^.]{0,40}\b(?:who|need|regardless)\b|\banyone (?:who needs|in need|can (?:come|visit|walk))\b/i },
  { tag: 'referral-service', re: /\breferral (?:service|specialist|line|helpline)\b|\bconnects? you (?:to|with) (?:local )?(?:assistance|programs|services|resources)\b|\bdial 211\b|\bwarm handoff/i },
  { tag: 'no-eligibility-requirements', re: /\bno eligibility (?:requirements?|criteria|rules?)\b|\byou do not need to qualify\b|\bno (?:need to )?qualif(?:y|ication)\b[^.]{0,30}\bfirst\b/i },
];

/** Longest run of context to keep around a match when quoting it. */
const QUOTE_PAD = 60;

function quoteAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - QUOTE_PAD);
  const end = Math.min(text.length, index + length + QUOTE_PAD);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < text.length ? '...' : '';
  return `${prefix}${text.slice(start, end).trim()}${suffix}`.replace(/\s+/g, ' ');
}

function scan(text: string, patterns: readonly Pattern[], kind: SignalKind): Signal[] {
  const out: Signal[] = [];
  const seenTags = new Set<string>();
  for (const { tag, re } of patterns) {
    const m = re.exec(text);
    if (!m || m.index === undefined) continue;
    if (seenTags.has(tag)) continue;
    seenTags.add(tag);
    out.push({ kind, tag, quote: quoteAround(text, m.index, m[0].length) });
  }
  return out;
}

/**
 * Scan already-normalised meaningful text (scripts/check-sources/lib/normalize).
 * Pass the raw HTML through `normalize()` first.
 */
export function scanSignals(normalisedText: string): SignalScan {
  return {
    rulePresent: scan(normalisedText, RULE_PRESENT_PATTERNS, 'rule-present'),
    noRule: scan(normalisedText, NO_RULE_PATTERNS, 'no-rule'),
  };
}

/**
 * The NO-RULE signal is only decisive when it is not merely the absence of
 * detail. A page that says "open to anyone who needs food, no documentation
 * required" is a genuine Tier-4 decline; a page that says "low-income families
 * may qualify -- the only way to know is to apply" states a rule (an income
 * test) it just does not quantify. `hasDecisiveNoRule` returns true only for the
 * first shape: at least one NO-RULE hit and no RULE-PRESENT hit at all.
 */
export function hasDecisiveNoRule(scanResult: SignalScan): boolean {
  return scanResult.noRule.length > 0 && scanResult.rulePresent.length === 0;
}
