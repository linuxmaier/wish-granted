import type { Program } from '@/domain/program';
import { always } from '@/domain/criteria';

/**
 * The universal fallback. `always` means it matches everyone, including people
 * for whom every other program was ruled out — which is exactly when someone
 * most needs a human to talk to. The results screen relies on at least one
 * unconditional match existing so it is never empty.
 */
export const wi211: Program = {
  id: 'wi-211',
  name: '211 Wisconsin',
  administeredBy: 'United Way of Wisconsin',
  jurisdiction: 'state',
  provider: 'nonprofit',
  categories: ['housing-utilities', 'food-basic-needs', 'health-disability'],

  summary:
    'A free, confidential helpline that connects you to local assistance of any kind. Dial 211 from any phone, any time, in any language.',
  benefit:
    'A referral specialist who searches a database of local programs with you and makes warm handoffs. Available 24 hours a day.',

  eligibility: always('anyone can call'),
  eligibilityCaveats: [
    'This is a referral service, not a source of money itself.',
    'Useful when nothing else here fits, or when a program has closed its waiting list.',
  ],

  howToApply: {
    url: 'https://211wisconsin.communityos.org/',
    phone: '211',
    steps: ['Dial 211, or text your ZIP code to 898211.', 'Describe what you need.'],
  },

  status: 'open',
  source: {
    url: 'https://211wisconsin.communityos.org/',
    name: '211 Wisconsin',
    lastVerified: null,
  },
};
