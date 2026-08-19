import type { Program } from '@/domain/program';

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
import { wicWisconsin } from './wic-wisconsin';
import { wisconsinWeatherization } from './wisconsin-weatherization';

/**
 * The v1 seed dataset.
 *
 * One file per program, hand-curated. A file each -- rather than one big JSON
 * blob -- because curation is per-program: each record carries its own
 * `lastVerified` date and gets re-checked on its own schedule, and a per-file
 * diff makes "what changed when we re-verified this" legible in review.
 *
 * ==================== THIS DATA IS NOT YET VERIFIED =========================
 * Every record here was drafted from secondary knowledge and carries
 * `lastVerified: null`. The thresholds, program names, and application details
 * are plausible but UNCONFIRMED. Each one must be checked against its `source`
 * URL by a human before this is shown to the public. See docs/data-authoring.md
 * for the procedure, and note that the app displays a prominent warning banner
 * for as long as any record is unverified.
 * ============================================================================
 */
export const PROGRAMS: readonly Program[] = [
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

  // Cross-cutting referral services
  daneJoiningForcesForFamilies,
  wi211,
];

export function programById(id: string): Program | undefined {
  return PROGRAMS.find((p) => p.id === id);
}

/** Records still awaiting a human check against their source. */
export function unverifiedPrograms(): readonly Program[] {
  return PROGRAMS.filter((p) => p.source.lastVerified === null);
}

/**
 * Records whose last check is older than `days`. Curation debt is invisible
 * unless something surfaces it, so this drives both the data test and the
 * staleness notice in the UI.
 */
export function stalePrograms(days = 180, now: Date = new Date()): readonly Program[] {
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  return PROGRAMS.filter((p) => {
    if (p.source.lastVerified === null) return true;
    return new Date(p.source.lastVerified).getTime() < cutoff;
  });
}
