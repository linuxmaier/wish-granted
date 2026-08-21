/**
 * Madison, WI HMFA (= Dane County alone -- see the "trap for the next verifier" note in
 * income-tables.ts) HUD area median income.
 *
 * huduser.gov itself WAF-blocks automated fetches (confirmed in issue #4's spike and again
 * here). This refresher uses the same two independent state/regional republications #3
 * hand-verified against: WHEDA's Section 8 Income Limits PDF and FHLBank Chicago's HUD
 * Income Guidelines PDF. Both are read for exactly one fact each -- the county's stated
 * median family income -- never the full size-adjusted limit grid.
 *
 * That restriction is deliberate, not laziness: `pdftotext -layout` on both PDFs was tested
 * while building this script, and the multi-column income-limit grids come out with columns
 * bled across adjacent counties -- genuinely wrong numbers that look plausible. The isolated
 * "FY{year} MFI: $X" / "MFI: X" line does not hit that failure mode in either PDF. See
 * docs/data-authoring.md.
 *
 * `sizeAdjustment` and `perAdditionalPersonFactor` are HUD's fixed methodology, already
 * modelled as constants in DANE_AMI -- this refresher never touches them.
 */
import { fetchText, fetchBuffer } from '../lib/http.ts';
import { pdfBufferToLayoutText } from '../lib/pdf.ts';
import { parseDollarNumber } from '../lib/format.ts';
import { errMsg } from '../lib/errors.ts';
import type { SourceResult, DaneAmiData } from '../lib/types.ts';

const WHEDA_URL_FOR = (year: number) =>
  `https://www.wheda.com/globalassets/documents/tax-credits/htc/${year}/${year}-section-8-income-limits-wheda.pdf`;
const FHLBC_LISTING_URL =
  'https://www.fhlbc.com/community-investment/competitive-affordable-housing-program-ahp/ahp-program-policy-and-forms/hud-income-guidelines';

export async function fetchDaneAmi(candidateYear: number): Promise<SourceResult<DaneAmiData>> {
  const whedaUrl = WHEDA_URL_FOR(candidateYear);

  let whedaBuf;
  try {
    whedaBuf = await fetchBuffer(whedaUrl);
  } catch (err) {
    return { status: 'fetch-failed', message: `[Dane AMI / WHEDA leg] Could not reach ${whedaUrl}: ${errMsg(err)}` };
  }
  if (whedaBuf.status === 404) return { status: 'not-yet-published' };
  if (!whedaBuf.ok) {
    return { status: 'fetch-failed', message: `[Dane AMI / WHEDA leg] ${whedaUrl} returned HTTP ${whedaBuf.status}.` };
  }

  let whedaText: string;
  try {
    whedaText = pdfBufferToLayoutText(whedaBuf.buffer);
  } catch (err) {
    return {
      status: 'fetch-failed',
      message: `[Dane AMI / WHEDA leg] Downloaded ${whedaUrl} but could not extract text: ${errMsg(err)}`,
    };
  }
  const whedaResult = extractWhedaMfi(whedaText, whedaUrl, candidateYear);
  if (typeof whedaResult !== 'number') return whedaResult;
  const whedaValue = whedaResult;

  let listingPage;
  try {
    listingPage = await fetchText(FHLBC_LISTING_URL);
  } catch (err) {
    return {
      status: 'fetch-failed',
      message: `[Dane AMI / FHLBank Chicago leg] Could not reach the listing page ${FHLBC_LISTING_URL}: ${errMsg(err)}. (The WHEDA leg succeeded: $${whedaValue.toLocaleString('en-US')} from ${whedaUrl}.)`,
    };
  }
  if (!listingPage.ok) {
    return {
      status: 'fetch-failed',
      message: `[Dane AMI / FHLBank Chicago leg] Listing page ${FHLBC_LISTING_URL} returned HTTP ${listingPage.status}. (The WHEDA leg succeeded: $${whedaValue.toLocaleString('en-US')} from ${whedaUrl}.)`,
    };
  }
  // The href carries a query string after `.pdf` (a CMS version token, e.g. `?sfvrsn=...`),
  // so the match has to run to the closing quote rather than stop at `.pdf` itself.
  const hrefMatch = listingPage.text.match(
    new RegExp(`href="(https://www\\.fhlbc\\.com[^"]*${candidateYear}_hud_income_limits_wi[^"]*\\.pdf[^"]*)"`, 'i'),
  );
  if (!hrefMatch) {
    return {
      status: 'parse-failed',
      message:
        `[Dane AMI / FHLBank Chicago leg] Fetched the listing page at ${FHLBC_LISTING_URL} but found no link containing ` +
        `"${candidateYear}_hud_income_limits_wi...pdf". Either FHLBank has not posted this year's file yet (even though ` +
        `WHEDA has, at ${whedaUrl}) or the listing page's structure changed. Check ${FHLBC_LISTING_URL} by hand -- the ` +
        `PDF's filename carries an unpredictable hash suffix, so this link has to be scraped fresh each year rather than ` +
        `guessed, and that scrape is the most likely piece of this whole script to break first.`,
    };
  }
  const fhlbcUrl = hrefMatch[1]!.replace(/&amp;/g, '&');

  let fhlbcBuf;
  try {
    fhlbcBuf = await fetchBuffer(fhlbcUrl);
  } catch (err) {
    return { status: 'fetch-failed', message: `[Dane AMI / FHLBank Chicago leg] Could not reach ${fhlbcUrl}: ${errMsg(err)}` };
  }
  if (!fhlbcBuf.ok) {
    return { status: 'fetch-failed', message: `[Dane AMI / FHLBank Chicago leg] ${fhlbcUrl} returned HTTP ${fhlbcBuf.status}.` };
  }

  let fhlbcText: string;
  try {
    fhlbcText = pdfBufferToLayoutText(fhlbcBuf.buffer);
  } catch (err) {
    return {
      status: 'fetch-failed',
      message: `[Dane AMI / FHLBank Chicago leg] Downloaded ${fhlbcUrl} but could not extract text: ${errMsg(err)}`,
    };
  }
  const fhlbcResult = extractFhlbcMfi(fhlbcText, fhlbcUrl);
  if (typeof fhlbcResult !== 'number') return fhlbcResult;
  const fhlbcValue = fhlbcResult;

  if (whedaValue !== fhlbcValue) {
    return {
      status: 'disagreement',
      message:
        `[Dane AMI] WHEDA (${whedaUrl}) publishes a Madison, WI HMFA / Dane County FY${candidateYear} median family ` +
        `income of $${whedaValue.toLocaleString('en-US')}; FHLBank Chicago (${fhlbcUrl}) publishes ` +
        `$${fhlbcValue.toLocaleString('en-US')} for Dane. These are two independent republications of the same HUD ` +
        `dataset and are expected to agree exactly. A human needs to check both directly (and ideally huduser.gov itself) ` +
        `to determine which, if either, is correct -- do not average or guess.`,
    };
  }

  return {
    status: 'ok',
    data: { fourPersonMedian: whedaValue, effectiveYear: candidateYear, source: whedaUrl },
    provenance: [whedaUrl, fhlbcUrl],
  };
}

function extractWhedaMfi(text: string, url: string, year: number): number | SourceResult<never> {
  // "Madison, WI HMFA" appears twice in this document: once in the front-matter county/FMR
  // index, and once as the actual income-limit table row we want. Check every occurrence
  // rather than assuming the first one is the data row.
  const lines = text.split('\n');
  const candidateIndexes = lines.reduce<number[]>((acc, l, i) => {
    if (l.includes('Madison, WI HMFA')) acc.push(i);
    return acc;
  }, []);
  if (candidateIndexes.length === 0) {
    return {
      status: 'parse-failed',
      message: `[Dane AMI / WHEDA leg] Could not find a "Madison, WI HMFA" row in ${url} -- the document's county listing may have changed structure. (Note: "Madison, WI MSA" is the wrong, wider area -- see the trap note in income-tables.ts.)`,
    };
  }
  for (const idx of candidateIndexes) {
    for (let i = idx; i < Math.min(idx + 5, lines.length); i++) {
      const m = lines[i]!.match(new RegExp(`FY\\s*${year}\\s*MFI:\\s*\\$?([\\d,]+)`));
      if (m) return parseDollarNumber(m[1]!);
    }
  }
  return {
    status: 'parse-failed',
    message: `[Dane AMI / WHEDA leg] Found "Madison, WI HMFA" ${candidateIndexes.length} time(s) in ${url} but no "FY ${year} MFI: $..." within a few lines of any occurrence -- the document's layout may have changed. In FY2026 the data row had it on the line immediately below the county name.`,
  };
}

function extractFhlbcMfi(text: string, url: string): number | SourceResult<never> {
  const lines = text.split('\n');
  const idx = lines.findIndex((l) => /^Dane(\s|$)/.test(l.trim()));
  if (idx === -1) {
    return {
      status: 'parse-failed',
      message: `[Dane AMI / FHLBank Chicago leg] Could not find a "Dane" county row in ${url} -- the document's county listing may have changed structure.`,
    };
  }
  for (let i = idx; i < Math.min(idx + 5, lines.length); i++) {
    const m = lines[i]!.match(/MFI:\s*\$?([\d,]+)/);
    if (m) return parseDollarNumber(m[1]!);
  }
  return {
    status: 'parse-failed',
    message: `[Dane AMI / FHLBank Chicago leg] Found "Dane" in ${url} but no "MFI: ..." on or immediately after that line -- the document's layout may have changed. Expected it on the line following the county name (true for FY2026).`,
  };
}
