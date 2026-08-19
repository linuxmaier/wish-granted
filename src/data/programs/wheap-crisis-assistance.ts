import type { Program } from '@/domain/program';
import { allOf, anyOf, incomeAtOrBelow, isTrue, livesIn } from '@/domain/criteria';

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

  eligibility: allOf(
    livesIn.wisconsin,
    isTrue('utilityShutoffRisk'),
    anyOf(incomeAtOrBelow('wi-smi', 100), isTrue('paysHeatingCost')),
  ),
  eligibilityCaveats: [
    'You generally need to qualify for regular WHEAP first, and can apply for both at the same time.',
    'Furnace repair and replacement is for homeowners. Renters should contact their local agency, which will work with the landlord.',
    'Wisconsin also bans heat disconnection from November 1 to April 15 for residential customers, separately from this program.',
  ],

  howToApply: {
    url: 'https://energyandhousing.wi.gov/Pages/AgencyResources/EnergyAssistance.aspx',
    phone: '1-866-432-8947',
    steps: [
      'Call your county agency right away — do not wait for the regular application.',
      'Explain that you have a shutoff notice or no heat.',
      'Emergency situations are handled outside normal office hours.',
    ],
  },

  status: 'open',
  source: {
    url: 'https://energyandhousing.wi.gov/Pages/AgencyResources/EnergyAssistance.aspx',
    name: 'Wisconsin Energy and Housing — Crisis Assistance',
    lastVerified: null,
  },
};
