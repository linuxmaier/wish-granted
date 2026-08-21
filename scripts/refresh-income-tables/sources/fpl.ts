/**
 * Federal Poverty Level, from HHS ASPE's own JSON API -- not the HTML guidelines page
 * (that page is still cited as `source`, since it's what a human reviewer would open, but
 * it is a secondary, non-blocking cross-check, not where the numbers come from).
 *
 * API confirmed live 2026-08-21: GET .../poverty-guidelines/api/{year}/us/{size} returns
 * `{"data":{"year":...,"household_size":...,"income":...,"state":"US"},"status":200}`.
 * Valid household sizes are documented as 1-8; this refresher only relies on that range.
 *
 * IMPORTANT, found while building this script: requesting a year the API does not have yet
 * does NOT 404 -- it returns HTTP 200 with the most recent year it actually has, silently,
 * e.g. requesting .../2027/us/4 today returns `{"data":{"year":"2026",...,"income":"33000"}}`.
 * Without checking the echoed `data.year` against the year that was actually requested, this
 * refresher would have written `effectiveYear: 2027` next to 2026's real dollar figures --
 * exactly the "stale numbers under a fresh-looking year" failure this project exists to
 * avoid. So every response's echoed year is checked; a mismatch is treated as
 * not-yet-published, not as success.
 */
import { fetchText } from '../lib/http.ts';
import { errMsg } from '../lib/errors.ts';
import type { SourceResult, BySizeTableData } from '../lib/types.ts';

const API_BASE = 'https://aspe.hhs.gov/topics/poverty-economic-mobility/poverty-guidelines/api';
const GUIDELINES_PAGE = 'https://aspe.hhs.gov/topics/poverty-economic-mobility/poverty-guidelines';

export async function fetchFpl(candidateYear: number): Promise<SourceResult<BySizeTableData>> {
  const values: number[] = [];
  const urls: string[] = [];

  for (let size = 1; size <= 8; size++) {
    const url = `${API_BASE}/${candidateYear}/us/${size}`;
    urls.push(url);

    let res;
    try {
      res = await fetchText(url);
    } catch (err) {
      return { status: 'fetch-failed', message: `[FPL] Could not reach the ASPE poverty-guidelines API at ${url}: ${errMsg(err)}` };
    }

    if (res.status === 404) {
      if (size === 1) return { status: 'not-yet-published' };
      return {
        status: 'parse-failed',
        message: `[FPL] ASPE API returned 404 for household size ${size} at ${url} after returning data for smaller sizes -- the API may be serving a partial year. Check ${url} by hand.`,
      };
    }
    if (!res.ok) {
      return { status: 'fetch-failed', message: `[FPL] ASPE API returned HTTP ${res.status} for household size ${size} at ${url}.` };
    }

    let json: unknown;
    try {
      json = JSON.parse(res.text);
    } catch {
      return {
        status: 'parse-failed',
        message: `[FPL] ASPE API response for household size ${size} at ${url} was not valid JSON -- the API's response shape may have changed. First 200 chars: ${res.text.slice(0, 200)}`,
      };
    }
    const parsed = extractIncomeAndYear(json);
    if (parsed === undefined) {
      return {
        status: 'parse-failed',
        message: `[FPL] ASPE API response for household size ${size} at ${url} had no usable "data.income"/"data.year" field -- the API's response shape may have changed. Got: ${JSON.stringify(json)}`,
      };
    }
    if (parsed.year !== candidateYear) {
      // The API answers with HTTP 200 and the most recent year it actually has, rather than
      // erroring, when asked for a year it does not have yet -- see the module doc comment.
      if (size === 1) return { status: 'not-yet-published' };
      return {
        status: 'parse-failed',
        message: `[FPL] Asked the ASPE API for year ${candidateYear} at ${url}, but it echoed back year ${parsed.year} for household size ${size} after echoing ${candidateYear} for smaller sizes -- inconsistent responses within the same run. Check ${API_BASE}/${candidateYear}/us/{1..8} by hand.`,
      };
    }
    values.push(parsed.income);
  }

  for (let i = 1; i < values.length; i++) {
    if (values[i]! <= values[i - 1]!) {
      return {
        status: 'parse-failed',
        message: `[FPL] ASPE API figures are not strictly increasing by household size (size ${i} = $${values[i - 1]}, size ${i + 1} = $${values[i]}) -- refusing to use them. Source: ${API_BASE}/${candidateYear}/us/{1..8}`,
      };
    }
  }

  const deltas = values.slice(1).map((v, i) => v - values[i]!);
  const perAdditionalPerson = deltas[0]!;
  if (!deltas.every((d) => d === perAdditionalPerson)) {
    return {
      status: 'parse-failed',
      message: `[FPL] Per-person increments between household sizes 1-8 are not constant (${deltas.join(', ')}) -- cannot safely derive perAdditionalPerson. Source: ${API_BASE}/${candidateYear}/us/{1..8}`,
    };
  }

  const provenance = [...urls];
  const fourPerson = values[3]!;
  const formatted = `$${fourPerson.toLocaleString('en-US')}`;
  try {
    const page = await fetchText(GUIDELINES_PAGE);
    if (page.ok && !page.text.includes(formatted)) {
      provenance.push(
        `Secondary check (non-blocking): the size-4 figure ${formatted} was not found as text on ${GUIDELINES_PAGE} -- the page may not be updated yet, or its format changed. Not blocking; the API is the primary source here.`,
      );
    } else if (page.ok) {
      provenance.push(`Secondary check: ${formatted} (size-4 figure) confirmed present on ${GUIDELINES_PAGE}.`);
    }
  } catch (err) {
    provenance.push(`Secondary check against ${GUIDELINES_PAGE} could not be completed: ${errMsg(err)}. Not blocking.`);
  }

  return {
    status: 'ok',
    data: { bySize: values, perAdditionalPerson, effectiveYear: candidateYear, source: GUIDELINES_PAGE },
    provenance,
  };
}

function extractIncomeAndYear(json: unknown): { income: number; year: number } | undefined {
  if (typeof json !== 'object' || json === null) return undefined;
  const data = (json as Record<string, unknown>).data;
  if (typeof data !== 'object' || data === null) return undefined;
  const rawIncome = (data as Record<string, unknown>).income;
  const rawYear = (data as Record<string, unknown>).year;
  const income = typeof rawIncome === 'number' ? rawIncome : typeof rawIncome === 'string' ? Number(rawIncome) : NaN;
  const year = typeof rawYear === 'number' ? rawYear : typeof rawYear === 'string' ? Number(rawYear) : NaN;
  if (!Number.isFinite(income) || income <= 0 || !Number.isFinite(year)) return undefined;
  return { income, year };
}
