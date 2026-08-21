import type { Program } from '@/domain/program';
import { livesIn } from '@/domain/criteria';

/**
 * Food pantries generally have no income test — the point is that anyone who
 * needs food can walk in. That is represented honestly here as a geography
 * criterion and nothing else, so this always lands in "you qualify" for anyone
 * in the region. It is a deliberate anchor in the results: someone whose income
 * rules out every benefit program should still leave with somewhere to go.
 *
 * Second Harvest's own site is explicit that this "no documentation" policy
 * is deliberate, not an oversight -- unlike some of their partner pantries
 * (see the-river-food-pantry.ts), which do apply TEFAP self-attestation to
 * their own direct distribution.
 *
 * Geography is scoped to Dane County, not all of Wisconsin: Second Harvest's
 * own service area is a specific 16 counties (Adams, Columbia, Crawford,
 * Dane, Dodge, Grant, Green, Iowa, Jefferson, Juneau, Lafayette, Monroe,
 * Richland, Rock, Sauk, Vernon), not the whole state, and our fact vocabulary
 * can only distinguish "Dane County" from "some other Wisconsin county" -- it
 * cannot tell whether an "other Wisconsin county" answer is one of the other
 * 15 served counties or one of the ~56 that aren't. Scoping to Dane County
 * under-claims for the other 15 rather than over-claiming for the ~56 that
 * aren't served; the caveat below names them so a reader outside Dane County
 * can self-check.
 */
export const secondHarvestSouthernWi: Program = {
  id: 'second-harvest-southern-wi',
  name: 'Second Harvest Foodbank of Southern Wisconsin',
  administeredBy: 'Second Harvest Foodbank of Southern Wisconsin',
  jurisdiction: 'county',
  provider: 'nonprofit',
  categories: ['food-basic-needs'],

  summary:
    'A network of food pantries and mobile food distributions across a 16-county region of southern Wisconsin, including Dane County. No income test and no application — pantries are open to anyone who needs food.',
  benefit: 'Free groceries from a local pantry or mobile distribution. They also help people apply for FoodShare.',

  eligibility: livesIn.daneCounty,
  eligibilityCaveats: [
    'Second Harvest also serves Adams, Columbia, Crawford, Dodge, Grant, Green, Iowa, Jefferson, Juneau, Lafayette, Monroe, Richland, Rock, Sauk, and Vernon counties — if you live in one of those, you are also covered even though this tool only checked Dane County.',
    'Individual pantries may set their own limits on how often you can visit, or ask for proof of address.',
    'Their FoodShare outreach team will help you apply for SNAP for free, over the phone.',
  ],

  howToApply: {
    url: 'https://www.secondharvestsw.org/find-help/',
    phone: '1-877-366-3635',
    steps: [
      'Use the pantry finder to locate a site near you and check its hours.',
      'Go during open hours. Most sites do not need an appointment.',
    ],
  },

  status: 'open',
  source: {
    url: 'https://www.secondharvestsw.org/find-help/',
    name: 'Second Harvest Foodbank of Southern Wisconsin',
    // Confirmed via direct fetch (curl, standard browser user agent). Old
    // domain (secondharvestsouthernwi.org) has no DNS record at all anymore
    // -- the org rebranded its URL to secondharvestsw.org. Confirmed
    // verbatim on their "Food Support Qualification Guidelines" page
    // (secondharvestsw.org/find-help/food-support-qualification-guidelines/):
    // "No identification, proof of income, residency, citizenship, or other
    // documentation is required at Second Harvest Foodbank food distribution
    // sites, including mobile pantries." Confirmed the 16-county service area
    // on their "Who We Are" page, and the FoodShare Helpline number
    // (1-877-366-3635) directly on their current FoodShare program page.
    lastVerified: '2026-08-21',
  },
};
