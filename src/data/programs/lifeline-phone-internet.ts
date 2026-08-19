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
    'A monthly discount on one phone or internet bill per household, with a larger discount on Tribal lands.',

  eligibility: anyOf(
    incomeAtOrBelow('fpl', 135),
    hasAnyOf('currentBenefits', ['snap-foodshare', 'medicaid-badgercare', 'ssi']),
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
    lastVerified: null,
  },
};
