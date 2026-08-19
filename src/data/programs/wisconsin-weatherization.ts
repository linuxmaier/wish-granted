import type { Program } from '@/domain/program';
import { allOf, anyOf, hasAnyOf, incomeAtOrBelow, livesIn, oneOf } from '@/domain/criteria';

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

  eligibility: allOf(
    livesIn.wisconsin,
    oneOf('housingStatus', ['renting', 'own-home']),
    anyOf(
      incomeAtOrBelow('wi-smi', 100),
      hasAnyOf('currentBenefits', ['wheap-energy-assistance', 'snap-foodshare', 'ssi', 'w2-tanf']),
    ),
  ),
  eligibilityCaveats: [
    'Renters need the property owner’s written consent before work can start.',
    'Households already receiving WHEAP are usually automatically income-eligible.',
    'There is often a waiting list, and homes with the highest energy use are usually prioritised.',
  ],

  howToApply: {
    url: 'https://energyandhousing.wi.gov/Pages/AgencyResources/Weatherization.aspx',
    phone: '1-866-432-8947',
    steps: [
      'Contact the weatherization agency serving your county.',
      'Complete an application and provide proof of income.',
      'An auditor visits to assess the home and decide what work is needed.',
    ],
  },

  status: 'waitlist',
  source: {
    url: 'https://energyandhousing.wi.gov/Pages/AgencyResources/Weatherization.aspx',
    name: 'Wisconsin Energy and Housing — Weatherization',
    lastVerified: null,
  },
};
