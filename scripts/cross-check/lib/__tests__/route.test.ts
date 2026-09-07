import { test } from 'node:test';
import assert from 'node:assert/strict';

import { incomeAtOrBelow, allOf, anyOf, isTrue, livesIn } from '../../../../src/domain/criteria.ts';
import { ScriptedModelClient } from '../../../agentic-extract/lib/scripted-model.ts';
import { crossCheck, summariseRouting, type RouteDecision } from '../route.ts';
import { liveExclusionProbe } from '../live-probe.ts';
import type { MethodOutcome } from '../methods.ts';

const ex = (c: Parameters<typeof allOf>[0]): MethodOutcome => ({ decision: 'extract', criterion: c });
const abstain = (reason = 'no rule'): MethodOutcome => ({ decision: 'abstain', reason });

const SOURCE = 'SSI and W-2 recipients qualify regardless of income. Households at or below 200% of the FPL also qualify.';

test('both methods agree -> high confidence, no probe consulted', async () => {
  let probed = false;
  const d = await crossCheck({
    deterministic: ex(incomeAtOrBelow('fpl', 200)),
    agentic: ex(incomeAtOrBelow('fpl', 200)),
    probe: { ask: async () => { probed = true; return { excludedPerson: null, quotedSpan: null }; }, question: { sourceName: 's', sourceText: SOURCE } },
  });
  assert.equal(d.route, 'high-confidence');
  assert.equal(d.basis, 'methods-agree');
  assert.equal(probed, false);
});

test('dangerous divergence -> human/high, no probe consulted', async () => {
  const d = await crossCheck({
    deterministic: ex(anyOf(incomeAtOrBelow('fpl', 200), isTrue('isPregnantOrPostpartum'))),
    agentic: ex(incomeAtOrBelow('fpl', 200)),
  });
  assert.equal(d.route, 'human');
  assert.equal(d.priority, 'high');
  assert.equal(d.basis, 'methods-diverge-dangerous');
});

test('parser abstains + agentic extracts + probe clear -> high confidence via Path B', async () => {
  const d = await crossCheck({
    deterministic: abstain(),
    agentic: ex(allOf(livesIn.wisconsin, incomeAtOrBelow('fpl', 200))),
    probe: { ask: async () => ({ excludedPerson: null, quotedSpan: null }), question: { sourceName: 's', sourceText: SOURCE } },
  });
  assert.equal(d.basis, 'probe-clear');
  assert.equal(d.route, 'high-confidence');
});

test('parser abstains + probe names a span-verified person -> human/high', async () => {
  const d = await crossCheck({
    deterministic: abstain(),
    agentic: ex(incomeAtOrBelow('fpl', 200)),
    probe: {
      ask: async () => ({
        excludedPerson: 'an SSI recipient with income over 200% FPL',
        quotedSpan: 'SSI and W-2 recipients qualify regardless of income.',
      }),
      question: { sourceName: 's', sourceText: SOURCE },
    },
  });
  assert.equal(d.basis, 'probe-named-excluded');
  assert.equal(d.route, 'human');
  assert.equal(d.priority, 'high');
  assert.equal(d.probe?.spanVerified, true);
});

test('parser abstains + agentic extracts + no probe wired -> human/low, never trusted', async () => {
  const d = await crossCheck({ deterministic: abstain(), agentic: ex(incomeAtOrBelow('fpl', 200)) });
  assert.equal(d.basis, 'probe-skipped');
  assert.equal(d.route, 'human');
});

test('both methods abstain -> corroborated abstention, high confidence', async () => {
  const d = await crossCheck({ deterministic: abstain(), agentic: abstain('nothing published') });
  assert.equal(d.basis, 'methods-agree-abstain');
  assert.equal(d.route, 'high-confidence');
});

test('parser extracts + agentic abstains -> human/low', async () => {
  const d = await crossCheck({ deterministic: ex(incomeAtOrBelow('fpl', 200)), agentic: abstain('over-cautious') });
  assert.equal(d.basis, 'agentic-abstained-parser-did-not');
  assert.equal(d.route, 'human');
});

test('liveExclusionProbe drives one fresh model turn and reads the tool call', async () => {
  const model = new ScriptedModelClient([
    {
      expect: (req) => {
        // Fresh: exactly one user message, no assistant/tool history.
        assert.equal(req.messages.length, 1);
        assert.equal(req.messages[0]!.role, 'user');
        assert.equal(req.tools.length, 1);
      },
      toolCalls: [
        {
          name: 'report_exclusion',
          input: {
            found: true,
            excluded_person: 'an SSI recipient over 200% FPL',
            quoted_span: 'SSI and W-2 recipients qualify regardless of income.',
          },
        },
      ],
    },
  ]);
  const ask = liveExclusionProbe({ model });
  const answer = await ask({ sourceName: 's', sourceText: SOURCE, rule: incomeAtOrBelow('fpl', 200) });
  assert.equal(answer.excludedPerson, 'an SSI recipient over 200% FPL');
  assert.equal(answer.quotedSpan, 'SSI and W-2 recipients qualify regardless of income.');
});

test('summariseRouting reports the agreement rate and flags a route-everything outcome', () => {
  const mk = (basis: RouteDecision['basis'], route: RouteDecision['route'], comparable: boolean, equivalent: boolean): RouteDecision => ({
    route,
    priority: route === 'human' ? 'low' : undefined,
    basis,
    reason: '',
    agreement: {
      verdict: comparable ? (equivalent ? 'equivalent' : 'divergent-dangerous') : 'not-comparable',
      comparable,
      agenticNarrower: false,
      deterministicNarrower: false,
      detail: '',
    },
  });
  const decisions = [
    mk('methods-agree', 'high-confidence', true, true),
    mk('methods-diverge-dangerous', 'human', true, false),
    mk('methods-diverge-dangerous', 'human', true, false),
    mk('probe-skipped', 'human', false, false),
    mk('probe-skipped', 'human', false, false),
    mk('probe-named-excluded', 'human', false, false),
  ];
  const s = summariseRouting(decisions);
  assert.equal(s.comparable, 3);
  assert.equal(s.agreed, 1);
  assert.ok(s.agreementRate !== null && Math.abs(s.agreementRate - 1 / 3) < 1e-9);
  assert.equal(s.toHighConfidence, 1);
  assert.equal(s.routeEverythingWarning, true);
});
