/**
 * Wisconsin 60% State Median Income, for WHEAP.
 *
 * Primary source: the LIHEAP Clearinghouse (liheapch.acf.gov), HHS/ACF's own Office of
 * Community Services republication -- plain HTML, not the 2.5 MB WHEAP manual PDF.
 * Confirmed 2026-08-21: https://liheapch.acf.gov/profiles/povertytables/FY2026/wismi.htm
 * prints exactly the six household-size-1-6 dollar figures already in WI_SMI_60.bySize.
 *
 * Household sizes 7-8 (and `perAdditionalPerson`) are not published there, or anywhere, as
 * raw numbers -- 45 CFR 96.85(b) specifies them as a formula ("add three percentage points
 * to the percentage adjustment for a six-person household" per person above six), so they
 * are derived here from the fetched size-4 figure rather than scraped from the WHEAP PDF.
 * Independently confirmed against the eCFR API (title-45, part 96, section 96.85(b)) while
 * planning this script -- the regulation's own percentages (52/68/84/100/116/132% for
 * sizes 1-6) are used below as a self-check against all six fetched values, not as their
 * source. If the six fetched values didn't reconcile with the regulation's fixed
 * percentages applied to the fetched size-4 base, that would be six independent
 * disagreements, not one -- a strong signal to fail loudly rather than trust either side.
 */
import { fetchText } from '../lib/http.ts';
import { parseDollarNumber } from '../lib/format.ts';
import { errMsg } from '../lib/errors.ts';
import type { SourceResult, BySizeTableData } from '../lib/types.ts';

const PAGE_URL_FOR = (year: number) => `https://liheapch.acf.gov/profiles/povertytables/FY${year}/wismi.htm`;

const REG_PERCENTAGES_1_TO_6 = [52, 68, 84, 100, 116, 132];
const REG_STEP_PER_PERSON_ABOVE_6 = 3; // percentage points, 45 CFR 96.85(b)
const ROUNDING_TOLERANCE_DOLLARS = 1;

export async function fetchWiSmi(candidateYear: number): Promise<SourceResult<BySizeTableData>> {
  const url = PAGE_URL_FOR(candidateYear);

  let res;
  try {
    res = await fetchText(url);
  } catch (err) {
    return { status: 'fetch-failed', message: `[WI SMI] Could not reach the LIHEAP Clearinghouse at ${url}: ${errMsg(err)}` };
  }
  if (res.status === 404) return { status: 'not-yet-published' };
  if (!res.ok) {
    return { status: 'fetch-failed', message: `[WI SMI] LIHEAP Clearinghouse returned HTTP ${res.status} for ${url}.` };
  }

  const anchor = '60 Percent of Estimated State Median Income';
  const anchorIndex = res.text.indexOf(anchor);
  if (anchorIndex === -1) {
    return {
      status: 'parse-failed',
      message: `[WI SMI] Could not find the "${anchor}" table header on ${url} -- the page's structure may have changed. Refusing to guess which numbers are the 60% SMI figures.`,
    };
  }
  const window = res.text.slice(anchorIndex, anchorIndex + 4000);
  const cellMatches = [...window.matchAll(/<td[^>]*>\s*\$?([\d,]+)\s*<\/td>/gi)].map((m) => parseDollarNumber(m[1]!));
  if (cellMatches.length < 6) {
    return {
      status: 'parse-failed',
      message: `[WI SMI] Found only ${cellMatches.length} dollar figure(s) after the "${anchor}" header on ${url} (expected 6, for household sizes 1-6) -- the table layout may have changed.`,
    };
  }
  const bySize1to6 = cellMatches.slice(0, 6);

  for (let i = 1; i < bySize1to6.length; i++) {
    if (bySize1to6[i]! <= bySize1to6[i - 1]!) {
      return {
        status: 'parse-failed',
        message: `[WI SMI] Parsed 60% SMI figures are not strictly increasing by household size on ${url}: ${bySize1to6.join(', ')}.`,
      };
    }
  }

  const base = bySize1to6[3]!; // the size-4 column IS the 60%-SMI base per 45 CFR 96.85(b)
  // Truncated, not rounded: checked both ways while building this script. All eight published
  // figures (the six fetched here plus the manual's own size-7/8 rows) reconcile exactly with
  // Math.floor(base * pct / 100); Math.round is off by $1 on several sizes (e.g. size 1:
  // 38_421.76 publishes as $38,421, not the $38,422 rounding would give).
  const expected1to6 = REG_PERCENTAGES_1_TO_6.map((pct) => Math.floor((base * pct) / 100));
  for (let i = 0; i < 6; i++) {
    if (Math.abs(expected1to6[i]! - bySize1to6[i]!) > ROUNDING_TOLERANCE_DOLLARS) {
      return {
        status: 'disagreement',
        message:
          `[WI SMI] 45 CFR 96.85(b)'s fixed percentages (${REG_PERCENTAGES_1_TO_6.join('/')}%) applied to the fetched ` +
          `size-4 base ($${base.toLocaleString('en-US')}) predict $${expected1to6[i]!.toLocaleString('en-US')} for ` +
          `household size ${i + 1}, but ${url} publishes $${bySize1to6[i]!.toLocaleString('en-US')}. These should reconcile ` +
          `to the rounded dollar. Either the regulation citation is stale, the page's shape changed in a way that shifted ` +
          `which numbers got parsed, or Wisconsin is applying a different rule than 45 CFR 96.85 specifies -- a human needs ` +
          `to look at both directly before this table is touched.`,
      };
    }
  }

  const size7 = Math.floor((base * (132 + REG_STEP_PER_PERSON_ABOVE_6)) / 100);
  const size8 = Math.floor((base * (132 + 2 * REG_STEP_PER_PERSON_ABOVE_6)) / 100);
  // The marginal step is not perfectly constant under truncation (3% of the base is $2,216.64,
  // so consecutive floor()s absorb that remainder unevenly -- the size 6->7 step truncates to
  // $2,216 while the 7->8 step truncates to $2,217, matching the manual's own published rows
  // exactly; see the long comment on WI_SMI_60 in income-tables.ts). For household sizes 9+,
  // beyond anything published or derivable from a second data point, the most recently
  // evidenced step (7->8) is used rather than re-deriving from the $2,216.64 remainder alone.
  const perAdditionalPerson = size8 - size7;

  return {
    status: 'ok',
    data: {
      bySize: [...bySize1to6, size7, size8],
      perAdditionalPerson,
      effectiveYear: candidateYear,
      source: url,
    },
    provenance: [
      url,
      `Sizes 7-8 and perAdditionalPerson are derived, not fetched: 45 CFR 96.85(b) ("add three percentage points to ` +
        `the percentage adjustment for a six-person household" per person above six) applied to the fetched size-4 base ` +
        `of $${base.toLocaleString('en-US')}. Sizes 1-6 above were cross-checked against this same regulation and matched ` +
        `within $${ROUNDING_TOLERANCE_DOLLARS}.`,
    ],
  };
}
