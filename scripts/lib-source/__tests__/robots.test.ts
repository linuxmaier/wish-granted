import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseRobots, isAllowed, isHardDenied } from '../robots.ts';

test('null rules (no robots.txt) means allowed', () => {
  assert.equal(isAllowed(null, '/anything'), true);
});

test('empty Disallow means allow everything', () => {
  const r = parseRobots('User-agent: *\nDisallow:');
  assert.equal(isAllowed(r, '/admin/secret'), true);
});

test('Disallow on the catch-all agent blocks a matching path', () => {
  const r = parseRobots('User-agent: *\nDisallow: /admin/\nDisallow: /private');
  assert.equal(isAllowed(r, '/admin/users'), false);
  assert.equal(isAllowed(r, '/private-notes'), false);
  assert.equal(isAllowed(r, '/foodshare/index.htm'), true);
});

test('a scoped Allow beats a shorter Disallow (longest match wins)', () => {
  const r = parseRobots('User-agent: *\nDisallow: /docs/\nAllow: /docs/public/');
  assert.equal(isAllowed(r, '/docs/private'), false);
  assert.equal(isAllowed(r, '/docs/public/guide'), true);
});

test('Allow wins an exact-length tie with Disallow', () => {
  const r = parseRobots('User-agent: *\nDisallow: /x/\nAllow: /x/');
  assert.equal(isAllowed(r, '/x/y'), true);
});

test('rules for a named bot do not apply to the generic agent', () => {
  const r = parseRobots('User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin/');
  assert.equal(isAllowed(r, '/anything'), true);
  assert.equal(isAllowed(r, '/admin/x'), false);
});

test('findhelp.org-shaped file: catch-all Disallow: / blocks everything', () => {
  const r = parseRobots('User-agent: Googlebot\nAllow: /\n\nUser-agent: *\nCrawl-delay: 1\nDisallow: /');
  assert.equal(isAllowed(r, '/search'), false);
  assert.equal(isAllowed(r, '/'), false);
});

test('comments and blank lines are ignored', () => {
  const r = parseRobots('# hello\nUser-agent: *\n\n  Disallow: /admin/  # trailing comment\n');
  assert.equal(isAllowed(r, '/admin/x'), false);
});

test('hard-deny list is independent of robots.txt', () => {
  assert.equal(isHardDenied('www.findhelp.org'), true);
  assert.equal(isHardDenied('211wisconsin.communityos.org'), true);
  assert.equal(isHardDenied('www.dhs.wisconsin.gov'), false);
});
