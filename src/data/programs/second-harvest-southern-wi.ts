import type { Program } from '@/domain/program';
import { livesIn } from '@/domain/criteria';

/**
 * Food pantries generally have no income test — the point is that anyone who
 * needs food can walk in. That is represented honestly here as a geography
 * criterion and nothing else, so this always lands in "you qualify" for anyone
 * in the region. It is a deliberate anchor in the results: someone whose income
 * rules out every benefit program should still leave with somewhere to go.
 */
export const secondHarvestSouthernWi: Program = {
  id: 'second-harvest-southern-wi',
  name: 'Second Harvest Foodbank of Southern Wisconsin',
  administeredBy: 'Second Harvest Foodbank of Southern Wisconsin',
  jurisdiction: 'county',
  provider: 'nonprofit',
  categories: ['food-basic-needs'],

  summary:
    'A network of food pantries and mobile food distributions across southern Wisconsin. No income test and no application — pantries are open to anyone who needs food.',
  benefit: 'Free groceries from a local pantry or mobile distribution. They also help people apply for FoodShare.',

  eligibility: livesIn.wisconsin,
  eligibilityCaveats: [
    'Individual pantries may set their own limits on how often you can visit, or ask for proof of address.',
    'Their FoodShare outreach team will help you apply for SNAP for free, over the phone.',
  ],

  howToApply: {
    url: 'https://www.secondharvestsouthernwi.org/get-help/',
    phone: '1-877-366-3635',
    steps: [
      'Use the pantry finder to locate a site near you and check its hours.',
      'Go during open hours. Most sites do not need an appointment.',
    ],
  },

  status: 'open',
  source: {
    url: 'https://www.secondharvestsouthernwi.org/get-help/',
    name: 'Second Harvest Foodbank of Southern Wisconsin',
    lastVerified: null,
  },
};
