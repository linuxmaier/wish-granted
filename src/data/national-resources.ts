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
    name: 'Benefits.gov',
    url: 'https://www.benefits.gov/',
    description:
      'The federal benefit finder. Covers programs in every state, not just Wisconsin.',
  },
  {
    name: 'USA.gov — Government benefits',
    url: 'https://www.usa.gov/benefits',
    description: 'Plain-language guides to federal food, housing, and financial help.',
  },
];
