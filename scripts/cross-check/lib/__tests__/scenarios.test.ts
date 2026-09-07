import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assertCorpusResolves } from '../corpus.ts';
import { OFFLINE_SCENARIOS } from '../offline-scenarios.ts';

test('every committed Tier-3 fixture the corpus references resolves on disk', () => {
  assertCorpusResolves();
});

for (const scenario of OFFLINE_SCENARIOS) {
  test(`offline scenario: ${scenario.name}`, async () => {
    const { failures } = await scenario.run();
    assert.deepEqual(failures, [], failures.join('\n'));
  });
}
