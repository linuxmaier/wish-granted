import type { Program } from '@/domain/program';
import { anyOf, hasAnyOf, incomeAtOrBelow } from '@/domain/criteria';

/**
 * One of the few genuinely nationwide programs in the seed set, so it carries
 * no geography criterion at all. It is a useful test case: it should surface
 * for someone outside Wisconsin, when almost nothing else does.
 */
export const lifelinePhoneInternet: Program = {
  id: 'lifeline-phone-internet',
  name: 'Lifeline (phone and internet discount)',
  administeredBy: 'Federal Communications Commission, via the Universal Service Administrative Company',
  jurisdiction: 'federal',
  provider: 'government',
  categories: ['housing-utilities'],

  summary:
    'A monthly discount on phone or internet service. Available in every state, including for people who move.',
  benefit:
    'A monthly discount of up to $9.25 on one phone or internet bill per household, with a larger discount on Tribal lands.',

  eligibility: anyOf(
    incomeAtOrBelow('fpl', 135),
    hasAnyOf('currentBenefits', ['snap-foodshare', 'medicaid-badgercare', 'ssi', 'housing-choice-voucher']),
  ),
  eligibilityCaveats: [
    'One discount per household, not per person.',
    'You must recertify each year or the discount stops.',
    'You choose a participating provider; not every carrier takes part.',
  ],

  howToApply: {
    url: 'https://www.lifelinesupport.org/',
    phone: '1-800-234-9473',
    steps: [
      'Check that a participating provider serves your address.',
      'Apply online through the National Verifier.',
      'Contact the provider you chose to apply the discount to your bill.',
    ],
  },
  requiredDocuments: ['Proof of income or proof of benefit enrollment', 'Photo ID'],

  status: 'open',
  source: {
    url: 'https://www.lifelinesupport.org/',
    name: 'Lifeline Support — Universal Service Administrative Company',
    // Confirmed via direct fetch (curl, standard browser user agent) of the
    // homepage and /how-to-qualify/: 135% FPL threshold confirmed verbatim
    // ("You can get Lifeline if your income is at 135% or less than the 2026
    // Federal Poverty Guidelines"), $9.25 standard monthly discount, and the
    // categorical-eligibility program list, which also includes Federal
    // Public Housing Assistance and Housing Choice Voucher (added 'ssi' was
    // already present; added 'housing-choice-voucher' above). The phone
    // number was not found on either fetched page directly, but is
    // corroborated by USAC's own contact page and the FCC's Lifeline
    // consumer page via search, so kept rather than dropped.
    lastVerified: '2026-08-21',
  },
};
