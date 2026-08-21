import type { Program } from '@/domain/program';
import { livesIn } from '@/domain/criteria';

/**
 * Scoped to Wisconsin, despite 211 being a nationwide system.
 *
 * This record is specifically *211 Wisconsin* — run by United Way of Wisconsin,
 * with a Wisconsin URL and a Wisconsin service database. It previously used
 * `always()` so that results were never empty, which meant someone in another
 * state was told they "likely qualify" for it. A geography-scoped service
 * needs a geography criterion, and the never-empty guarantee belongs to the UI
 * (see src/data/national-resources.ts), not to a deliberately over-broad rule.
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

  eligibility: livesIn.wisconsin,
  eligibilityCaveats: [
    'This is a referral service, not a source of money itself.',
    'Useful when nothing else here fits, or when a program has closed its waiting list.',
    'Outside Wisconsin, dialing 211 reaches your own local referral service instead.',
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
    // Confirmed via direct fetch (curl, standard browser user agent; no
    // robots.txt file exists at this domain, so no crawl restriction is
    // stated). Page title is "211 Wisconsin," branded with United Way and
    // referencing 24-hour, confidential service. The 898211 text shortcode
    // is corroborated by several Wisconsin United Way affiliate sites (not
    // independently re-confirmed on 211wisconsin.communityos.org itself,
    // whose content is served through a heavy CMS/JS layer that didn't
    // render cleanly for a plain fetch). No public API/export exists for
    // this site (per issue #4's source survey), so this record is limited to
    // what a person would see visiting the page or dialing 211, which is all
    // this record needs.
    lastVerified: '2026-08-21',
  },
};
