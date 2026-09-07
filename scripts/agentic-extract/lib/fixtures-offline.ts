/**
 * Saved source fixtures for the offline suite and the --self-test.
 *
 * These are hand-written, trimmed pages that carry the STRUCTURAL features the
 * wizard-of-oz cases turned on -- a multi-population income table with real
 * column headers, a "cost-sharing tiers" sentence upstream of some percentages,
 * an eCFR section with a `notwithstanding paragraph (a)` clause, a program whose
 * eligibility list is on a different page than its cited source. They are not
 * byte-for-byte archives of the live pages (those move; #5 §5). Their job is to
 * prove the machinery, not to stand in for a live measurement.
 */

const H = 'https://www.dhs.wisconsin.gov';

/** BadgerCare Plus income page -- the cited URL, which 404s in the wild. */
export const BADGERCARE_DEAD_URL = `${H}/badgercareplus/income-limits.htm`;
/** Where recovery (…/badgercareplus/ + index.htm) lands. */
export const BADGERCARE_LIVE_URL = `${H}/badgercareplus/index.htm`;
export const BADGERCARE_FPL_URL = `${H}/badgercareplus/fpl.htm`;

export const BADGERCARE_LIVE_HTML = `<!doctype html><html><head><title>BadgerCare Plus</title></head>
<body>
<nav>Site menu — Programs — Contact</nav>
<main>
  <h1>BadgerCare Plus</h1>
  <p>BadgerCare Plus is a health care program for low-income Wisconsin residents.</p>
  <h2>Who can get BadgerCare Plus</h2>
  <p>Eligibility depends on your household size, income, and whether you are a child, a pregnant person, or an adult. See the monthly income limits below.</p>
  <table>
    <caption>Monthly income limits by group (2026)</caption>
    <tr>
      <th>Household size</th>
      <th>Adult monthly income limit (100% FPL)</th>
      <th>Children monthly income limit (306% FPL)</th>
      <th>Pregnant people monthly income limit (306% FPL)</th>
      <th>Children premium threshold (201% FPL)</th>
    </tr>
    <tr><td>1</td><td>$1,255</td><td>$3,841</td><td>$3,841</td><td>$2,525</td></tr>
    <tr><td>2</td><td>$1,704</td><td>$5,214</td><td>$5,214</td><td>$3,428</td></tr>
  </table>
  <p>The 201% FPL figure is a premium trigger for children, not an eligibility cutoff.</p>
  <p>Apply at access.wisconsin.gov or call 1-800-362-3002.</p>
</main>
<footer>Wisconsin Department of Health Services</footer>
</body></html>`;

export const BADGERCARE_FPL_HTML = `<!doctype html><html><body><main>
  <h1>Federal Poverty Level tables</h1>
  <p>These tables show the federal poverty level by household size, updated annually.</p>
</main></body></html>`;

/** SNAP / FoodShare elderly-separate-household page that cross-references the CFR. */
export const SNAP_SOURCE_URL = `${H}/foodshare/elderly-disabled.htm`;
export const SNAP_SOURCE_HTML = `<!doctype html><html><body><main>
  <h1>FoodShare: elderly or disabled members</h1>
  <p>An elderly or disabled person who cannot buy and prepare meals separately may count as a separate household. This follows the federal rule at 7 CFR 273.1, and notwithstanding paragraph (a) of that section, a separate-household determination turns on the income of the other people in the home.</p>
  <p>Call your local agency or 1-800-362-3002 to apply.</p>
</main></body></html>`;

/** SNAP household concept -- eCFR versioner API section XML (trimmed). */
export const ECFR_273_1_URL_BASE = 'https://www.ecfr.gov/api/versioner/v1/full';
export const ECFR_273_1_XML = `<?xml version="1.0" encoding="UTF-8"?>
<DIV8 TYPE="SECTION" N="273.1">
  <HEAD>§ 273.1 Household concept and application.</HEAD>
  <P>(a) <I>Household definition.</I> A household is an individual or a group of individuals who live together and customarily purchase and prepare meals together.</P>
  <P>(b) <I>Special rules.</I></P>
  <P>(1) An elderly and disabled individual who lives with others may be a separate household if the others' income is within limits.</P>
  <P>(2) Notwithstanding the provisions of paragraph (a) of this section, an otherwise eligible member who is unable to purchase and prepare meals because of a disability may be considered a separate household if the income of the others with whom the individual resides (excluding the elderly and disabled individual and spouse) does not exceed 165 percent of the poverty line.</P>
</DIV8>`;

/** SeniorCare -- the cited source is fpl.htm, but eligibility lives on index.htm. */
export const SENIORCARE_SOURCE_URL = `${H}/seniorcare/fpl.htm`;
export const SENIORCARE_INDEX_URL = `${H}/seniorcare/index.htm`;

export const SENIORCARE_FPL_HTML = `<!doctype html><html><body><main>
  <h1>SeniorCare — Federal Poverty Level</h1>
  <p>SeniorCare uses the federal poverty level to set coverage levels. For who is eligible, see the SeniorCare home page.</p>
</main></body></html>`;

export const SENIORCARE_INDEX_HTML = `<!doctype html><html><body><main>
  <h1>SeniorCare Prescription Drug Assistance</h1>
  <h2>Who is eligible</h2>
  <p>You are eligible for SeniorCare if you are a Wisconsin resident, you are 65 years of age or older, and you are a U.S. citizen or qualifying immigrant. There is no income limit to enroll in SeniorCare.</p>
  <h2>Coverage levels</h2>
  <p>Your coverage level and copayments depend on your income, but every eligible person can enroll regardless of income. Level 3 has no upper income limit.</p>
</main></body></html>`;

export interface OfflineFixtureSet {
  [url: string]: {
    status?: number;
    body?: string;
    finalUrl?: string;
    unreachable?: string;
    blocked?: string;
    requireHeaders?: Record<string, string>;
  };
}

/** The full fixture map covering every offline scenario. */
export function offlineFixtures(today = new Date().toISOString().slice(0, 10)): OfflineFixtureSet {
  const ecfrUrl = `${ECFR_273_1_URL_BASE}/${today}/title-7.xml?part=273&section=273.1`;
  return {
    [SNAP_SOURCE_URL]: { body: SNAP_SOURCE_HTML },
    [BADGERCARE_DEAD_URL]: { status: 404 },
    [BADGERCARE_LIVE_URL]: { body: BADGERCARE_LIVE_HTML },
    [`${H}/badgercareplus/`]: { status: 404 },
    [BADGERCARE_FPL_URL]: { body: BADGERCARE_FPL_HTML },
    [SENIORCARE_SOURCE_URL]: { body: SENIORCARE_FPL_HTML },
    [SENIORCARE_INDEX_URL]: { body: SENIORCARE_INDEX_HTML },
    [`${H}/seniorcare/`]: { status: 404 },
    // The eCFR versioner: 406 unless the request carries Accept-Encoding.
    [ecfrUrl.split('?')[0]!]: {
      body: ECFR_273_1_XML,
      requireHeaders: { 'accept-encoding': 'gzip' },
    },
  };
}
