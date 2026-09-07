/**
 * Tool schemas and the system prompt for the agentic extractor.
 *
 * The Criterion sub-schema is reused from
 * scripts/llm-extraction/criterion-schema.ts (depth-inlined, no `$ref`, no
 * `strict: true` -- #5 §4.5: a recursive expression language cannot be enforced
 * by structured output; schema-gate.ts is the real check). The enum-slug list
 * is reused from scripts/llm-extraction/enum-vocab.ts.
 */
import { buildCriterionJsonSchema } from '../../llm-extraction/criterion-schema.ts';
import { describeEnumFacts } from '../../llm-extraction/enum-vocab.ts';
import type { ToolDef } from './model-client.ts';

export const TOOL_NAMES = {
  fetch: 'fetch_page',
  cfr: 'resolve_cfr_reference',
  search: 'search_web',
  emit: 'emit_record',
  abstain: 'abstain',
} as const;

const PROVENANCE_SCHEMA = {
  type: 'array',
  minItems: 1,
  description:
    'One entry per part of the rule. Each quote MUST be copied verbatim (an exact substring) from a page you fetched this run, and `url` MUST be the page you read it on -- if you read it via resolve_cfr_reference, use that resolved URL, not the entry page. A record whose spans do not verify is rejected.',
  items: {
    type: 'object',
    properties: {
      quote: { type: 'string', description: 'Verbatim span from the source text.' },
      url: { type: 'string', description: 'The URL this exact span was fetched from.' },
    },
    required: ['quote', 'url'],
    additionalProperties: false,
  },
} as const;

export function buildTools(): ToolDef[] {
  const criterion = buildCriterionJsonSchema();
  return [
    {
      name: TOOL_NAMES.fetch,
      description:
        'Fetch a source URL and get back its text with structure preserved (headings kept, every block tagged with the heading path it sits under, tables rendered row-by-row with column headers attached to each cell). Follows redirects. If the URL is dead (404/410) it tries sibling and index pages automatically; if that fails you get the dead-URL report and should try a corrected URL or search_web.',
      input_schema: {
        type: 'object',
        properties: { url: { type: 'string', description: 'Absolute URL to fetch.' } },
        required: ['url'],
        additionalProperties: false,
      },
    },
    {
      name: TOOL_NAMES.cfr,
      description:
        'Resolve a Code of Federal Regulations cross-reference (e.g. "paragraph (a) of this section", "§ 273.9") by fetching the section XML from the eCFR versioner API. Use this when the page text refers to another paragraph or section you cannot see. The resolved API URL is what you must cite as provenance for anything you read here.',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'number', description: 'CFR title number, e.g. 7 for SNAP.' },
          part: { type: 'number', description: 'CFR part number, e.g. 273.' },
          section: { type: 'string', description: 'Section, e.g. "273.1".' },
          date: { type: 'string', description: 'ISO date (YYYY-MM-DD). Optional; defaults to today.' },
        },
        required: ['title', 'part', 'section'],
        additionalProperties: false,
      },
    },
    {
      name: TOOL_NAMES.search,
      description:
        'Search the web for the current location of a program page. NOTE: web search is not wired in this build -- this returns guidance only. Prefer fetch_page with a corrected URL.',
      input_schema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
        additionalProperties: false,
      },
    },
    {
      name: TOOL_NAMES.emit,
      description:
        'Emit the extracted program record. Only call this when every part of the eligibility rule is backed by a verbatim span from a page you fetched. Use manualReview (possibly one leaf inside a larger allOf) for any condition you cannot express precisely -- never guess a threshold or a scope.',
      input_schema: {
        type: 'object',
        properties: {
          eligibility: criterion.properties.criterion,
          provenance: PROVENANCE_SCHEMA,
          name: { type: 'string' },
          administeredBy: { type: 'string' },
          summary: { type: 'string' },
          benefit: { type: 'string' },
          howToApplyUrl: { type: 'string' },
          howToApplyPhone: { type: 'string' },
          requiredDocuments: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string', description: 'Anything a human reviewer should see. Not scored.' },
        },
        required: ['eligibility', 'provenance'],
        additionalProperties: false,
      },
    },
    {
      name: TOOL_NAMES.abstain,
      description:
        'Decline to produce a record. The correct answer whenever the source does not state a clear, decidable eligibility rule, or you cannot reach the governing text. Abstention beats guessing, always.',
      input_schema: {
        type: 'object',
        properties: { reason: { type: 'string' } },
        required: ['reason'],
        additionalProperties: false,
      },
    },
  ];
}

export function buildSystemPrompt(): string {
  return [
    `You extract the eligibility rule for ONE assistance program from its real source pages into a small JSON expression language (a "Criterion" tree), by fetching and navigating the source yourself. You are not given an excerpt.`,
    ``,
    `Method:`,
    `- Start from the source URL you are given. Fetch it. Follow "eligibility", "who qualifies", "income limits" links. If a URL is dead, the fetch tool tries to recover it; if that fails, try a corrected URL.`,
    `- Read structure as structure. A number under a column header like "Pregnant people and children monthly income limit (306% FPL)" is scoped to that population -- it is NOT a blanket ceiling. A percentage three paragraphs below a sentence that calls those percentages "cost-sharing tiers" is not an eligibility threshold.`,
    `- If the text says "notwithstanding paragraph (a)" or cites another section, resolve it with resolve_cfr_reference before you rely on it.`,
    `- The eligibility list may be on a different page than the one cited as the source. Assemble across pages.`,
    ``,
    `Rules for the emitted rule:`,
    `- Every part of the rule must be backed by a verbatim quote from a page you fetched, with the URL you read it on. Cross-referenced text: cite the resolved URL.`,
    `- Carry scope into the rule. If an income limit applies only to pregnant people, encode that (anyOf of population-scoped branches), or use manualReview -- do not flatten it to one ceiling.`,
    `- The worst possible error is a rule NARROWER than reality: it tells someone they do not qualify when they do. Over-inclusive is recoverable; narrower is not. When unsure whether a condition belongs, leave it out or use manualReview.`,
    `- Only use fact keys and enum slugs that actually exist (listed below). Drop any program/category the source names that has no slug; never invent one.`,
    `- manualReview can be the whole rule or one leaf inside allOf. Do not collapse a whole program to manualReview because one condition is undecidable; do not force a rule when the honest answer is manualReview.`,
    `- If the source does not state a clear decidable rule, call abstain. That is a correct, expected outcome.`,
    ``,
    describeEnumFacts(),
  ].join('\n');
}
