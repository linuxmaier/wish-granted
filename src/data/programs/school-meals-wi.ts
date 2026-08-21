import type { Program } from '@/domain/program';
import { allOf, anyOf, hasAnyOf, incomeAtOrBelow, isTrue, livesIn } from '@/domain/criteria';

/**
 * Free and reduced-price meals are really two tiers, at 130% and 185% FPL. They
 * are modelled as one program at the wider threshold because it is a single
 * application form and the district decides the tier, not the applicant. The
 * split is called out in the caveats instead of being encoded as two records.
 */
export const schoolMealsWi: Program = {
  id: 'school-meals-wi',
  name: 'Free and Reduced-Price School Meals',
  administeredBy: 'Wisconsin Department of Public Instruction and your school district',
  jurisdiction: 'state',
  provider: 'government',
  categories: ['food-basic-needs', 'childcare-education'],

  summary:
    'Free or low-cost breakfast and lunch at school for children in households under the income limit. One application covers every child in the household.',
  benefit: 'Free or reduced-price school breakfast and lunch during the school year.',

  eligibility: allOf(
    livesIn.wisconsin,
    isTrue('hasSchoolAgeChild'),
    anyOf(incomeAtOrBelow('fpl', 185), hasAnyOf('currentBenefits', ['snap-foodshare', 'w2-tanf'])),
  ),
  eligibilityCaveats: [
    'Below 130% of the poverty level meals are free; between 130% and 185% they are reduced-price.',
    'Some Wisconsin schools serve free meals to every student regardless of income. Check with your district first.',
    'Households already receiving FoodShare are usually enrolled automatically.',
  ],

  howToApply: {
    // Old URL 404s and has no Wayback snapshot -- reads as never correct.
    url: 'https://dpi.wi.gov/school-nutrition/program-requirements/free-reduced-meal-eligibility',
    steps: [
      'Get the household application from your district, usually online or in the enrollment packet.',
      'List every child and the household income.',
      'Return it to the school. You can apply at any point in the school year.',
    ],
  },

  status: 'open',
  source: {
    url: 'https://dpi.wi.gov/school-nutrition/program-requirements/free-reduced-meal-eligibility',
    name: 'Wisconsin DPI — School Nutrition Programs',
    // Confirmed via direct fetch (curl, standard browser user agent) that
    // this page is live and current, but it's written for school staff, not
    // families, and doesn't itself restate the 130%/185% FPL split or dollar
    // table. That split and the underlying dollar figures are confirmed
    // instead from the identical USDA NSLP income-eligibility table used by
    // WIC and Summer EBT (both fetched directly this session, see
    // wic-wisconsin.ts / sun-bucks-wi.ts), which DPI's own income-guidelines
    // memo references as the same national standard. The Community
    // Eligibility Provision caveat (some schools serve free meals to
    // everyone) is independently confirmed on DHS's Summer EBT qualify page.
    lastVerified: '2026-08-21',
  },
};
