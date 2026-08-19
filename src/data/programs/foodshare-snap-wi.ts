import type { Program } from '@/domain/program';
import { allOf, anyOf, hasAnyOf, incomeAtOrBelow, livesIn } from '@/domain/criteria';

/**
 * Wisconsin administers SNAP under the name FoodShare and sets its gross income
 * limit at 200% FPL -- higher than the federal 130% floor -- so the rule below
 * uses the Wisconsin number, not the federal one.
 */
export const foodshareSnapWi: Program = {
  id: 'foodshare-snap-wi',
  name: 'FoodShare Wisconsin (SNAP)',
  administeredBy: 'Wisconsin Department of Health Services',
  jurisdiction: 'state',
  provider: 'government',
  categories: ['food-basic-needs'],

  summary:
    'Wisconsin’s version of SNAP, once called food stamps. Money is loaded onto a QUEST card each month that you use like a debit card at grocery stores and many farmers markets.',
  benefit:
    'A monthly food benefit on a QUEST card. The amount depends on household size, income, and expenses.',

  eligibility: allOf(
    livesIn.wisconsin,
    anyOf(
      incomeAtOrBelow('fpl', 200),
      // Receiving SSI or W-2 confers categorical eligibility, which bypasses
      // the income test entirely.
      hasAnyOf('currentBenefits', ['ssi', 'w2-tanf']),
    ),
  ),
  eligibilityCaveats: [
    'Adults aged 18-52 without dependents may need to meet work requirements to keep benefits beyond three months.',
    'Some households face an asset limit. Most do not, but it is checked during the application.',
    'Immigration status affects eligibility for some household members. Children are often eligible even when adults are not.',
  ],

  howToApply: {
    url: 'https://access.wisconsin.gov/',
    phone: '1-800-362-3002',
    steps: [
      'Apply online through ACCESS Wisconsin, by phone, or in person at your county agency.',
      'Complete an interview, usually by phone.',
      'Send proof of income and expenses if asked.',
    ],
  },
  requiredDocuments: [
    'Photo ID',
    'Proof of income for everyone in the household',
    'Proof of housing and utility costs',
  ],

  status: 'open',
  source: {
    url: 'https://www.dhs.wisconsin.gov/foodshare/index.htm',
    name: 'Wisconsin DHS — FoodShare',
    lastVerified: null,
  },
};
