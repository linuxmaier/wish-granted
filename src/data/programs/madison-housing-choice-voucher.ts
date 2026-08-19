import type { Program } from '@/domain/program';
import { allOf, incomeAtOrBelow, livesIn, manualReview, oneOf } from '@/domain/criteria';

export const madisonHousingChoiceVoucher: Program = {
  id: 'madison-housing-choice-voucher',
  name: 'Housing Choice Voucher (Section 8)',
  administeredBy: 'Community Development Authority of the City of Madison',
  jurisdiction: 'city',
  provider: 'government',
  categories: ['housing-utilities'],

  summary:
    'A voucher that pays part of your rent directly to a private landlord. You find the apartment; the voucher covers the difference between roughly 30% of your income and the rent.',
  benefit: 'Ongoing monthly rent assistance paid to your landlord.',

  eligibility: allOf(
    livesIn.madison,
    oneOf('housingStatus', ['renting', 'unhoused-or-temporary', 'living-with-others']),
    incomeAtOrBelow('dane-ami', 50),
    // The waiting list is the binding constraint far more often than income is,
    // and no rules engine can tell someone where they sit on it. Encoding it as
    // `manualReview` keeps this program in "might qualify" rather than promising
    // an outcome the CDA controls.
    manualReview(
      'The waiting list is opened only occasionally and is often closed. Check whether it is currently accepting applications.',
    ),
  ),
  eligibilityCaveats: [
    'Waits are commonly measured in years once the list opens.',
    'A criminal background check and rental history review are part of the process.',
    'Vouchers can usually be transferred to another housing authority after the first year.',
  ],

  howToApply: {
    url: 'https://www.cityofmadison.com/cda/housing-assistance',
    phone: '608-266-4675',
    steps: [
      'Check whether the waiting list is currently open.',
      'Apply online while it is open — the window is often short.',
      'Keep your contact details current; applications are removed if the CDA cannot reach you.',
    ],
  },

  status: 'waitlist',
  source: {
    url: 'https://www.cityofmadison.com/cda/housing-assistance',
    name: 'City of Madison CDA — Housing Assistance',
    lastVerified: null,
  },
};
