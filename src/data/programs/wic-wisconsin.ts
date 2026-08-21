import type { Program } from '@/domain/program';
import { allOf, anyOf, hasAnyOf, incomeAtOrBelow, isTrue, livesIn } from '@/domain/criteria';

export const wicWisconsin: Program = {
  id: 'wic-wisconsin',
  name: 'Wisconsin WIC',
  administeredBy: 'Wisconsin Department of Health Services',
  jurisdiction: 'state',
  provider: 'government',
  categories: ['food-basic-needs', 'health-disability'],

  summary:
    'Nutrition support for pregnant people, new parents, infants, and children under 5. WIC covers specific healthy foods, plus breastfeeding support and nutrition checkups.',
  benefit:
    'A monthly benefit for specific foods — milk, eggs, produce, infant formula, whole grains — plus nutrition counseling and health referrals.',

  eligibility: allOf(
    livesIn.wisconsin,
    // WIC has a category test and an income test, and both must hold.
    anyOf(isTrue('isPregnantOrPostpartum'), isTrue('hasChildUnder5')),
    anyOf(
      incomeAtOrBelow('fpl', 185),
      hasAnyOf('currentBenefits', ['snap-foodshare', 'medicaid-badgercare', 'w2-tanf']),
    ),
  ),
  eligibilityCaveats: [
    'A WIC clinic also checks for a nutritional or medical need at the first appointment. Most applicants meet this.',
    'Fathers, grandparents, and foster parents can apply on behalf of an eligible child.',
  ],

  howToApply: {
    url: 'https://www.dhs.wisconsin.gov/wic/index.htm',
    // There is no single statewide WIC phone line; DHS publishes a
    // per-county contact list (dhs.wisconsin.gov/wic/apply.htm). The old
    // number here (1-800-722-2295) does not appear anywhere on that current
    // list and could not be confirmed, so it's replaced with the Dane
    // County / Madison office's own published number.
    phone: '608-267-1111',
    steps: [
      'Call the Madison and Dane County WIC office (or your county’s WIC agency if outside Dane County) to book an appointment.',
      'Bring ID, proof of address, and proof of income.',
      'Attend a short appointment where height, weight, and iron levels are checked.',
    ],
  },
  requiredDocuments: ['Photo ID', 'Proof of Wisconsin address', 'Proof of income'],

  status: 'open',
  source: {
    url: 'https://www.dhs.wisconsin.gov/wic/index.htm',
    name: 'Wisconsin DHS — WIC',
    // Confirmed via direct fetch (curl with a standard browser user agent;
    // dhs.wisconsin.gov blocks some automated fetchers by user agent, not by
    // robots.txt). Category test, 185% FPL income limit shape (matches the
    // WIC Income Eligibility Table at dhs.wisconsin.gov/wic/income-guidelines.htm,
    // effective 7/1/2026-6/30/2027), and the categorical-eligibility program
    // list (FoodShare, Medicaid/BadgerCare, W-2/TANF, plus FDPIR which we
    // don't model) all confirmed. Phone number corrected -- see note above.
    lastVerified: '2026-08-21',
  },
};
