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
    // Sourced verbatim from the program's own page (see source note below).
    'Funding is limited each program year. When it runs out, no more benefits are issued for that year even to households who qualify.',
  ],

  howToApply: {
    url: 'https://energyandhousing.wi.gov/Pages/AgencyResources/energy-assistance.aspx',
    phone: '1-866-432-8947',
    steps: [
      'Find the agency for your county — in Dane County this is Energy Services of Dane County.',
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
    url: 'https://energyandhousing.wi.gov/Pages/AgencyResources/energy-assistance.aspx',
    name: 'Wisconsin Energy and Housing — Energy Assistance',
    // Confirmed via direct fetch (curl, standard browser user agent). The old
    // URL here (mixed-case "EnergyAssistance.aspx") 404s on this SharePoint
    // site; the live page uses lowercase, hyphenated "energy-assistance.aspx"
    // -- a Wayback Machine check found no archived snapshot of the old
    // mixed-case URL at all (ever), while the corrected lowercase URL has a
    // snapshot from 2026-08-13, so this reads as a URL that was never
    // correct rather than a page that moved. Confirmed directly from the
    // page: "Based on 60% of Wisconsin's median income" (matches the
    // `wi-smi` scale's own 60%-already-baked-in documentation), the phone
    // number (1-866-HEATWIS = 1-866-432-8947), and the funding-exhaustion
    // caveat added above. Could not re-confirm the "three months of income"
    // rule, the October 1-May 15 season window, or the renters-qualify
    // caveat on this specific page (they're in the WHEAP manual PDF, which
    // did not extract cleanly); left unchanged since they're consistent with
    // this session's other findings and issue #4's independent spike, not
    // because I fetched a page stating them today.
    lastVerified: '2026-08-21',
  },
};
