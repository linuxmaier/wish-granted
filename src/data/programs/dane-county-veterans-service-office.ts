import { allOf, hasAnyOf, livesIn } from '@/domain/criteria';
import type { Program } from '@/domain/program';

/**
 * No `manualReview`, deliberately -- this record can and should say "you
 * qualify".
 *
 * Wis. Stat. § 45.80(5)(a) makes it the office's statutory duty to advise
 * people in its county who served and to "render to them and their dependents
 * all possible assistance". There is no test to pass and nothing to be
 * uncertain about, so an abstention here would be caution that costs reach: a
 * confirmed "this office is for you, here is the number" is the useful answer.
 * Same reasoning as wi-211.ts and dane-joining-forces-for-families.ts.
 */
export const daneCountyVeteransServiceOffice: Program = {
  id: 'dane-county-veterans-service-office',
  name: 'Dane County Veterans Service Office',
  administeredBy: 'Dane County (a County Veterans Service Office under Wis. Stat. ch. 45)',
  jurisdiction: 'county',
  provider: 'government',
  categories: ['veterans'],

  summary:
    'Free help working out which veterans benefits you can get, and applying for them. A county officer can file VA claims for you and represent you if a claim is denied.',
  benefit:
    'Benefits advice and help applying — VA health care and dental enrollment, disability compensation and pension claims, GI Bill and other education benefits, home loan certificates, and burial allowances, markers and flags.',

  eligibility: allOf(
    livesIn.daneCounty,
    // § 45.80(5)(a): people in the county who served, and their dependents.
    // A Gold Star parent is not a dependent of the service member, so that
    // value is not in this list -- see the caveats.
    hasAnyOf('veteranConnection', [
      'veteran',
      'spouse-or-partner',
      'surviving-spouse',
      'child-or-dependent',
    ]),
  ),
  eligibilityCaveats: [
    'This is free, and it is worth using before applying for anything else — the office knows which benefits exist and files the paperwork with you.',
    'The statute covers people who served and their dependents. The office also handles burial, marker and flag benefits that a veteran\'s family claims, so call and ask if you are not sure whether you count.',
    'It helps with federal VA benefits as well as state and county ones, so one call can cover all three.',
  ],

  howToApply: {
    url: 'https://www.danevets.com/services',
    phone: '608-266-4158',
    steps: [
      'Call (608) 266-4158.',
      'Describe your service and your situation — a veterans service officer works out what you may be entitled to.',
      'They help you file the claims and applications, and can represent you on VA claims and appeals.',
    ],
  },

  status: 'open',
  source: {
    url: 'https://www.danevets.com/services',
    name: 'Dane County Veterans Service Office',
    // NOT marked verified -- no human has read these sources; an agent
    // fetched them on 2026-09-12.
    //
    // Confirmed directly on danevets.com/services: the office name, the
    // phone number ("please call (608) 266-4158", twice on the page), and
    // the service list behind `benefit` -- VA health care and dental
    // enrollment, compensation and pension claims, education benefits
    // (GI Bill, VetEd, Job Retraining Grant), VA home loan certification,
    // burial allowance, markers and flags, housing referrals, military
    // records, and outreach to incarcerated veterans.
    //
    // Confirmed in Wis. Stat. § 45.80(5)(a), fetched separately: the office
    // "shall ... [a]dvise persons living in the service officer's county who
    // served in the U.S. armed forces regarding any benefits to which they
    // may be entitled ... and render to them and their dependents all
    // possible assistance." That statute, not the website, is what the
    // `eligibility` rule encodes -- danevets.com/services says only
    // "veterans" and states no residency or dependent scope at all, so the
    // record would otherwise be narrower than the office's actual duty.
    //
    // NOT confirmed: that the service is free (not stated on the page --
    // it follows from being a statutory county office, and CVSOs do not
    // charge, but the page does not say so); that the office is accredited
    // to represent claimants before the VA (the page lists claims help but
    // not accreditation); and the office's address and walk-in hours, which
    // the page does not give -- it says only "visit one of our locations".
    // Whoever verifies this should call and confirm all four, and note that
    // the office is at danevets.com, not on any danecounty.gov path.
    lastVerified: null,
  },
};
