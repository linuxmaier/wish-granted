import type { Program } from '@/domain/program';
import { allOf, anyOf, incomeAtOrBelow, isTrue, livesIn, manualReview } from '@/domain/criteria';

/**
 * Initial eligibility is a gross monthly income test at or below 200% FPL,
 * confirmed independently on three separate DCF pages fetched directly
 * today: dcf.wisconsin.gov/wishares/parents, dcf.wisconsin.gov/wishares/apply,
 * and the citizen-facing eligibility brochure (dcf.wisconsin.gov/files/
 * publications/pdf/5186.pdf, via pdftotext), all citing the same "2026
 * Federal Poverty Level (FPL) and State Median Income (SMI) Limits Table...
 * Effective February 1, 2026" and the same $5,500.00/month figure at
 * household size 4. $5,500 x 12 = $66,000 = exactly 200% of
 * income-tables.ts's FPL.bySize[3] ($33,000) -- another exact
 * cross-confirmation of that table, alongside the three BadgerCare tiers
 * (see badgercare-plus.ts's source comment).
 *
 * An earlier WebSearch summary (not a direct fetch) reported this threshold
 * as 185% FPL. That number is wrong -- 185% is WIC's threshold, not
 * Wisconsin Shares' -- and would have wrongly excluded every household
 * between 185% and 200% FPL from a real match, exactly the under-claiming
 * failure mode this project cares most about. Fetching the actual DCF pages
 * directly instead of trusting the summary caught it before it reached the
 * record. Do not use 185% here.
 *
 * dcf.wisconsin.gov/wishares/eligibility -- the URL that looks like the
 * canonical "eligibility guidelines" page from its own name and from search
 * results -- 307-redirects to a SAML staff login
 * (dcf.wisconsin.gov/saml/login?destination=/wishares/eligibility) and is
 * not citizen-facing. Do not "correct" source.url to point there; the
 * parents page below is the real public page and carries the same figures.
 *
 * Approved-activity requirement ("Parents must be working or participating
 * in another approved activity to receive Wisconsin Shares subsidy") is
 * confirmed verbatim from the same three pages, with the eligibility
 * brochure enumerating activities as: work, education, apprenticeships, W-2
 * or Tribal TANF program participation, W-2/FSET-assigned activities, and
 * (for those under 20) completing high school or equivalency. This spans
 * enum-shaped facts (employment status) and non-employment ones (school
 * enrollment, program assignment) at once, so a single employmentStatus
 * compare could not express it even if it were asked -- deliberately not
 * added to facts.ts or given a question. Adding the fact would not remove
 * this program's manualReview cap either way: the gate would still need the
 * education/training/W-2 branches an enum can't cover, so it would add
 * interview friction for every user and change this record's outcome for
 * nobody. See the eligibility node's manualReview note and the first caveat
 * below for how the requirement is surfaced instead. (Reported to the
 * coordinator per issue #40 rather than added unilaterally, since #9 owns
 * the deferred-fact calculus. #9's frequency count moves from 0-of-15 to
 * 1-of-17 with this program in the dataset, but frequency isn't the
 * deciding argument here -- the shape mismatch above is.)
 *
 * Child age cutoff -- "children under the age of 13. If a child has a
 * disability, the family may remain eligible until the child's 19th
 * birthday" -- confirmed verbatim from the eligibility brochure. This is
 * narrower than hasSchoolAgeChild's own definition in screens.ts ("a
 * school-age child (K-12)", i.e. up to about 18), so including it here can
 * over-include a household whose only child is 13-18 without a disability.
 * Included anyway, deliberately: this program is manualReview-capped by the
 * activity requirement above, so it can never resolve to an outright "you
 * qualify" -- over-inclusion here costs a wasted lead at worst, never a
 * false positive, while excluding hasSchoolAgeChild entirely would drop
 * ages 5-12 (before/after-school and summer care), which is most of what
 * the program actually serves. The second caveat below names the real
 * cutoff so a family with only teenagers can rule themselves out correctly.
 *
 * Not independently re-confirmed today: nothing load-bearing -- but note the
 * immigration-status caveat below *is* freshly confirmed (unlike
 * badgercare-plus.ts's caveat of the same name, which is carried over from
 * foodshare-snap-wi.ts and not re-checked today): it is taken directly from
 * the brochure's own "Families receiving Wisconsin Shares must live in
 * Wisconsin and their children must be United States citizens or qualifying
 * immigrants to be eligible" sentence. No statewide applicant phone number
 * was found -- DCF routes applicants to per-county Income Maintenance
 * agencies, and the only numbers on these pages are Milwaukee-specific
 * (1-888-947-6583) and an ADA accommodations line (608-422-6002) -- so
 * howToApply.phone is omitted rather than guessed.
 */
export const wisconsinSharesChildCare: Program = {
  id: 'wisconsin-shares-child-care',
  name: 'Wisconsin Shares Child Care Subsidy',
  administeredBy: 'Wisconsin Department of Children and Families',
  jurisdiction: 'state',
  provider: 'government',
  categories: ['childcare-education'],

  summary:
    'Helps pay for child care so parents and caregivers can work, go to school, or take part in an approved job-training program. Funds are loaded onto an EBT card you use to pay your child care provider.',
  benefit:
    'A monthly child care subsidy covering part of your child care costs. The amount depends on your family’s size, income, and approved activity hours.',

  eligibility: allOf(
    livesIn.wisconsin,
    anyOf(isTrue('hasChildUnder5'), isTrue('hasSchoolAgeChild')),
    incomeAtOrBelow('fpl', 200),
    manualReview(
      'Wisconsin Shares requires a parent or caregiver to be working, in school, or in an approved job-training or W-2/FoodShare Employment and Training activity. Contact your local agency to confirm your activity qualifies.',
    ),
  ),
  eligibilityCaveats: [
    'A parent, foster parent, or kinship caregiver must be working, attending school, or in an approved job-training, apprenticeship, or W-2/FoodShare Employment and Training (FSET) activity to receive the subsidy.',
    'Children must be under 13, or under 19 if the child has a disability, to qualify. This app’s "school-age child" answer covers ages 5–18 (K–12), which is broader than that cutoff — if your only child is a teenager 13 or older without a disability, you likely do not qualify even if this program appears.',
    'Children receiving the subsidy must be U.S. citizens or qualifying immigrants; parents do not need to be.',
    'Once approved, you can stay eligible until your income reaches 85% of the state median income, which is higher than the 200% FPL limit to first qualify — an income increase after enrolling usually does not end your subsidy right away.',
    'The child care provider must be licensed, certified, or operated by a Wisconsin public school board, and must have a YoungStar quality rating of at least 2 stars.',
  ],

  howToApply: {
    // access.wi.gov/s/ 301-redirects here; recorded as the destination, not
    // the redirector, per docs/data-authoring.md.
    url: 'https://access.wi.gov/s/?language=en_US',
    steps: [
      'Apply online through ACCESS Wisconsin, or contact your county or Tribal Income Maintenance agency to apply by phone or in person.',
      'Complete an eligibility interview and report your family size, income, and approved activity.',
      'After approval, complete a child care needs assessment within 30 days to set your subsidy amount.',
    ],
  },

  status: 'open',
  source: {
    url: 'https://dcf.wisconsin.gov/wishares/parents',
    name: 'Wisconsin DCF — Wisconsin Shares for Parents and Caregivers',
    lastVerified: '2026-08-31',
  },
};
