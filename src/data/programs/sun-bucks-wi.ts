import type { Program } from '@/domain/program';
import { allOf, anyOf, hasAnyOf, incomeAtOrBelow, isTrue, livesIn } from '@/domain/criteria';

export const sunBucksWi: Program = {
  id: 'sun-bucks-wi',
  // Wisconsin DHS's own site calls this "Summer EBT" throughout and never
  // uses "SUN Bucks" (the USDA national brand name) anywhere on the page;
  // kept parenthetically since that's the name people may have heard on the
  // news.
  name: 'Summer EBT (SUN Bucks)',
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
    'Most eligible children are enrolled automatically — the state matches records from FoodShare, W-2, Medicaid, and school meal applications. Apply directly only if you are not contacted and believe your child qualifies.',
    'The child must attend a school that takes part in the National School Lunch Program. Children at schools that don’t (including homeschooled or fully virtual students) cannot get this through a direct application — check with the school.',
  ],

  howToApply: {
    // sunbucks/index.htm no longer resolves to real content (DHS's own site
    // returns its "This Page Does Not Exist" page there); the program lives
    // at /sebt/ now under the "Summer EBT" name DHS actually uses.
    url: 'https://www.dhs.wisconsin.gov/sebt/index.htm',
    steps: [
      'Check whether your child was already enrolled automatically — most eligible children are.',
      'If not, and your child’s school participates in the National School Lunch Program, apply directly online during the summer application window.',
    ],
  },

  status: 'seasonal',
  seasonalNote: 'Benefits are issued over the summer and the direct-application window is limited.',
  source: {
    url: 'https://www.dhs.wisconsin.gov/sebt/index.htm',
    name: 'Wisconsin DHS — Summer EBT',
    // Confirmed via direct fetch (curl, standard browser user agent).
    // dhs.wisconsin.gov/sunbucks/index.htm (the old URL here) returns DHS's
    // own "This Page Does Not Exist" page -- it is a soft-404 (HTTP 200 with
    // an error page), not a real redirect, so there's no way to tell from the
    // response alone whether this URL ever pointed at real content; treat it
    // as "never confirmed correct" rather than "moved," per the general
    // pattern flagged for the other dead energyandhousing.wi.gov / dpi.wi.gov
    // / cityofmadison.com URLs in this dataset. Confirmed the 185% FPL income
    // limit shape (dhs.wisconsin.gov/sebt/qualify.htm, "Summer EBT income
    // limits," effective 7/1/2026-6/30/2027, identical table to WIC's) and
    // the categorical/auto-qualifying program list (FoodShare, W-2, FDPIR,
    // "certain income-based Medicaid programs").
    lastVerified: '2026-08-21',
  },
};
