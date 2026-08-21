import { FACT_KEYS } from '../../src/domain/facts.ts';

/**
 * JSON Schema for `Criterion` (src/domain/criteria.ts), built from `FACT_KEYS`
 * rather than hand-copied -- so the schema handed to the model can never drift
 * from the actual fact vocabulary the way a maintained-by-hand copy could.
 *
 * Used as a forced tool-use schema on the extraction call (see extract-one.ts):
 * the model can only construct `Criterion` node shapes, and any `fact`
 * reference it uses must be one of the real declared facts. This does NOT by
 * itself guarantee the *values* compared against enum facts are valid (JSON
 * Schema can constrain `fact` to a known key, but not "the value must be one
 * of *that specific fact's* options" -- that's a cross-field constraint JSON
 * Schema can't express). That's exactly why schema-gate.ts exists as a
 * second, post-hoc check: the model's own tool-call schema keeps it in the
 * right neighborhood, and schema-gate.ts is the ground truth the way
 * tests/data/vocabulary.test.ts is for the hand-authored dataset.
 */

const FACT_KEY_SCHEMA = { type: 'string', enum: [...FACT_KEYS] } as const;

const VALUE_SCHEMA = {
  oneOf: [{ type: 'number' }, { type: 'string' }, { type: 'boolean' }],
} as const;

export function buildCriterionJsonSchema() {
  return {
    $defs: {
      criterion: {
        oneOf: [
          {
            type: 'object',
            properties: { kind: { const: 'always' }, label: { type: 'string' } },
            required: ['kind'],
            additionalProperties: false,
          },
          {
            type: 'object',
            properties: {
              kind: { const: 'manualReview' },
              note: {
                type: 'string',
                description:
                  'Plain-language reason a human needs to check this by hand -- e.g. "subject to funding availability", "waitlist status varies", "immigration-status exceptions apply".',
              },
              label: { type: 'string' },
            },
            required: ['kind', 'note'],
            additionalProperties: false,
          },
          {
            type: 'object',
            properties: {
              kind: { const: 'compare' },
              fact: FACT_KEY_SCHEMA,
              op: { enum: ['eq', 'neq', 'lt', 'lte', 'gt', 'gte'] },
              value: VALUE_SCHEMA,
              label: { type: 'string' },
            },
            required: ['kind', 'fact', 'op', 'value'],
            additionalProperties: false,
          },
          {
            type: 'object',
            properties: {
              kind: { const: 'set' },
              fact: FACT_KEY_SCHEMA,
              op: { enum: ['in', 'notIn', 'includesAny', 'includesAll', 'excludes'] },
              values: { type: 'array', items: { type: 'string' } },
              label: { type: 'string' },
            },
            required: ['kind', 'fact', 'op', 'values'],
            additionalProperties: false,
          },
          {
            type: 'object',
            properties: {
              kind: { const: 'incomeAtOrBelow' },
              scale: { enum: ['fpl', 'wi-smi', 'dane-ami'] },
              percent: { type: 'number' },
              label: { type: 'string' },
            },
            required: ['kind', 'scale', 'percent'],
            additionalProperties: false,
          },
          {
            type: 'object',
            properties: {
              kind: { const: 'allOf' },
              of: { type: 'array', items: { $ref: '#/$defs/criterion' }, minItems: 1 },
              label: { type: 'string' },
            },
            required: ['kind', 'of'],
            additionalProperties: false,
          },
          {
            type: 'object',
            properties: {
              kind: { const: 'anyOf' },
              of: { type: 'array', items: { $ref: '#/$defs/criterion' }, minItems: 1 },
              label: { type: 'string' },
            },
            required: ['kind', 'of'],
            additionalProperties: false,
          },
          {
            type: 'object',
            properties: {
              kind: { const: 'not' },
              of: { $ref: '#/$defs/criterion' },
              label: { type: 'string' },
            },
            required: ['kind', 'of'],
            additionalProperties: false,
          },
        ],
      },
    },
    type: 'object',
    properties: {
      criterion: {
        $ref: '#/$defs/criterion',
        description:
          'The extracted eligibility rule. Use manualReview (possibly nested inside allOf alongside real compare/incomeAtOrBelow/set criteria) for any condition you cannot express precisely and confidently -- do not guess a threshold or enumerate an exception list you are not certain is complete.',
      },
      sourceExcerpt: {
        type: 'string',
        description: 'The verbatim text span this rule was derived from, for human review.',
      },
      confidence: {
        enum: ['high', 'low'],
        description:
          'Your own confidence in `criterion` as extracted. "low" does not mean the extraction is wrong, only that a reviewer should look closer -- prefer this over silently guessing.',
      },
    },
    required: ['criterion', 'sourceExcerpt', 'confidence'],
    additionalProperties: false,
  };
}
