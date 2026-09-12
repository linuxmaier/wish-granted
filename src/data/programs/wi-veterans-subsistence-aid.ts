import type { Program } from '@/domain/program';
import { allOf, anyOf, hasAnyOf, incomeAtOrBelow, livesIn, manualReview } from '@/domain/criteria';

/**
 * The 200% FPL cap is inside an `anyOf`, not at the top level, on purpose.
 *
 * VA 2.01(2)(b)3m. opens "Except for an applicant who is eligible under par.
 * (d)" -- and par. (d) is the spouse/dependent of an activated or deployed
 * service member, for whom the poverty guidelines do not apply at all. Lifting
 * the 200% figure to the top of the rule would drop that branch and rule out
 * people the program takes. The carve-out route is itself gated on being a
 * spouse or dependent, so a *veteran* applicant over 200% FPL is still
 * correctly ruled out -- the abstention only widens the people it can reach.
 */
export const wiVeteransSubsistenceAid: Program = {
  id: 'wi-veterans-subsistence-aid',
  name: 'Veterans Subsistence Aid Grant',
  administeredBy:
    'Wisconsin Department of Veterans Affairs — apply through your County or Tribal Veterans Service Office',
  jurisdiction: 'state',
  provider: 'government',
  categories: ['veterans'],

  summary:
    'Short-term cash help with basic living costs for Wisconsin veterans and their families who have lost income because of an illness, an injury, or a natural disaster, and have already used up other help.',
  benefit:
    'Grant payments toward essential living expenses, covering up to a 90-day period. Up to $3,000 in any 12 months, and $7,500 over a lifetime counting the Health Care Aid Grant too.',

  eligibility: allOf(
    livesIn.wisconsin,
    // VA 2.01(2)(b)1. covers a veteran "or is a spouse or dependent of" one,
    // and (2)(c) adds the unremarried surviving spouse. A Gold Star parent is
    // neither, so that value is deliberately not in this list.
    hasAnyOf('veteranConnection', [
      'veteran',
      'spouse-or-partner',
      'surviving-spouse',
      'child-or-dependent',
    ]),
    anyOf(
      incomeAtOrBelow('fpl', 200),
      allOf(
        hasAnyOf('veteranConnection', ['spouse-or-partner', 'child-or-dependent']),
        manualReview(
          'If you are the spouse or dependent child of a service member who is activated or deployed right now, the income limit does not apply to you at all. You would need to show the deployment, the income loss, and that an emergency happened during it.',
        ),
      ),
    ),
    manualReview(
      'The lost income has to be because of an illness, an injury, or a natural disaster, and the grant covers the 90 days after that loss. Apply within 12 months of it.',
    ),
    manualReview(
      'A caseworker decides two things we cannot: whether you have other assets or income that could cover basic needs, and whether you have already applied for and accepted every other county, state and federal aid available. A county official has to sign a "declaration of aid" saying so.',
    ),
  ),
  eligibilityCaveats: [
    'Your County or Tribal Veterans Service Office files this for you, and has to sign off on it. Start there rather than with the state.',
    '"Veteran" here means the definition in Wis. Stat. § 45.01(12), which sets its own rules about length of service, discharge, and a Wisconsin connection. Your service office will tell you whether you meet it.',
    'If the loss of income came from alcohol or other drug use, you need to show you are currently in an approved treatment program.',
    'You will be asked to list household assets and three months of living expenses.',
  ],

  howToApply: {
    url: 'https://dva.wi.gov/services/mental-health-and-emergency-services/subsistence-aid-health-care-aid-grants/',
    phone: '800-947-8387',
    steps: [
      'Contact your County or Tribal Veterans Service Office. In Dane County that is (608) 266-4158.',
      'They help you fill in form WDVA 2453 and sign the declaration of aid.',
      'Apply within 12 months of the loss of income.',
    ],
  },
  requiredDocuments: [
    'Form WDVA 2453 (Subsistence Aid Grant application)',
    'A declaration of aid signed by a county or tribal official',
    'A list of household assets and three months of living expenses',
    'Evidence of the loss of income',
  ],

  status: 'open',
  source: {
    url: 'https://docs.legis.wisconsin.gov/code/admin_code/va/2',
    name: 'Wis. Admin. Code ch. VA 2 (Subsistence and health care aid grant programs)',
    // NOT marked verified -- no human has read these sources; an agent
    // fetched them on 2026-09-12 and the figures below are quoted from what
    // came back, not recalled.
    //
    // Confirmed directly in VA 2.01: the four-part test in (2)(b) -- the
    // s. 45.01(12) veteran-or-spouse-or-dependent condition (b)1., the
    // illness/injury/natural-disaster income loss (b)2m., the "may not exceed
    // 200 percent of the federal poverty guidelines" cap (b)3m., and the
    // "lacks other assets or income" condition (b)4.; the "Except for an
    // applicant who is eligible under par. (d)" opening of (b)3m. and par.
    // (d)'s deployed-family route; the declaration-of-aid requirement
    // (2)(a)4.; the 90-day subsistence period (2)(e)1.; the "Applicant's
    // family" and "liquid assets" definitions in (1r); and the phone number
    // 1-800-WIS-VETS (800-947-8387) in the Note under (2)(a).
    //
    // Confirmed on the WDVA program page (the `howToApply.url` above): the
    // $3,000-per-12-months and $7,500-lifetime caps, the 90-day maximum, the
    // "through your local County or Tribal Veterans Service Office" route,
    // and form number WDVA_2453. That page states no income test at all --
    // anyone stopping at the citizen-facing page would author this record
    // with no income rule and no veteran test, which is why `source.url`
    // points at the code and not at the program page.
    //
    // The (608) 266-4158 number in `howToApply.steps` is the Dane County
    // Veterans Service Office, confirmed on danevets.com/services (see
    // dane-county-veterans-service-office.ts), not on either source above.
    //
    // NOT confirmed: the treatment-program caveat's exact wording (read from
    // (2)(b)2m. in one fetch of the code, not re-read), and whether the FPL
    // table the department applies is the same HHS table in
    // src/data/reference/income-tables.ts -- the code says "the federal
    // poverty guidelines, in effect on the date the application arrives",
    // which is the same series, but the department's own effective-date
    // handling was not checked. Whoever verifies this should also confirm
    // the dollar caps are current, since the corpus research flagged WDVA
    // figures as a place where a stale manual is easy to quote.
    lastVerified: null,
  },
};
