import type { Program } from '@/domain/program';
import { allOf, anyOf, hasAnyOf, incomeAtOrBelow, isTrue, livesIn } from '@/domain/criteria';

export const madisonWaterBillAssistance: Program = {
  id: 'madison-water-bill-assistance',
  name: 'Madison Municipal Services Bill Assistance',
  administeredBy: 'Madison Water Utility',
  jurisdiction: 'city',
  provider: 'government',
  categories: ['housing-utilities'],

  summary:
    'Help with an overdue City of Madison municipal services bill — water, sewer, stormwater, and urban forestry charges — for customers at risk of a shutoff.',
  benefit: 'A credit toward an overdue municipal services bill, plus payment plans that prevent a shutoff.',

  eligibility: allOf(
    livesIn.madison,
    anyOf(
      incomeAtOrBelow('fpl', 200),
      hasAnyOf('currentBenefits', ['snap-foodshare', 'wheap-energy-assistance', 'ssi', 'w2-tanf']),
    ),
    anyOf(isTrue('utilityShutoffRisk'), isTrue('paysHeatingCost')),
  ),
  eligibilityCaveats: [
    'The account generally has to be in your name at your current Madison address.',
    'Unpaid municipal services bills are placed on the property tax roll, so this matters for homeowners as well as renters.',
    'Call before a shutoff date rather than after — payment plans are easier to arrange in advance.',
  ],

  howToApply: {
    url: 'https://www.cityofmadison.com/water/customer-service/billing-payments',
    phone: '608-266-4641',
    steps: [
      'Call Madison Water Utility customer service and ask about assistance and payment plans.',
      'Have your account number and proof of income ready.',
    ],
  },

  status: 'open',
  source: {
    url: 'https://www.cityofmadison.com/water/customer-service/billing-payments',
    name: 'Madison Water Utility — Billing and Payments',
    lastVerified: null,
  },
};
