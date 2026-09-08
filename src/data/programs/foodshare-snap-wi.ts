import type { Program } from '@/domain/program';
import { allOf, anyOf, hasAnyOf, incomeAtOrBelow, livesIn } from '@/domain/criteria';

/**
 * Wisconsin administers SNAP under the name FoodShare and sets its gross income
 * limit at 200% FPL -- higher than the federal 130% floor -- so the rule below
 * uses the Wisconsin number, not the federal one.
 *
 * USDA's federal SNAP standard is two income tests: 130% FPL gross AND 100%
 * FPL net. Wisconsin's broad-based categorical eligibility (BBCE) replaces
 * the 130% gross test with its own 200% gross test for most households AND
 * waives the separate net-income test for eligibility purposes -- confirmed
 * directly from Wisconsin's FoodShare Policy Handbook, Release 26-02 (Aug 12
 * 2026), section 4.2.1.1 ("Broad-based categorically eligible food units have
 * no asset test") and section 1.1.4's "Income Test" subsection verbatim:
 * "Food units that are not categorically eligible must pass the 100% FPL net
 * income test... Broad-based categorically eligible food units do not have to
 * pass this test." (emhandbooks.wisconsin.gov/fsh/policy_files/1/11/1.1.4.htm
 * and .../4/42/4.2.1.htm, fetched directly 2026-08-21.) Net income still
 * affects the *benefit amount* for BBCE households -- the handbook notes
 * large assistance groups (3+) with high net income "might not receive
 * FoodShare benefits" via the allotment calculation -- but that is a benefit
 * question, not an eligibility one, so it stays out of `eligibility` and is
 * covered by the existing "amount depends on... income" line in `benefit`.
 * Do not add a second `incomeAtOrBelow('fpl', 100)` test here: for the ~all
 * of our applicants who qualify via BBCE (gross <= 200% FPL), it is not a
 * real eligibility gate, and adding it would wrongly rule people out.
 */
export const foodshareSnapWi: Program = {
  id: 'foodshare-snap-wi',
  name: 'FoodShare Wisconsin (SNAP)',
  administeredBy: 'Wisconsin Department of Health Services',
  jurisdiction: 'state',
  provider: 'government',
  categories: ['food-basic-needs'],

  summary:
    'Wisconsin’s version of SNAP, once called food stamps. Money is loaded onto a QUEST card each month that you use like a debit card at grocery stores and many farmers markets.',
  benefit:
    'A monthly food benefit on a QUEST card. The amount depends on household size, income, and expenses.',

  eligibility: allOf(
    livesIn.wisconsin,
    anyOf(
      incomeAtOrBelow('fpl', 200),
      // Receiving SSI or W-2 confers categorical eligibility, which bypasses
      // the income test entirely.
      hasAnyOf('currentBenefits', ['ssi', 'w2-tanf']),
    ),
  ),
  eligibilityCaveats: [
    'Adults aged 18-52 without dependents may need to meet work requirements to keep benefits beyond three months.',
    'Some households face an asset limit. Most do not, but it is checked during the application.',
    'Immigration status affects eligibility for some household members. Children are often eligible even when adults are not.',
    // Sourced from WI FoodShare Policy Handbook 4.2.1.3 / 1.1.4: households
    // with an elderly, blind, or disabled member and gross income above 200%
    // FPL fall back to regular SNAP rules -- no gross income limit at all,
    // just a 100% FPL net-income test after deductions -- so they can still
    // qualify even though the gross-income check above would say no. We do
    // not have facts for disability status or the deduction stack needed to
    // evaluate this, so it stays a caveat rather than a rule.
    //
    // Issue #88 added an `age` fact, so the "elderly" (60+) half of the
    // trigger is now askable -- checked, and it is still not encodable. The
    // provision is "elderly, blind, OR disabled": age is one disjunct of
    // three and `hasDisability` stays reserved, so an age-only gate would
    // wrongly rule out the blind/disabled cases. It is any household member,
    // not necessarily the applicant whose age we ask. And qualifying still
    // turns on the 100% FPL *net*-income test after a deduction stack this
    // engine does not model. The 60+ separate-household test additionally
    // measures the income of the *other* residents, excluding the applicant,
    // and no fact isolates a household subset (docs/eligibility-extraction.md).
    // So the whole provision stays prose.
    'If your household includes someone who is elderly, blind, or disabled, you may still qualify even with gross income above 200% of the poverty line — a different rule based on income after deductions applies. Check with your county agency or ACCESS Wisconsin.',
  ],

  howToApply: {
    // access.wisconsin.gov 301-redirects here; recorded as the destination.
    url: 'https://access.wi.gov/s/',
    phone: '1-800-362-3002',
    steps: [
      'Apply online through ACCESS Wisconsin, by phone, or in person at your county agency.',
      'Complete an interview, usually by phone.',
      'Send proof of income and expenses if asked.',
    ],
  },
  requiredDocuments: [
    'Photo ID',
    'Proof of income for everyone in the household',
    'Proof of housing and utility costs',
  ],

  status: 'open',
  source: {
    url: 'https://www.dhs.wisconsin.gov/foodshare/index.htm',
    name: 'Wisconsin DHS — FoodShare',
    // Confirmed via headless-browser fetch (dhs.wisconsin.gov blocks plain
    // HTTP fetchers): name, 200% FPL gross income limit table
    // (dhs.wisconsin.gov/foodshare/fpl.htm, effective 10/1/2025-9/30/2026),
    // and phone number all match. ACCESS Wisconsin apply URL updated below.
    lastVerified: '2026-08-21',
  },
};
