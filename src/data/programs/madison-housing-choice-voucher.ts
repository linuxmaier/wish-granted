import type { Program } from '@/domain/program';
import { allOf, incomeAtOrBelow, livesIn, oneOf, manualReview } from '@/domain/criteria';

export const madisonHousingChoiceVoucher: Program = {
  id: 'madison-housing-choice-voucher',
  name: 'Housing Choice Voucher (Section 8)',
  administeredBy: 'Community Development Authority of the City of Madison',
  jurisdiction: 'city',
  provider: 'government',
  categories: ['housing-utilities'],

  summary:
    'A voucher that pays part of your rent directly to a private landlord. You find the apartment; the voucher covers the difference between roughly 30% of your income and the rent. The waiting list has been closed since 2023 — this is a lead to check on, not an active program to apply to today.',
  benefit: 'Ongoing monthly rent assistance paid to your landlord.',

  // City residency is deliberately not a hard gate: the CDA's own applicants
  // page states "Applicants do not need to live in the City of Madison
  // currently" (Madison residents get preference, not a requirement), so a
  // `livesIn.madison` criterion would wrongly rule out an eligible applicant.
  // State is kept as a gate, though: HCV waitlists are technically open to
  // anyone nationwide, but this app is scoped to Wisconsin, and dropping
  // geography entirely surfaced a Madison-specific, currently-closed waiting
  // list to people with no Wisconsin connection at all -- low practical value
  // and out of step with how the rest of this dataset treats "Wisconsin
  // resident" as the app's own boundary (see lifeline-phone-internet.ts for
  // the genuinely-nationwide counter-example).
  eligibility: allOf(
    livesIn.wisconsin,
    oneOf('housingStatus', ['renting', 'unhoused-or-temporary', 'living-with-others']),
    incomeAtOrBelow('dane-ami', 50),
    // The Section 8 lottery has been closed to new applications since April 2,
    // 2023, and no rules engine can tell someone whether or when it reopens.
    // Encoding it as `manualReview` keeps this program in "might qualify"
    // rather than promising an outcome the CDA controls.
    manualReview(
      'The Section 8 waiting list has been closed to new applications since April 2023. The CDA is not currently accepting applications; check cityofmadison.com/dpced/housing/applicants for a reopening.',
    ),
  ),
  eligibilityCaveats: [
    'Applicants do not need to currently live in the City of Madison, but Madison residents get application preference when a list is open.',
    'Waits are commonly measured in years once a list opens.',
    'A criminal background check and rental history review are part of the process.',
    'Vouchers can usually be transferred to another housing authority after the first year.',
  ],

  howToApply: {
    url: 'https://www.cityofmadison.com/dpced/housing/applicants',
    phone: '608-266-4675',
    steps: [
      'Check whether the waiting list is currently open — it has been closed since April 2023.',
      'Apply online while it is open — the window is often short.',
      'Keep your contact details current; applications are removed if the CDA cannot reach you.',
    ],
  },

  status: 'closed',
  seasonalNote:
    'The Section 8 voucher waiting list has been closed to new applications since April 2023. (The CDA’s separate public housing waiting list is open; this record covers Section 8 vouchers only.)',
  source: {
    url: 'https://www.cityofmadison.com/dpced/housing/applicants',
    name: 'City of Madison CDA Housing — Applicants',
    // Confirmed via direct fetch. cityofmadison.com/cda/housing-assistance
    // (old source URL) now 404s; current page is /dpced/housing/applicants.
    // That page states in its own body text: "The Section 8 lottery closed
    // on April 2, 2023. We are not currently accepting applications." Checked
    // this wasn't simply a stale, forgotten page: the CDA's main housing page
    // carries active, dated announcements from August 2026 (a PHA annual plan
    // comment period, a July 2026 news release) and its site navigation
    // separately labels the item "Section 8 Lottery (Closed)" -- consistent,
    // current signals, not one stale sentence. Income-limit dollar figures by
    // household size are published directly on this page; flagging for
    // whoever verifies dane-ami in income-tables.ts (issue #3) since the
    // published Section 8 limit ($67,650 for a 4-person household) does not
    // cleanly resolve to 50% of the $124,000 four-person median on file here.
    lastVerified: '2026-08-21',
  },
};
