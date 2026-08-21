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
    'Dane County’s busiest food pantry. Groceries, take-home and mobile meals, and no referral needed — but groceries and take-home meals do require self-attesting your income, unlike a typical no-questions-asked pantry.',
  benefit:
    'Weekly groceries, take-home prepared meals, community meals, and a mobile delivery route for people who cannot travel to the pantry.',

  eligibility: livesIn.daneCounty,
  eligibilityCaveats: [
    // The River's own FAQ ties "receiving groceries" to Wisconsin's TEFAP
    // guidelines: Wisconsin residency plus self-attested household income at
    // or below 200% of the Federal Poverty Level (no documentation checked).
    // That gate is stated for groceries and FAM take-home meals specifically;
    // the site does not state the same requirement for on-site Community
    // Meals, so eligibility here is deliberately left at county residency
    // only rather than an income test that could wrongly rule out someone
    // who only wants a community meal.
    'Groceries and FAM take-home meals require self-attesting that your household income is at or below 200% of the Federal Poverty Level (Wisconsin’s TEFAP guideline) — no proof is required. This does not appear to apply to their on-site Community Meals.',
    'You can pick up groceries and FAM meals once per week; their week runs Tuesday through Friday.',
    'New clients register online (ePantry / curbside registration) or in person; the site does not specify a documentation requirement.',
  ],

  howToApply: {
    url: 'https://www.riverfoodpantry.org/',
    phone: '608-442-8815',
    steps: [
      'Check the current hours on their site — they change seasonally.',
      'Register as a new client online, or come during open hours. No appointment or referral is needed.',
    ],
  },

  status: 'open',
  source: {
    url: 'https://www.riverfoodpantry.org/',
    name: 'The River Food Pantry',
    // Confirmed via direct fetch of riverfoodpantry.org, its Services and
    // FAQ pages, plus the WI DHS TEFAP eligibility form (F-40059, 09/2025,
    // dhs.wisconsin.gov/forms/f40059.pdf, fetched directly): "The River
    // exists to serve our Dane County neighbors" (county eligibility), the
    // FAQ's own income-guideline language for groceries, and the 200% FPL
    // self-attestation figure from the state TEFAP form.
    lastVerified: '2026-08-21',
  },
};
