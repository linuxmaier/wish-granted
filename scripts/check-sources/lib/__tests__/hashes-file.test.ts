import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  sha256,
  emptyHashesFile,
  readHashesFile,
  serializeHashesFile,
  writeHashesFile,
  type HashesFile,
  type SourceHashEntry,
} from '../hashes-file.ts';

function entry(over: Partial<SourceHashEntry> = {}): SourceHashEntry {
  return {
    url: 'https://example.gov/a',
    normalizedSha256: sha256('a'),
    normalizedChars: 1,
    status: 'ok',
    firstSeen: '2026-01-01',
    lastChanged: '2026-01-01',
    ...over,
  };
}

test('sha256 is stable and prefixed', () => {
  assert.equal(sha256('hello'), sha256('hello'));
  assert.match(sha256('hello'), /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(sha256('hello'), sha256('world'));
});

test('serialize sorts ids and pins key order so diffs stay small', () => {
  const file: HashesFile = {
    ...emptyHashesFile(),
    sources: { zeta: entry({ url: 'https://z' }), alpha: entry({ url: 'https://a' }) },
  };
  const text = serializeHashesFile(file);
  assert.ok(text.indexOf('"alpha"') < text.indexOf('"zeta"'));
  assert.ok(text.endsWith('\n'));
  // Key order within an entry is fixed regardless of insertion order.
  const firstEntry = text.slice(text.indexOf('"alpha"'));
  assert.ok(firstEntry.indexOf('"url"') < firstEntry.indexOf('"normalizedSha256"'));
  assert.ok(firstEntry.indexOf('"status"') < firstEntry.indexOf('"firstSeen"'));
  assert.doesNotMatch(text, /lastChecked/);
});

test('serialize is idempotent -- re-serializing a parsed file is a no-op', () => {
  const file: HashesFile = { ...emptyHashesFile(), sources: { a: entry(), b: entry({ url: 'https://b' }) } };
  const once = serializeHashesFile(file);
  const reparsed = { ...emptyHashesFile(), sources: (JSON.parse(once) as HashesFile).sources };
  assert.equal(serializeHashesFile(reparsed), once);
});

test('read/write round-trips through a real file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'check-sources-'));
  const path = join(dir, 'source-hashes.json');
  const file: HashesFile = { ...emptyHashesFile(), sources: { a: entry() } };
  writeHashesFile(file, path);
  const back = readHashesFile(path);
  assert.deepEqual(back.sources, file.sources);
});

test('readHashesFile returns an empty file when the path does not exist', () => {
  const back = readHashesFile(join(tmpdir(), 'definitely-not-here-8f3a.json'));
  assert.deepEqual(back.sources, {});
});

test('readHashesFile tolerates a file missing the sources key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'check-sources-'));
  const path = join(dir, 'x.json');
  writeFileSync(path, '{}', 'utf8');
  assert.deepEqual(readHashesFile(path).sources, {});
});

test('the committed baseline file (if present) is already in canonical form', () => {
  // Guards against a hand-edit that would make the next run produce a
  // whitespace-only diff.
  const path = join(import.meta.dirname, '..', '..', 'source-hashes.json');
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return; // not generated yet
  }
  const parsed = { ...emptyHashesFile(), sources: (JSON.parse(raw) as HashesFile).sources };
  // Tolerate a CRLF checkout on Windows; the serializer always emits LF.
  assert.equal(raw.replace(/\r\n/g, '\n'), serializeHashesFile(parsed));
});
