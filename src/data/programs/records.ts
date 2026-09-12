import type { Program } from '@/domain/program';

import { badgercarePlus } from './badgercare-plus';
import { daneCountyVeteransServiceOffice } from './dane-county-veterans-service-office';
import { daneEvictionPrevention } from './dane-eviction-prevention';
import { daneJoiningForcesForFamilies } from './dane-joining-forces-for-families';
import { foodshareSnapWi } from './foodshare-snap-wi';
import { lifelinePhoneInternet } from './lifeline-phone-internet';
import { madisonHousingChoiceVoucher } from './madison-housing-choice-voucher';
import { madisonWaterBillAssistance } from './madison-water-bill-assistance';
import { schoolMealsWi } from './school-meals-wi';
import { secondHarvestSouthernWi } from './second-harvest-southern-wi';
import { sunBucksWi } from './sun-bucks-wi';
import { theRiverFoodPantry } from './the-river-food-pantry';
import { wheapCrisisAssistance } from './wheap-crisis-assistance';
import { wheapEnergyAssistance } from './wheap-energy-assistance';
import { wi211 } from './wi-211';
import { wiVeteransHousingRecovery } from './wi-veterans-housing-recovery';
import { wiVeteransSubsistenceAid } from './wi-veterans-subsistence-aid';
import { wicWisconsin } from './wic-wisconsin';
import { wisconsinSharesChildCare } from './wisconsin-shares-child-care';
import { wisconsinWeatherization } from './wisconsin-weatherization';

/**
 * The hand-authored source of truth for the program dataset.
 *
 * One file per program, hand-curated. A file each -- rather than one big JSON
 * blob -- because curation is per-program: each record carries its own
 * `lastVerified` date and gets re-checked on its own schedule, and a per-file
 * diff makes "what changed when we re-verified this" legible in review.
 *
 * ==================== THIS DATA IS NOT YET FULLY VERIFIED ===================
 * Most records here carry a real `lastVerified` date (issue #2). The holdouts
 * carry `lastVerified: null` and an honest `manualReview` rather than a guessed
 * threshold. The app shows a prominent warning banner for as long as any record
 * or income table is unverified. See docs/data-authoring.md for the procedure.
 * ============================================================================
 *
 * ---------------------------------------------------------------------------
 * The app does NOT import this module. It loads the compiled snapshot instead
 * (`snapshot.json`, see ./index.ts and ./snapshot-schema.ts). This list is the
 * *input* to the snapshot generator (`scripts/build-snapshot`, run via
 * `npm run build:snapshot`), which is its only consumer. Adding or reordering a
 * record here is not visible to the app until the snapshot is regenerated --
 * `npm run build` fails if the committed snapshot is stale. See issue #8 and
 * docs/design.md, "The shippable snapshot".
 * ---------------------------------------------------------------------------
 *
 * Array order is load-bearing: it is the tie-break-free base order the matcher
 * and the e2e personas see, so it is preserved verbatim into the snapshot.
 */
export const HAND_AUTHORED_PROGRAMS: readonly Program[] = [
  // Food & basic needs
  foodshareSnapWi,
  wicWisconsin,
  schoolMealsWi,
  sunBucksWi,
  secondHarvestSouthernWi,
  theRiverFoodPantry,

  // Housing & utilities
  wheapEnergyAssistance,
  wheapCrisisAssistance,
  wisconsinWeatherization,
  madisonHousingChoiceVoucher,
  madisonWaterBillAssistance,
  daneEvictionPrevention,
  lifelinePhoneInternet,

  // Health & disability
  badgercarePlus,

  // Childcare & education
  wisconsinSharesChildCare,

  // Veterans
  wiVeteransSubsistenceAid,
  wiVeteransHousingRecovery,
  daneCountyVeteransServiceOffice,

  // Cross-cutting referral services
  daneJoiningForcesForFamilies,
  wi211,
];
