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
    phone: '1-800-722-2295',
    steps: [
      'Call your local WIC agency to book an appointment.',
      'Bring ID, proof of address, and proof of income.',
      'Attend a short appointment where height, weight, and iron levels are checked.',
    ],
  },
  requiredDocuments: ['Photo ID', 'Proof of Wisconsin address', 'Proof of income'],

  status: 'open',
  source: {
    url: 'https://www.dhs.wisconsin.gov/wic/index.htm',
    name: 'Wisconsin DHS — WIC',
    lastVerified: null,
  },
};
