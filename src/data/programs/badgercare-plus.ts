import type { Program } from '@/domain/program';
import { allOf, anyOf, incomeAtOrBelow, isTrue, livesIn, noneOf } from '@/domain/criteria';

/**
 * Wisconsin never expanded Medicaid under the ACA, so the "childless adult"
 * threshold most expansion-state datasets assume (138% FPL) does not apply
 * here. Confirmed directly from DHS's own income table
 * (dhs.wisconsin.gov/badgercareplus/fpl.htm, effective 2/1/2026-1/31/2027),
 * fetched via curl with a standard browser user agent (dhs.wisconsin.gov
 * 403s the WebFetch tool specifically, not curl -- see docs/archive/data-sources.md):
 * three tiers, shown here by monthly dollar figure at household size 4 --
 *   Adult (parents/caretaker relatives AND childless adults, one shared
 *     column): $2,750.00/mo = 100% FPL
 *   Children premium threshold: $5,527.50/mo = 201% FPL
 *   Pregnant people and children: $8,415.00/mo = 306% FPL
 * DHS's table does not split parents/caretaker relatives from childless
 * adults -- they share one "Adult" column -- so no manualReview or caveat is
 * needed for that distinction; the anyOf below is exact, not a
 * simplification of something more granular.
 *
 * These figures independently reproduce income-tables.ts's own FPL table at
 * three different percentages: $2,750 x 12 = $33,000 = FPL.bySize[3] exactly
 * (100%); $5,527.50 x 12 = $66,330 = 201% of it exactly; $8,415 x 12 =
 * $100,980 = 306% of it exactly. Issue #3 verified FPL.bySize against
 * aspe.hhs.gov and the Federal Register directly; this is a fourth
 * independent route to the same numbers, from a different agency (WI DHS,
 * not HHS/ASPE) for a different purpose (Medicaid eligibility, not the base
 * poverty guideline itself) -- strong cross-confirmation that FPL.bySize is
 * still correct, not a coincidence of shared sourcing. (Wisconsin Shares'
 * own 200% FPL threshold is a fourth data point on the same table -- see
 * wisconsin-shares-child-care.ts.)
 *
 * The household-level anyOf is deliberately not narrowed to only the
 * pregnant/child branch when children are present: a family at, say, 150%
 * FPL with kids genuinely has children who qualify even though the parents
 * do not, and telling that family "you don't qualify" would be wrong for the
 * members who do. The first eligibilityCaveats entry carries the correction
 * ("only your children may qualify, not you") so an adult reading a match
 * doesn't over-read it. This was deliberately not modelled as manualReview:
 * the threshold math above is exact and fully sourced, and manualReview
 * would under-claim a common, valuable case just to avoid a caveat doing its
 * job.
 *
 * The 0-64 adult scope moved from caveat prose into the rule (issue #88). It
 * had been in eligibilityCaveats[2] only, so the engine -- which never reads
 * caveats -- bucketed a 66-year-old at 80% FPL as `eligible` for a program
 * that does not cover them (issue #79). `age` became an asked fact for this
 * change, so the bound is now `noneOf('age', ['65-plus'])` on the adult
 * branch. It is deliberately not at the top-level allOf: see the rule comment
 * for why the household/pregnancy branch stays open regardless of age. The
 * source claim itself is unchanged from the last verification -- the DHS
 * index page's "ages 0 through 64" line, cited below -- so lastVerified is not
 * moved; only the representation changed.
 *
 * Premium mechanics (201% FPL trigger, capped at 5% of income, coverage
 * never ends for nonpayment) confirmed verbatim from
 * dhs.wisconsin.gov/badgercareplus/faq.htm. The 0-64 age scope and "no
 * enrollment period" claim confirmed from
 * dhs.wisconsin.gov/badgercareplus/index.htm. The federal work requirement
 * caveat (start dates, broad exemption list) confirmed from
 * dhs.wisconsin.gov/medicaid/work.htm -- it does not take effect until
 * January 2027 and is exemption-heavy enough (pregnant people,
 * parents/caretakers of a child under 19, disability, SSI, tribal
 * membership, and more) that it stays prose rather than a rule, the same
 * treatment as SNAP's ABAWD work requirement in foodshare-snap-wi.ts. Phone
 * (1-800-362-3002, ForwardHealth Member Services) and the ACCESS apply URL
 * both confirmed directly and match foodshare-snap-wi.ts, which cites the
 * same DHS-wide contact.
 *
 * Not independently re-confirmed today: the immigration-status caveat below
 * is carried over from foodshare-snap-wi.ts's own caveat of the same shape
 * -- general Medicaid/federal-benefit knowledge that was reasonable to
 * trust, not re-derived from a citizenship-specific DHS page on this visit.
 * Also not confirmed: whether "SSI-Related Medicaid" (which DHS's own
 * continuous-coverage list names as a program distinct from BadgerCare
 * Plus) is the same coverage as BadgerCare Plus for our purposes --
 * deliberately not encoded as a categorical-eligibility branch (the way
 * WIC's hasAnyOf('currentBenefits', [...]) works) because that overlap was
 * not confirmed today.
 */
export const badgercarePlus: Program = {
  id: 'badgercare-plus',
  name: 'BadgerCare Plus',
  administeredBy: 'Wisconsin Department of Health Services',
  jurisdiction: 'state',
  provider: 'government',
  categories: ['health-disability'],

  summary:
    'Wisconsin’s Medicaid program — full health coverage for people ages 0–64 with low income, including pregnant people, children, parents, and caretaker relatives. There is no enrollment period; you can apply any time.',
  benefit:
    'Full health insurance: doctor visits, prescriptions, urgent and emergency care, lab tests, mental health care, and more, through a ForwardHealth card.',

  eligibility: allOf(
    livesIn.wisconsin,
    anyOf(
      // The adult pathway (parents/caretakers and childless adults, 19-64, at
      // or below 100% FPL). The age bound gates only this branch, not the
      // household anyOf: a 66-year-old raising a grandchild has a grandchild
      // who qualifies through the branch below, and ruling the whole record
      // out on the applicant's age would be exactly the wrong-exclusion error
      // #5 §4.4 warns against. An unanswered age leaves `noneOf` at `unknown`,
      // so this branch stays `unknown` and the record stays in "might qualify"
      // -- it is never ruled out for a blank answer. Only an explicit "65 or
      // older" fails it. See issue #88.
      allOf(noneOf('age', ['65-plus']), incomeAtOrBelow('fpl', 100)),
      allOf(
        anyOf(isTrue('isPregnantOrPostpartum'), isTrue('hasChildUnder5'), isTrue('hasSchoolAgeChild')),
        incomeAtOrBelow('fpl', 306),
      ),
    ),
  ),
  eligibilityCaveats: [
    'Adults — both parents/caretaker relatives and adults without children — are capped at 100% of the federal poverty level regardless of household composition. Only pregnant people and children under 19 qualify up to 306% FPL, so at some income levels only your children may qualify, not you. Apply anyway.',
    'Children ages 1–18 with family income over 201% FPL are charged a monthly premium (no more than 5% of counted income). Coverage does not end for not paying it.',
    'Covers ages 0–64. If you are 65 or older, or need disability- or long-term-care-related Medicaid, a different Medicaid pathway applies — contact your agency. A younger spouse or child in your household may still qualify here.',
    'A new federal work requirement (from the One Big Beautiful Bill Act) starts affecting some members ages 19–64 beginning January 2027. Pregnant people, parents/caretakers of a child under 19, people with disabilities, and several other groups are exempt.',
    'Immigration status affects eligibility for some household members. Children are often eligible even when adults are not.',
  ],

  howToApply: {
    // access.wi.gov/s/ 301-redirects here; recorded as the destination, not
    // the redirector, per docs/data-authoring.md.
    url: 'https://access.wi.gov/s/?language=en_US',
    phone: '1-800-362-3002',
    steps: [
      'Apply online through ACCESS Wisconsin, by phone, or in person at your county or Tribal agency — there is no enrollment period, so you can apply any time.',
      'Have Social Security numbers, income, and household details ready for everyone applying.',
      'After approval, you will get a ForwardHealth card in the mail.',
    ],
  },

  status: 'open',
  source: {
    url: 'https://www.dhs.wisconsin.gov/badgercareplus/index.htm',
    name: 'Wisconsin DHS — BadgerCare Plus',
    lastVerified: '2026-08-31',
  },
};
