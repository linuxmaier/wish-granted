/**
 * Per-source orchestration for the Tier-3 deterministic-parse spike
 * (issue #62, experiment 3).
 *
 * Ties the structure readers (html-structure.mjs / ecfr-structure.mjs) to the
 * decision logic (classify.mjs): build the structural scope around each income
 * figure, run the classifier, and combine the per-figure verdicts into one
 * decision for the source -- `extract` (with a `Criterion`) or `abstain` (with
 * a reason code).
 */

import { readBlocks } from './html-structure.mjs';
import { readSections } from './ecfr-structure.mjs';
import {
  findCandidates,
  classifyCandidate,
  populationOf,
  scaleOf,
  income,
  allOf,
  anyOf,
  hasAnyOf,
  review,
  RE,
} from './classify.mjs';

// --- categorical-enrollment list -> currentBenefits slugs ------------------

const SLUG_MAP = [
  [/badgercare|medicaid/i, 'medicaid-badgercare'],
  [/foodshare|\bsnap\b|food stamps/i, 'snap-foodshare'],
  [/\btanf\b|w-?2\b|wisconsin works/i, 'w2-tanf'],
  [/\bssi\b|supplemental security income/i, 'ssi'],
  [/\bwic\b|women,? infants,? and children/i, 'wic'],
  [/section 8|housing choice voucher|\bhcv\b/i, 'housing-choice-voucher'],
  [/federal public housing|\bfpha\b/i, 'federal-public-housing'],
  [/wheap|energy assistance|liheap/i, 'wheap-energy-assistance'],
];

function slugsFrom(items) {
  const slugs = new Set();
  let dropped = 0;
  for (const it of items) {
    let hit = false;
    for (const [re, slug] of SLUG_MAP) if (re.test(it)) { slugs.add(slug); hit = true; }
    if (!hit && it.trim()) dropped++;
  }
  return { slugs: [...slugs], dropped };
}

const ABSTAIN_PRIORITY = [
  'COMPOSITION_NOT_ELIGIBILITY',
  'COST_SHARING_TIER',
  'UNDECIDABLE_COCONDITION',
  'MULTIPLE_ADMIN_GATES',
  'EXCEPTION_ALLOWANCE_BRANCH',
  'DUAL_TEST',
  'DEDUCTION_STACK',
  'PROCESSING_OR_REPORTING',
  'CROSS_REFERENCE_TREE',
  'MULTI_POPULATION_TABLE',
  'NO_SCALE',
  'NO_ELIGIBILITY_CONTEXT',
  'NO_RULE_STATED',
];

function combine(verdicts, extras = {}) {
  const extracts = verdicts.filter((v) => v.decision === 'extract');
  if (extracts.length) {
    // An income ceiling and a categorical-enrolment list found on the same page
    // are alternative routes to the same program -- merge them into one anyOf
    // rather than reporting only the "richer" one (matches how the shipped
    // records encode Lifeline, WIC, school meals, ...).
    const incomeV = extracts.find((v) => JSON.stringify(v.criterion).includes('"incomeAtOrBelow"') && !JSON.stringify(v.criterion).includes('"anyOf"'));
    const catV = extracts.find((v) => JSON.stringify(v.criterion).includes('"includesAny"'));
    if (incomeV && catV && incomeV !== catV) {
      return {
        decision: 'extract',
        code: 'EXTRACT',
        reason: `income ceiling and categorical-enrolment list are alternative routes; merged into anyOf`,
        criterion: { kind: 'anyOf', of: [incomeV.criterion, catV.criterion] },
        alternates: verdicts,
      };
    }
    extracts.sort((a, b) => JSON.stringify(b.criterion).length - JSON.stringify(a.criterion).length);
    return { ...extracts[0], alternates: verdicts };
  }
  if (verdicts.length === 0) {
    return { decision: 'abstain', code: 'NO_RULE_STATED', reason: 'no income figure appears anywhere in the source text', alternates: [] };
  }
  verdicts.sort(
    (a, b) => ABSTAIN_PRIORITY.indexOf(a.code) - ABSTAIN_PRIORITY.indexOf(b.code),
  );
  return { ...verdicts[0], alternates: verdicts };
}

// --- HTML -----------------------------------------------------------------

function ceilingColumns(table) {
  const cols = [];
  table.columnHeaders.forEach((h, i) => {
    if (i === 0) return;
    if (/reporting|premium|allotment|maximum|\bbenefit\b/i.test(h)) return;
    const pct = h.match(/(\d{2,3})\s*%|\b(\d{2,3})\s*percent/i);
    if (!/income (limit|eligibility)|gross income limit/i.test(h) && !pct) return;
    const scale = scaleOf(h) ?? scaleOf(table.caption ?? '');
    if (pct && scale) cols.push({ header: h, percent: Number(pct[1] ?? pct[2]), scale, index: i });
  });
  return cols;
}

export function extractFromHtml(html, source) {
  const blocks = readBlocks(html);
  const pageText = blocks.map((b) => b.text).join(' ');
  const verdicts = [];
  const notes = [];

  // 1. Tables -----------------------------------------------------------
  for (const b of blocks.filter((x) => x.type === 'table' && x.table)) {
    const cols = ceilingColumns(b.table);
    const framing = blocks
      .slice(0, blocks.indexOf(b))
      .filter((x) => x.type === 'paragraph' || x.type === 'heading')
      .slice(-4)
      .map((x) => x.text)
      .join(' ');
    const scopeBase = `${b.headingPath.join(' > ')} ${b.table.caption ?? ''} ${framing}`;

    // A pre-derived threshold table: money cells by household size, no percent
    // in any header, but the framing prose names the derivation and says the
    // amounts are the qualifying limit ("at or below the amounts shown may
    // qualify ... Based on 60% of Wisconsin's median income"). The published
    // table already IS the N%-of-scale figure, so the rule compares at 100% of
    // that reference table -- emitting N% would double-apply the percentage.
    const moneyRows = b.table.rows.filter((r) => r.some((cell) => /\$\s?[\d,]{3,}/.test(cell))).length;
    const derived = framing.match(/based on\s+(\d{2})\s*(?:percent|%)\s*of\s+[\w'’ .-]*?(median income|poverty)/i);
    if (cols.length === 0 && moneyRows >= 3 && derived
        && /at or below the amounts shown|income limits? (by household size|shown)|may qualify/i.test(framing)) {
      const scale = /median income/i.test(derived[2]) ? 'wi-smi' : 'fpl';
      verdicts.push({
        decision: 'extract',
        code: 'EXTRACT',
        reason: `pre-derived ${derived[1]}%-of-${derived[2]} table by household size; rule compares at 100% of that reference table (emitting ${derived[1]}% would double-apply it)`,
        criterion: income(scale, 100),
      });
    }

    if (cols.length === 1) {
      const c = cols[0];
      verdicts.push(
        classifyCandidate(
          { kind: 'percent-of-scale', percent: c.percent, scale: c.scale, clause: `${c.header}. ${framing}` },
          `${scopeBase} ${c.header}`,
        ),
      );
    } else if (cols.length >= 2) {
      const mapped = cols.map((c) => ({ c, pop: populationOf(c.header) }));
      if (mapped.some((m) => m.pop === null)) {
        verdicts.push({
          decision: 'abstain',
          code: 'MULTI_POPULATION_TABLE',
          reason: `table has ${cols.length} population-scoped income-limit columns (${cols.map((c) => c.header).join(' | ')}); at least one population phrase has no fact mapping, so no single ceiling can be stated`,
        });
      } else {
        const base = mapped.find((m) => m.pop.anyOf.length === 0);
        const branches = [];
        if (base) branches.push(income(base.c.scale, base.c.percent));
        for (const m of mapped) {
          if (m === base) continue;
          const popNode =
            m.pop.anyOf.length === 1
              ? { kind: 'compare', fact: m.pop.anyOf[0], op: 'eq', value: true }
              : { kind: 'anyOf', of: m.pop.anyOf.map((f) => ({ kind: 'compare', fact: f, op: 'eq', value: true })) };
          branches.push(allOf(popNode, income(m.c.scale, m.c.percent)));
        }
        verdicts.push({
          decision: 'extract',
          code: 'EXTRACT',
          reason: `multi-population table; each percentage kept bound to its column's population scope`,
          criterion: branches.length === 1 ? branches[0] : anyOf(...branches),
        });
      }
    }
  }

  // 2. Categorical-enrollment list ------------------------------------
  const catStem =
    /if you (\(or someone[^)]*\) )?(already )?(use|participate in|get|receive|are enrolled in|have)|you may (be able to get|qualify|meet).*if you|adjunctive|participate in one of these programs|(children in |families )?enrolled in (one of )?the following|already use one of these programs/i;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type !== 'list-item') continue;
    if (!b.listStem || !catStem.test(b.listStem)) continue;
    const groupItems = [];
    for (let j = i; j < blocks.length && blocks[j].type === 'list-item' && blocks[j].listStem === b.listStem; j++) {
      groupItems.push(blocks[j].text);
    }
    const { slugs } = slugsFrom(groupItems);
    if (slugs.length >= 2) {
      verdicts.push({
        decision: 'extract',
        code: 'EXTRACT',
        reason: `categorical-enrollment list under stem "${b.listStem.slice(0, 60)}"; mapped ${slugs.length} programs to currentBenefits slugs, dropped the rest`,
        criterion: hasAnyOf('currentBenefits', slugs),
      });
      notes.push(`categorical list -> ${slugs.join(', ')}`);
    }
    i += groupItems.length - 1;
  }

  // 2b. Categorical-enrolment list stated as prose, not a <ul> -----------
  //     DPI direct certification writes it as one running sentence:
  //     "...children in families enrolled in the following: FoodShare (SNAP),
  //      W-2 (TANF) cash benefits, FDPIR, or the foster care system."
  for (const b of blocks) {
    if (b.type !== 'paragraph') continue;
    const m = b.text.match(
      /(?:participate in|enrolled in|already use|receiving|get)\s+(?:one of\s+)?(?:these programs|the following)[:,]?\s+(.{5,320})/i,
    );
    if (!m) continue;
    const tail = m[1].split(/[,;]|\bor\b|\band\b/i).map((s) => s.trim());
    const { slugs } = slugsFrom(tail);
    if (slugs.length >= 2) {
      verdicts.push({
        decision: 'extract',
        code: 'EXTRACT',
        reason: `categorical-enrolment list stated in prose; mapped ${slugs.length} programs to currentBenefits slugs`,
        criterion: hasAnyOf('currentBenefits', slugs),
      });
      notes.push(`prose categorical list -> ${slugs.join(', ')}`);
      break;
    }
  }

  // 3. Categorical (non-income) situational test ----------------------
  //    "Have one of these apply to you: pregnant ... / care for a child under 5"
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type !== 'list-item' || !b.listStem) continue;
    if (!/one of these apply|have one of the following|serves (people |those )?who are/i.test(b.listStem)) continue;
    const group = [];
    for (let j = i; j < blocks.length && blocks[j].type === 'list-item' && blocks[j].listStem === b.listStem; j++) {
      group.push(blocks[j].text);
    }
    const facts = [];
    if (group.some((g) => /pregnan|had a baby|postpartum/i.test(g))) facts.push('isPregnantOrPostpartum');
    if (group.some((g) => /child (younger than|under) (5|five)|care for a child/i.test(g))) facts.push('hasChildUnder5');
    if (facts.length >= 1) {
      verdicts.push({
        decision: 'extract',
        code: 'EXTRACT',
        reason: `categorical situational test; mapped ${facts.join(' / ')}`,
        criterion: facts.length === 1 ? { kind: 'compare', fact: facts[0], op: 'eq', value: true } : anyOf(...facts.map((f) => ({ kind: 'compare', fact: f, op: 'eq', value: true }))),
      });
    }
    i += group.length - 1;
  }

  // 3b. Categorical situational test stated in a sentence, not a list ----
  //     "WIC serves those who are pregnant, breastfeeding, or postpartum, as
  //      well as infants and children up to age five."
  for (const b of blocks) {
    if (b.type !== 'paragraph') continue;
    if (!/\b(serves|is (a program )?for|helps|available to)\b/i.test(b.text)) continue;
    const facts = [];
    if (/pregnant|postpartum|had a baby/i.test(b.text)) facts.push('isPregnantOrPostpartum');
    if (/child(ren)? (up to|younger than|under) (age )?(5|five)|infants and children/i.test(b.text)) facts.push('hasChildUnder5');
    if (facts.length && !/low.income|income limit/i.test(b.text)) {
      verdicts.push({
        decision: 'extract',
        code: 'EXTRACT',
        reason: `categorical situational test in prose; mapped ${facts.join(' / ')} ("may also apply on behalf of" changes who applies, not who is eligible)`,
        criterion:
          facts.length === 1
            ? { kind: 'compare', fact: facts[0], op: 'eq', value: true }
            : anyOf(...facts.map((f) => ({ kind: 'compare', fact: f, op: 'eq', value: true }))),
      });
      break;
    }
  }

  // 4. Prose / list-item income figures ------------------------------
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type !== 'paragraph' && b.type !== 'list-item') continue;
    const cands = findCandidates(b.text);
    if (!cands.length) continue;

    // AND-list sibling conditions that map to no fact -> admin gates.
    let adminGates = [];
    if (b.type === 'list-item' && b.listStem && RE.listStemAddsConditions.test(b.listStem)) {
      for (let j = i - 1; j >= 0 && blocks[j].type === 'list-item' && blocks[j].listStem === b.listStem; j--) {
        if (RE.undecidableGate.test(blocks[j].text)) adminGates.push(blocks[j].text.slice(0, 80));
      }
      for (let j = i + 1; j < blocks.length && blocks[j].type === 'list-item' && blocks[j].listStem === b.listStem; j++) {
        if (RE.undecidableGate.test(blocks[j].text)) adminGates.push(blocks[j].text.slice(0, 80));
      }
    }
    // A work/school/training-activity requirement is a program-level gate on
    // several WI programs (Wisconsin Shares, W-2). Scan the whole page, not
    // just nearby blocks -- it is often stated in a "what this program does"
    // sentence well away from the income figure.
    if (
      /while parents(,| ).*(work|go to school|job training)|must be (working|in school|in a job training)|engage in (a )?(job training|work) activit|work, (go to school|attend school), or (participate in|engage in)/i.test(
        pageText,
      )
    ) {
      adminGates.push(
        'a work, school, or approved job-training activity is required to be eligible (no fact for this); confirm with the local agency',
      );
    }

    // Scope = structural ancestors (heading stack, list stem) PLUS the sibling
    // list items sharing this stem (an AND-list's other conditions govern the
    // figure) and a short window of surrounding blocks. Deliberately NOT the
    // rest of the candidate's own paragraph -- that would let a later sentence
    // ("...to remain eligible after enrolling") disqualify a clean ceiling in
    // an earlier one; the candidate's own sentence is already in `c.clause`.
    const siblingItems =
      b.type === 'list-item' && b.listStem
        ? blocks
            .filter((x) => x.type === 'list-item' && x.listStem === b.listStem && x !== b)
            .map((x) => x.text)
        : [];
    // Immediately-adjacent prose (not headings, not nav) -- used ONLY to catch
    // hard co-condition gates (age band, disability determination, work
    // requirement, emergency), never the generic processing/cost-sharing
    // signals, which stay local so a neighbouring rule's phrasing cannot
    // disqualify a clean ceiling.
    const gateHay = [blocks[i - 1], blocks[i + 1], blocks[i + 2]]
      .filter((x) => x && (x.type === 'paragraph' || x.type === 'list-item'))
      .map((x) => x.text)
      .join(' ');
    const scope = `${b.headingPath.join(' > ')} | ${b.listStem ?? ''} | ${siblingItems.join(' | ')}`;
    for (const c of cands) {
      verdicts.push(classifyCandidate(c, scope, { adminGates: dedupe(adminGates), gateHay }));
    }
  }

  return finalize(combine(verdicts), notes, verdicts);
}

// --- eCFR ---------------------------------------------------------------

export function extractFromEcfr(xml, source) {
  const sections = readSections(xml);
  const verdicts = [];
  const notes = [];
  const wanted = source.sections;
  // Regex tested against "<citation> <runInHeading>" -- narrows a whole section
  // (e.g. all of 273.2) to the sub-tree this source is about (e.g. expedited
  // service). This is the CFR analogue of the HTML heading stack.
  const paraFilter = source.paragraphFilter ? new RegExp(source.paragraphFilter, 'i') : null;

  let consideredAny = false;

  for (const sec of sections) {
    if (wanted && !wanted.includes(sec.section)) continue;

    for (const p of sec.paragraphs) {
      const targetKey = `${p.citation} ${p.runInHeading}`;
      if (paraFilter && !paraFilter.test(targetKey) && !paraFilter.test(p.fullText)) continue;
      consideredAny = true;

      const cands = findCandidates(p.text);
      if (!cands.length) continue;

      // Structure-preserving scope: this paragraph's own text PLUS every
      // ancestor paragraph (a strict path prefix in the same section). The
      // governing "shall meet both the net and gross standards" language for a
      // 130%-figure in (a)(1)(i) lives in the (a) intro paragraph.
      const ancestorText = sec.paragraphs
        .filter((q) => q.path.length < p.path.length && q.path.every((t, k) => p.path[k] === t))
        .map((q) => q.fullText)
        .join(' ');

      const siblingText = sec.paragraphs
        .filter((q) => q.runInHeading === p.runInHeading && q.letter === p.letter)
        .map((q) => q.fullText)
        .join(' ');
      const categorical =
        /(is|are) eligible if/i.test(siblingText) &&
        /(potentially eligible for public assistance|is homeless|in foster care)/i.test(siblingText);

      const scope = `${sec.sectionHeading} > ${p.runInHeading} [${p.citation}]`;
      for (const c of cands) {
        const v = classifyCandidate(c, `${scope} ${ancestorText} ${p.fullText}`, {
          crossRefHay: `${p.runInHeading} ${ancestorText} ${p.fullText}`,
        });
        if (v.decision === 'extract' && categorical) {
          v.criterion = anyOf(
            v.criterion,
            review(
              'This program also admits families via categorical routes (public assistance, homeless, or foster care) that the fact vocabulary cannot decide. Confirm with the program.',
            ),
          );
          v.reason += ' + categorical alternative kept as a manualReview branch';
        }
        v.citation = p.citation;
        verdicts.push(v);
      }
    }
  }

  const result = combine(verdicts);
  if (verdicts.length === 0 && paraFilter && consideredAny) {
    result.code = 'NO_RULE_STATED';
    result.reason = `the targeted paragraphs (${source.paragraphFilter}) contain no income figure`;
  }
  return finalize(result, notes, verdicts);
}

// --- helpers ----------------------------------------------------------

function dedupe(a) {
  return [...new Set(a)];
}

function finalize(result, notes, allVerdicts) {
  return {
    decision: result.decision,
    code: result.code,
    reason: result.reason,
    criterion: result.criterion ?? null,
    citation: result.citation ?? null,
    notes,
    verdicts: allVerdicts.map((v) => ({ decision: v.decision, code: v.code, reason: v.reason })),
  };
}
