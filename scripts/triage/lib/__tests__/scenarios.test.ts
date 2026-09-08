import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assertCorpusConsistent } from '../corpus.ts';
import { OFFLINE_SCENARIOS } from '../offline-scenarios.ts';

test('the triage corpus is internally consistent (no duplicates, fixtures resolve)', () => {
  assertCorpusConsistent();
});

for (const scenario of OFFLINE_SCENARIOS) {
  test(`offline scenario: ${scenario.name}`, async () => {
    const { failures } = await scenario.run();
    assert.deepEqual(failures, [], failures.join('\n'));
  });
}
