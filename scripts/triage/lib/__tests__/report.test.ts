import { test } from 'node:test';
import assert from 'node:assert/strict';

import { summariseRouting, renderRouting, type PerCaseRow } from '../report.ts';
import type { TriageRoute } from '../route.ts';

function row(programId: string, route: TriageRoute, uncertain = false): PerCaseRow {
  return {
    programId,
    tier: 'x',
    decision: {
      route,
      reason: 'r',
      evidence: [],
      parser: { decision: 'abstain', code: 'NO_RULE_STATED', reason: 'x' },
      signals: { rulePresent: [], noRule: [] },
      vocabularyGap: [],
      uncertain,
    },
  };
}

test('a mixed distribution is not degenerate', () => {
  const rows = [
    row('a', 'deterministic'), row('b', 'deterministic'), row('c', 'agentic'),
    row('d', 'agentic', true), row('e', 'no-rule-published'), row('f', 'no-rule-published'),
  ];
  const s = summariseRouting(rows);
  assert.equal(s.noRuleDegenerate, false);
  assert.equal(s.singleRouteDegenerate, false);
  assert.equal(s.uncertain, 1);
});

test('everything to no-rule-published trips both degenerate flags', () => {
  const rows = Array.from({ length: 9 }, (_, i) => row(`p${i}`, 'no-rule-published'));
  const s = summariseRouting(rows);
  assert.equal(s.noRuleDegenerate, true);
  assert.equal(s.singleRouteDegenerate, true);
  assert.match(renderRouting(rows).text, /DEGENERATE-OUTCOME WARNING/);
});

test('everything to one non-no-rule route trips only the single-route flag', () => {
  const rows = Array.from({ length: 8 }, (_, i) => row(`p${i}`, 'agentic'));
  const s = summariseRouting(rows);
  assert.equal(s.noRuleDegenerate, false);
  assert.equal(s.singleRouteDegenerate, true);
});

test('the render names all three routes and the count', () => {
  const text = renderRouting([row('a', 'deterministic'), row('b', 'agentic'), row('c', 'no-rule-published')]).text;
  assert.match(text, /deterministic\s+1 \/ 3/);
  assert.match(text, /agentic\s+1 \/ 3/);
  assert.match(text, /no-rule-published\s+1 \/ 3/);
});
