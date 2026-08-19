import type { Program } from '@/domain/program';
import { allOf, anyOf, hasAnyOf, incomeAtOrBelow, isTrue, livesIn } from '@/domain/criteria';

/**
 * WHEAP is Wisconsin's LIHEAP. Its limit is 60% of state median income, and the
 * stored table already holds the 60% figures, so the rule asks for 100% of the
 * `wi-smi` scale rather than 60% of it. See data/reference/income-tables.ts.
 */
export const wheapEnergyAssistance: Program = {
  id: 'wheap-energy-assistance',
  name: 'Wisconsin Home Energy Assistance Program (WHEAP)',
  administeredBy: 'Wisconsin Department of Administration, through local agencies',
  jurisdiction: 'state',
  provider: 'government',
  categories: ['housing-utilities'],

  summary:
    'A once-a-year payment toward your heating and electric costs. The money goes straight to your energy company, not to you.',
  benefit:
    'A one-time annual payment toward heating costs, plus a separate electric benefit. The amount depends on income, household size, fuel type, and energy use.',

  eligibility: allOf(
    livesIn.wisconsin,
    isTrue('paysHeatingCost'),
    anyOf(
      incomeAtOrBelow('wi-smi', 100),
      hasAnyOf('currentBenefits', ['snap-foodshare', 'w2-tanf', 'ssi']),
    ),
  ),
  eligibilityCaveats: [
    'Income is counted over the three months before you apply, not the whole year, so a recent drop in income can qualify you even if the annual figure does not.',
    'Renters qualify even when heat is included in the rent.',
    'You can receive this once per heating season.',
  ],

  howToApply: {
    url: 'https://energyandhousing.wi.gov/Pages/AgencyResources/EnergyAssistance.aspx',
    phone: '1-866-432-8947',
    steps: [
      'Find the agency for your county — in Dane County this is Energy Services, Inc.',
      'Apply online, by phone, or in person.',
      'Provide proof of income for the last three months and a recent energy bill.',
    ],
  },
  requiredDocuments: [
    'Photo ID',
    'Proof of income for the last three months for everyone 18 and over',
    'A recent heating and electric bill',
    'Social Security numbers for household members',
  ],

  status: 'seasonal',
  seasonalNote: 'The regular heating season runs from October 1 through May 15.',
  source: {
    url: 'https://energyandhousing.wi.gov/Pages/AgencyResources/EnergyAssistance.aspx',
    name: 'Wisconsin Energy and Housing — Energy Assistance',
    lastVerified: null,
  },
};
