import type { Program } from '@/domain/program';
import { allOf, incomeAtOrBelow, isTrue, livesIn } from '@/domain/criteria';

export const wheapCrisisAssistance: Program = {
  id: 'wheap-crisis-assistance',
  name: 'WHEAP Crisis Assistance and Emergency Furnace Repair',
  administeredBy: 'Wisconsin Department of Administration, through local agencies',
  jurisdiction: 'state',
  provider: 'government',
  categories: ['housing-utilities'],

  summary:
    'Emergency help when your heat has been shut off, is about to be, or your furnace has stopped working. This moves much faster than the regular energy assistance process.',
  benefit:
    'Emergency payment to restore or keep service, and repair or replacement of a broken furnace for homeowners. Available 24 hours a day.',

  // Was `anyOf(incomeAtOrBelow('wi-smi', 100), isTrue('paysHeatingCost'))`,
  // which meant almost anyone who pays a heating bill -- regardless of
  // income -- bypassed the income test entirely, since `paysHeatingCost` is
  // true for nearly every applicant. That contradicted this record's own
  // caveat ("you generally need to qualify for regular WHEAP first") and
  // would have wrongly told higher-income households they were eligible for
  // emergency crisis assistance. Fixed to a hard income test to match the
  // documented rule; `utilityShutoffRisk` below already implies the
  // household has a heating bill it is at risk of losing.
  eligibility: allOf(livesIn.wisconsin, isTrue('utilityShutoffRisk'), incomeAtOrBelow('wi-smi', 100)),
  eligibilityCaveats: [
    'You generally need to qualify for regular WHEAP first, and can apply for both at the same time.',
    'Furnace repair and replacement is for homeowners. Renters should contact their local agency, which will work with the landlord.',
    'Wisconsin also bans heat disconnection from November 1 to April 15 for residential customers, separately from this program.',
  ],

  howToApply: {
    url: 'https://energyandhousing.wi.gov/Pages/AgencyResources/energy-assistance.aspx',
    phone: '1-866-432-8947',
    steps: [
      'Call your county agency right away — do not wait for the regular application.',
      'Explain that you have a shutoff notice or no heat.',
      'Emergency situations are handled outside normal office hours.',
    ],
  },

  status: 'open',
  source: {
    url: 'https://energyandhousing.wi.gov/Pages/AgencyResources/energy-assistance.aspx',
    name: 'Wisconsin Energy and Housing — Crisis Assistance',
    // Confirmed the page and phone number (1-866-HEATWIS = 1-866-432-8947)
    // directly, via curl with a standard browser user agent (same page as
    // wheap-energy-assistance.ts; old mixed-case URL was never correct --
    // see that record's note). Confirmed the Nov 1-Apr 15 heating
    // disconnection moratorium independently via Wisconsin PSC's own press
    // releases and PSC 113.0304/113.0305 (docs.legis.wisconsin.gov), not by
    // fetching a DEHCR page stating it today. Did not independently
    // re-confirm "24 hours a day," the homeowner-only furnace repair
    // restriction, or the "apply for both at the same time" claim on a page
    // fetched today -- unchanged from the original record, not newly
    // verified. See the eligibility-logic fix noted above.
    lastVerified: '2026-08-21',
  },
};
