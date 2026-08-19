import type { Program } from '@/domain/program';
import { allOf, incomeAtOrBelow, isTrue, livesIn, oneOf } from '@/domain/criteria';

export const daneEvictionPrevention: Program = {
  id: 'dane-eviction-prevention',
  name: 'Eviction Prevention and Rent Assistance',
  administeredBy: 'Tenant Resource Center, with Dane County and City of Madison funding',
  jurisdiction: 'county',
  provider: 'nonprofit',
  categories: ['housing-utilities'],

  summary:
    'Help paying overdue rent, and free advice on your rights as a tenant, for people at risk of losing their housing in Dane County.',
  benefit:
    'One-time payment toward back rent or a security deposit, plus free tenant counseling and help communicating with a landlord.',

  eligibility: allOf(
    livesIn.daneCounty,
    isTrue('facingLossOfHousing'),
    oneOf('housingStatus', ['renting', 'unhoused-or-temporary', 'living-with-others']),
    incomeAtOrBelow('dane-ami', 80),
  ),
  eligibilityCaveats: [
    'Funding is limited and runs out at points during the year. Apply as early as you can.',
    'You usually need a lease or a written demand for rent, plus a landlord willing to accept payment.',
    'Tenant counseling is free and available to everyone regardless of income — call even if you do not qualify for the payment.',
  ],

  howToApply: {
    url: 'https://www.tenantresourcecenter.org/',
    phone: '608-257-0006',
    steps: [
      'Call the housing help desk, or start online.',
      'Have your lease, your eviction notice if you have one, and proof of income ready.',
      'A counselor will talk through your options, including ones that are not money.',
    ],
  },
  requiredDocuments: ['Lease or proof of tenancy', 'Any eviction or late-rent notice', 'Proof of income'],

  status: 'open',
  source: {
    url: 'https://www.tenantresourcecenter.org/',
    name: 'Tenant Resource Center',
    lastVerified: null,
  },
};
