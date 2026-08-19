import type { Program } from '@/domain/program';
import { livesIn } from '@/domain/criteria';

export const theRiverFoodPantry: Program = {
  id: 'the-river-food-pantry',
  name: 'The River Food Pantry',
  administeredBy: 'The River Food Pantry',
  jurisdiction: 'county',
  provider: 'nonprofit',
  categories: ['food-basic-needs'],

  summary:
    'Dane County’s busiest food pantry. Groceries, hot meals, and mobile deliveries, with no income test and no referral needed.',
  benefit:
    'Weekly groceries, free hot meals, and a mobile delivery route for people who cannot travel to the pantry.',

  eligibility: livesIn.daneCounty,
  eligibilityCaveats: [
    'You can shop for groceries once per week.',
    'First visit asks for a photo ID and something showing your Dane County address, but they will work with you if you do not have either.',
  ],

  howToApply: {
    url: 'https://www.riverfoodpantry.org/',
    phone: '608-442-8815',
    steps: [
      'Check the current hours on their site — they change seasonally.',
      'Come during open hours. No appointment or referral is needed.',
    ],
  },

  status: 'open',
  source: {
    url: 'https://www.riverfoodpantry.org/',
    name: 'The River Food Pantry',
    lastVerified: null,
  },
};
