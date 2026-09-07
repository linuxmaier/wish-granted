import { test } from 'node:test';
import assert from 'node:assert/strict';

import { OFFLINE_SCENARIOS } from '../offline-scenarios.ts';
import { agenticExtractor } from '../../extractor.ts';
import { createFixtureFetcher } from '../fetcher.ts';
import { ScriptedModelClient } from '../scripted-model.ts';
import { MissingApiKeyError } from '../../../program-benchmark/lib/extractor.ts';
import * as F from '../fixtures-offline.ts';

for (const scenario of OFFLINE_SCENARIOS) {
  test(`scenario: ${scenario.name}`, async () => {
    const { failures } = await scenario.run();
    assert.deepEqual(failures, [], failures.join('\n'));
  });
}

test('agenticExtractor throws MissingApiKeyError when there is no key and no injected model', async () => {
  const extractor = agenticExtractor();
  await assert.rejects(
    extractor({ programId: 'p', sourceUrl: 'https://x.gov', sourceName: 'x', hasApiKey: false }),
    (err) => err instanceof MissingApiKeyError,
  );
});

test('agenticExtractor runs offline when a model is injected, ignoring hasApiKey', async () => {
  const { fetcher } = createFixtureFetcher(F.offlineFixtures());
  const model = new ScriptedModelClient([
    { toolCalls: [{ name: 'abstain', input: { reason: 'no decidable rule on this page' } }] },
  ]);
  const extractor = agenticExtractor({ model, fetcher });
  const result = await extractor({
    programId: 'seniorcare',
    sourceUrl: F.SENIORCARE_SOURCE_URL,
    sourceName: 'SeniorCare',
    hasApiKey: false,
  });
  assert.equal((result as { abstained?: boolean }).abstained, true);
});

test('the emitted CandidateRecord carries provenance in notes for the reviewer', async () => {
  const { run } = await OFFLINE_SCENARIOS[0]!.run();
  assert.ok(!('abstained' in run.result));
  if (!('abstained' in run.result)) {
    assert.match(run.result.notes ?? '', /PROVENANCE/);
    assert.match(run.result.notes ?? '', /Adult monthly income limit \(100% FPL\)/);
    assert.match(run.result.notes ?? '', /badgercareplus\/index\.htm/);
  }
});
