import { allOf, anyOf, hasAnyOf, is, isTrue, livesIn, manualReview } from '@/domain/criteria';
import type { Program } from '@/domain/program';

/**
 * "Homeless or at risk of becoming homeless" is two existing facts, not a new
 * one: `housingStatus: 'unhoused-or-temporary'` and `facingLossOfHousing`.
 *
 * Roughly 15 corpus candidates coin a homelessness-status fact of their own
 * and every one of them maps onto one of those two. See docs/data-authoring.md,
 * "Facts an existing answer already gives you".
 */
export const wiVeteransHousingRecovery: Program = {
  id: 'wi-veterans-housing-recovery',
  name: 'Veterans Housing and Recovery Program',
  administeredBy: 'Wisconsin Department of Veterans Affairs',
  jurisdiction: 'state',
  provider: 'government',
  categories: ['housing-utilities', 'veterans'],

  summary:
    'A place to live for Wisconsin veterans who are homeless or close to it, with meals, job training and a case worker, while you work toward permanent housing. Wisconsin has one site, at Union Grove near Racine.',
  benefit:
    'A room at the Union Grove site with three meals a day, laundry, internet, and transportation help when available, plus case-managed support toward housing, work, education, healthcare and recovery goals.',

  eligibility: allOf(
    livesIn.wisconsin,
    // Spouses and children cannot live on site, so only the veteran route
    // qualifies here -- see the caveats.
    hasAnyOf('veteranConnection', ['veteran']),
    anyOf(is('housingStatus', 'unhoused-or-temporary'), isTrue('facingLossOfHousing')),
    manualReview(
      'The Union Grove site decides who comes in, and there is one site for the whole state. Call them to ask about a referral and whether there is room right now.',
    ),
  ),
  eligibilityCaveats: [
    'There is no income limit published for this program. Being homeless, or close to it, is the test.',
    'Spouses and children cannot live at the site. Staff will help a veteran\'s family find housing and other resources separately.',
    'This is one residential site, at Union Grove near Racine — not something available in Madison. Moving there is the program.',
    'Referrals often come through the VA, a County Veterans Service Office, or a homeless-services agency, and going through one of those is usually faster than calling cold.',
  ],

  howToApply: {
    url: 'https://dva.wi.gov/services/housing-and-financial-services/veterans-housing-and-recovery/',
    phone: '262-878-9151',
    steps: [
      'Call the Union Grove site on (262) 878-9151 to ask about referrals and applications.',
      'Or ask the VA, your County Veterans Service Office, or a shelter to refer you.',
      'If there is room and the program fits what you need, you move in and start a goal plan.',
    ],
  },

  status: 'open',
  source: {
    url: 'https://dva.wi.gov/services/housing-and-financial-services/veterans-housing-and-recovery/',
    name: 'Wisconsin DVA — Veterans Housing and Recovery Program',
    // NOT marked verified -- no human has read this source; an agent fetched
    // it on 2026-09-12 and everything below is quoted from what came back.
    //
    // Confirmed directly on the page: "provides temporary housing, training,
    // and supportive services to military veterans, men and women, who are
    // homeless or at risk of becoming homeless" -- which is the entire
    // published eligibility rule; "While spouses and children are not
    // eligible to live at VHRP sites, our staff works to help veteran
    // families access housing and other resources"; the single Wisconsin
    // location (21425 Spring Street, Building D, Fairchild Hall, Union Grove,
    // WI 53182) and its phone, 262.878.9151; "Please contact the Union Grove
    // VHRP site directly for questions about referrals, applications, and
    // program information"; and the amenities list behind `benefit`.
    //
    // The page states no income test, no discharge requirement, and no
    // waiting list, so `status` is 'open' and the capacity limit is a
    // `manualReview` note rather than a 'waitlist' status -- calling it a
    // waitlist would be an inference, not something the source says.
    //
    // NOT confirmed: that referrals commonly come via the VA, a CVSO or a
    // homeless-services provider (that caveat is general knowledge about how
    // residential veteran programs are entered, not a claim on this page),
    // and whether Union Grove is still the only Wisconsin site. Whoever
    // verifies this should call 262-878-9151 and ask both.
    lastVerified: null,
  },
};
