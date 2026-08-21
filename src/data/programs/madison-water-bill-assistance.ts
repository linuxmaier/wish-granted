import type { Program } from '@/domain/program';
import { allOf, anyOf, hasAnyOf, incomeAtOrBelow, livesIn } from '@/domain/criteria';

/**
 * The record used to be framed as a shutoff-crisis payment plan gated on
 * `utilityShutoffRisk` / `paysHeatingCost` (a heating/electric fact -- odd for
 * a water bill program) at 200% FPL. The real, named program at this URL is
 * MadCAP (Madison Customer Assistance Program): an ongoing monthly credit for
 * eligible low-income households, not something you have to already be behind
 * or at risk of shutoff to get. Eligibility, income table, and categorical
 * list below all come directly from the city's own MadCAP page.
 */
export const madisonWaterBillAssistance: Program = {
  id: 'madison-water-bill-assistance',
  name: 'Madison Customer Assistance Program (MadCAP)',
  administeredBy: 'City of Madison',
  jurisdiction: 'city',
  provider: 'government',
  categories: ['housing-utilities'],

  summary:
    'A monthly credit on your City of Madison municipal services bill (water, sewer, stormwater, and urban forestry charges) for low-income households. You have to apply and reapply every year — it is not automatic.',
  benefit: 'A monthly credit of up to $30 on your municipal services bill. Never needs to be repaid.',

  eligibility: allOf(
    livesIn.madison,
    anyOf(
      incomeAtOrBelow('dane-ami', 50),
      hasAnyOf('currentBenefits', ['snap-foodshare', 'housing-choice-voucher', 'wic']),
    ),
  ),
  eligibilityCaveats: [
    'You must apply — eligible households are not enrolled automatically — and reapply every year.',
    'The account generally has to be in your name at your current Madison address.',
    'Unpaid municipal services bills are placed on the property tax roll, so this matters for homeowners as well as renters.',
    'If you are behind on your bill or facing a shutoff, call Madison Water Utility about a payment plan separately from applying for this credit.',
  ],

  howToApply: {
    url: 'https://www.cityofmadison.com/pay/madcap',
    phone: '608-266-4651',
    steps: [
      'Gather income verification — a tax return, Social Security statement, or proof you receive FoodShare, a Housing Choice Voucher, or WIC.',
      'Apply online or print and submit the PDF application.',
    ],
  },

  status: 'open',
  source: {
    url: 'https://www.cityofmadison.com/pay/madcap',
    name: 'City of Madison — Madison Customer Assistance Program (MadCAP)',
    // Confirmed via direct fetch (curl, standard browser user agent). Old
    // source URL (cityofmadison.com/water/customer-service/billing-payments)
    // 404s, as does the more general /water/customer-service; no Wayback
    // snapshot of the old URL was found, so treat it as never-correct rather
    // than moved. Confirmed directly from the MadCAP page: 50% AMI threshold
    // with its own published dollar table by household size, the categorical
    // list (FoodShare, Section 8/Housing Choice Voucher, WIC), the $30/month
    // credit, and annual reapplication. Phone number corrected to the Water
    // Utility office line (608-266-4651); the old number (608-266-4641)
    // didn't match the office (4651), main break (4661), or after-hours
    // (4665) numbers published on the utility's own contact page. The
    // published MadCAP dollar figures run a few percent above what this
    // app's dane-ami table would compute at 50% for the same household
    // sizes -- flagging for whoever verifies income-tables.ts (issue #3).
    lastVerified: '2026-08-21',
  },
};
