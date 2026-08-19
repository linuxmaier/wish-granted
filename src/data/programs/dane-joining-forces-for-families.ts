import type { Program } from '@/domain/program';
import { livesIn } from '@/domain/criteria';

/**
 * A referral service rather than a benefit. It has no eligibility test beyond
 * geography, which makes it the right thing to show someone whose situation the
 * rules engine cannot resolve — a human social worker can do what a decision
 * tree cannot.
 */
export const daneJoiningForcesForFamilies: Program = {
  id: 'dane-joining-forces-for-families',
  name: 'Joining Forces for Families',
  administeredBy: 'Dane County Department of Human Services',
  jurisdiction: 'county',
  provider: 'government',
  categories: ['housing-utilities', 'food-basic-needs'],

  summary:
    'Neighborhood social workers who help Dane County residents find and apply for whatever they need — rent help, food, utilities, childcare, health care. Free, and you do not need to qualify for anything first.',
  benefit:
    'One-to-one help from a social worker who knows the local programs, including help filling out applications and small amounts of emergency assistance.',

  eligibility: livesIn.daneCounty,
  eligibilityCaveats: [
    'Workers are assigned by neighborhood, so which office you contact depends on where you live.',
    'This is the best starting point if your situation does not fit neatly into any single program.',
  ],

  howToApply: {
    url: 'https://www.danecountyhumanservices.org/Programs/Joining-Forces-for-Families',
    phone: '608-242-6200',
    steps: [
      'Find the worker assigned to your neighborhood, or call the main county number.',
      'Explain your situation — there is no application form to start.',
    ],
  },

  status: 'open',
  source: {
    url: 'https://www.danecountyhumanservices.org/Programs/Joining-Forces-for-Families',
    name: 'Dane County Human Services — Joining Forces for Families',
    lastVerified: null,
  },
};
