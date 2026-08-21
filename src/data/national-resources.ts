/**
 * Where to send someone this tool cannot help.
 *
 * These are deliberately NOT `Program` records. They have no eligibility rules,
 * they are never matched against, and they never appear in the results buckets.
 * An earlier version of the dataset carried "211 Wisconsin" with an `always()`
 * rule so that results were never empty — which meant a user in Ohio was told
 * they "likely qualify" for a Wisconsin service. Padding the results with a
 * program that does not apply is worse than an honest empty state.
 *
 * So: the matcher stays strictly truthful, and the UI handles "nothing applies
 * to you" as its own case, pointing here.
 */

export interface NationalResource {
  readonly name: string;
  readonly url: string;
  readonly phone?: string;
  readonly description: string;
}

export const NATIONAL_RESOURCES: readonly NationalResource[] = [
  {
    name: '211',
    url: 'https://www.211.org/',
    phone: '211',
    description:
      'Dial 211 from any phone in the US to reach a referral specialist for your own area, free and confidential, 24 hours a day.',
  },
  {
    // Was 'Benefits.gov'. That brand is retired: benefits.gov now 301s to this
    // page, carrying UTM tracking parameters and a welcome-modal query string.
    // We link the clean destination instead -- partly so the name matches what
    // someone actually lands on, and partly because handing a stranger a
    // tracking-tagged redirect sits badly with a tool that collects nothing.
    name: 'USA.gov benefit finder',
    url: 'https://www.usa.gov/benefit-finder',
    description:
      'Answer a few questions and see federal benefits you may be eligible for, in any state.',
  },
  {
    name: 'USA.gov — Government benefits',
    url: 'https://www.usa.gov/benefits',
    description: 'Plain-language guides to federal food, housing, and financial help.',
  },
];
