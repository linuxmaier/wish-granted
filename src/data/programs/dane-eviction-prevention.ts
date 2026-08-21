import type { Program } from '@/domain/program';
import { allOf, isTrue, livesIn, manualReview, oneOf } from '@/domain/criteria';

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

  // No income criterion here on purpose -- see the source note below. The
  // record previously carried `incomeAtOrBelow('dane-ami', 80)`, which
  // could not be traced to any current, citizen-facing source and was
  // dropped rather than kept because it looked plausible.
  eligibility: allOf(
    livesIn.daneCounty,
    isTrue('facingLossOfHousing'),
    oneOf('housingStatus', ['renting', 'unhoused-or-temporary', 'living-with-others']),
    manualReview(
      'Income limits and funding availability change and are not published in a way we can check automatically. Contact the Tenant Resource Center to find out whether you qualify.',
    ),
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
    // NOT marked verified. Fetched tenantresourcecenter.org directly
    // (org name, phone 608-257-0006, and toll-free 877-238-RENT all
    // confirmed live on the site's Hours/Locations page) and confirmed TRC
    // still runs an "Eviction Prevention Coordinated Entry Screening"
    // service, but that page's actual eligibility content loads through an
    // embedded screening tool that didn't render for a plain fetch, and
    // nothing on TRC's current public pages states an income threshold.
    // The only threshold I found -- 80% AMI for general eligibility, 50% AMI
    // for expedited/self-attested forward-rent and security-deposit
    // processing -- comes from a "Dane CORE 2.0 Emergency Rental Assistance
    // Program Policies & Procedures Manual" (Version 3, released 2/4/2022,
    // found via a Dane County procurement portal, not linked from TRC's own
    // site) describing a program funded by since-expired COVID-era federal
    // ERA1/ERA2 relief dollars. A 2022 internal contractor manual for an
    // expired funding stream is not good evidence of the current, 2026
    // threshold, so it was not used -- see the `manualReview` note on
    // `eligibility` above instead of a number. Whoever re-verifies this
    // should ask TRC directly (608-257-0006) or check for a current Dane
    // CORE program manual before restoring an income criterion.
    lastVerified: null,
  },
};
