import type { Program } from '@/domain/program';
import { allOf, anyOf, hasAnyOf, incomeAtOrBelow, isTrue, livesIn } from '@/domain/criteria';

export const sunBucksWi: Program = {
  id: 'sun-bucks-wi',
  name: 'SUN Bucks (Summer EBT)',
  administeredBy: 'Wisconsin Department of Health Services',
  jurisdiction: 'state',
  provider: 'government',
  categories: ['food-basic-needs'],

  summary:
    'A summer grocery benefit for school-age children, meant to replace the school meals they lose when classes are out.',
  benefit: 'A summer grocery benefit per eligible child, on a card usable at grocery stores.',

  eligibility: allOf(
    livesIn.wisconsin,
    isTrue('hasSchoolAgeChild'),
    anyOf(
      incomeAtOrBelow('fpl', 185),
      hasAnyOf('currentBenefits', ['snap-foodshare', 'medicaid-badgercare', 'w2-tanf']),
    ),
  ),
  eligibilityCaveats: [
    'Most eligible children are enrolled automatically through FoodShare or their school meal application. Apply only if you are not contacted.',
    'The child must attend a school that takes part in the national school meal programs.',
  ],

  howToApply: {
    url: 'https://www.dhs.wisconsin.gov/sunbucks/index.htm',
    steps: [
      'Check whether your child was enrolled automatically.',
      'If not, apply online during the summer application window.',
    ],
  },

  status: 'seasonal',
  seasonalNote: 'Benefits are issued over the summer and the application window is limited.',
  source: {
    url: 'https://www.dhs.wisconsin.gov/sunbucks/index.htm',
    name: 'Wisconsin DHS — SUN Bucks',
    lastVerified: null,
  },
};
