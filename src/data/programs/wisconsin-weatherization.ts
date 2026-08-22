import type { Program } from '@/domain/program';
import { allOf, anyOf, hasAnyOf, incomeAtOrBelow, isTrue, manualReview, livesIn, oneOf } from '@/domain/criteria';

export const wisconsinWeatherization: Program = {
  id: 'wisconsin-weatherization',
  name: 'Wisconsin Weatherization Assistance Program',
  administeredBy: 'Wisconsin Department of Administration, through local agencies',
  jurisdiction: 'state',
  provider: 'government',
  categories: ['housing-utilities'],

  summary:
    'Free home energy improvements — insulation, air sealing, furnace repair or replacement — to permanently lower your energy bills. Renters qualify too, with the landlord’s consent.',
  benefit:
    'Free energy audit and home improvements. There is no cost to the household and nothing to repay.',

  // The `recentIncomeDrop` branch below is the same WHEAP-family fix as
  // wheap-energy-assistance.ts / wheap-crisis-assistance.ts, extended here on
  // an inferential basis: this record's own source note above ties
  // Weatherization to WHEAP under the same "Home Energy Plus (HE+)" umbrella
  // and the same county-agency network, but that note was not independently
  // confirmed against Weatherization's own income-test *timing* specifically
  // -- only its 60% SMI *threshold*. Worded as "may look at" rather than
  // asserting the one-month rule as fact for this program, and flagged here
  // for whoever next verifies this record: confirm whether Weatherization's
  // income test actually uses the same prior-month-annualized mechanic as
  // WHEAP, or a plain annual figure. Given the asymmetry of the two possible
  // errors -- a false exclusion (serious) vs. an over-inclusive "might
  // qualify, call and check" lead (mild) -- this branch stays in either way.
  eligibility: allOf(
    livesIn.wisconsin,
    oneOf('housingStatus', ['renting', 'own-home']),
    anyOf(
      incomeAtOrBelow('wi-smi', 100),
      hasAnyOf('currentBenefits', ['wheap-energy-assistance', 'snap-foodshare', 'ssi', 'w2-tanf']),
      allOf(
        isTrue('recentIncomeDrop'),
        manualReview(
          "This program's income test may look at recent income rather than the full year, so a recent drop may still qualify you. Contact your local weatherization agency to check.",
        ),
      ),
    ),
  ),
  eligibilityCaveats: [
    'Renters need the property owner’s written consent before work can start.',
    'Households already receiving WHEAP are usually automatically income-eligible.',
    'There is often a waiting list, and homes with the highest energy use are usually prioritised.',
  ],

  howToApply: {
    url: 'https://energyandhousing.wi.gov/Pages/AgencyResources/weatherization.aspx',
    phone: '1-866-432-8947',
    steps: [
      'Contact the weatherization agency serving your county.',
      'Complete an application and provide proof of income.',
      'An auditor visits to assess the home and decide what work is needed.',
    ],
  },

  status: 'waitlist',
  source: {
    url: 'https://energyandhousing.wi.gov/Pages/AgencyResources/weatherization.aspx',
    name: 'Wisconsin Energy and Housing — Weatherization',
    // Confirmed via direct fetch (curl, standard browser user agent). Old
    // mixed-case URL ("Weatherization.aspx") 404s; Wayback Machine shows no
    // snapshot of it ever, while the corrected lowercase URL has one from
    // 2026-08-13 -- reads as never-correct, not moved (same pattern as the
    // WHEAP energy-assistance URL). Confirmed WAP is bundled with WHEAP under
    // "Home Energy Plus (HE+)" and administered by WI DOA's Division of
    // Energy, Housing and Community Resources through the same county-agency
    // network -- consistent with the WHEAP-categorical-eligibility caveat
    // already in this record. This specific page is administrator/manual
    // -facing (program-year PDFs, no consumer income table or landlord
    // -consent language), so the 60% SMI income shape, the landlord-consent
    // requirement, and the waiting-list/prioritization caveats are carried
    // over from the original record rather than independently re-confirmed
    // on a page fetched today; they're consistent with WAP's well-documented
    // national structure and with WHEAP's own confirmed 60% SMI standard.
    lastVerified: '2026-08-21',
  },
};
