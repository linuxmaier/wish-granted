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
    // Old URL 404s (no Wayback snapshot found either -- reads as never
    // correct). Current page confirmed via direct fetch.
    url: 'https://www.danecountyhumanservices.org/Children-Youth-and-Family/Community-Programs/Joining-Forces-for-Families',
    // No single phone number -- there are ~19 neighborhood offices, each
    // with its own worker and direct line (confirmed via the county's own
    // 2025 JFF information card). The old number here (608-242-6200) matches
    // none of them and isn't a published JFF contact, so it's dropped rather
    // than replaced with one office's number that would be wrong for most
    // readers.
    steps: [
      'Find the JFF office for your neighborhood using the county site’s office finder.',
      'Explain your situation — there is no application form to start.',
    ],
  },

  status: 'open',
  source: {
    url: 'https://www.danecountyhumanservices.org/Children-Youth-and-Family/Community-Programs/Joining-Forces-for-Families',
    name: 'Dane County Human Services — Joining Forces for Families',
    // Confirmed via direct fetch (curl, standard browser user agent) plus
    // the county's own "2025 JFF Dane County Information Card" PDF
    // (danecountyhumanservices.org/documents/pdf/JFF/2025-JFF-Dane-County-Information-Card--English-.pdf):
    // neighborhood-based model, ~19 offices across Dane County (including
    // outside Madison -- DeForest, Mazomanie, Sun Prairie, etc.), voluntary
    // and no eligibility gate beyond location, matches this record.
    lastVerified: '2026-08-21',
  },
};
