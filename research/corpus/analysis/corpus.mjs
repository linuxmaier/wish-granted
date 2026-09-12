/**
 * Reads the candidate corpus. Shared by the analysis scripts beside this file.
 *
 * Parses the .json5 candidates without a JSON5 dependency: the only JSON5
 * features the corpus uses are comments, in both `//` and block form (see
 * ../README.md), so stripping them while tracking string state is enough.
 * `json5` is present in node_modules only as a transitive dependency of
 * something else; depending on it here would be depending on an accident.
 *
 * A trailing comma is stripped too. ../README.md says nothing relies on them,
 * and that is true of the hand-written text -- but removing a comment that was
 * the last thing inside an object can leave the comma before it dangling, so
 * the stripper has to tidy up after itself.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CORPUS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Strips `//` line comments, leaving anything inside a string literal alone. */
export function stripComments(text) {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    // A `//` outside a string starts a comment. This is the case a naive
    // regex gets wrong: every candidate is full of `https://` URLs, and they
    // are all inside strings, which the branch above has already consumed.
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }

    if (ch === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 1;
      out += '\n';
      continue;
    }

    out += ch;
  }

  // Only ever a comma whose next non-whitespace character closes the
  // container, so this cannot join two values or drop a real one.
  return out.replace(/,(\s*[}\]])/g, '$1');
}

/** Every candidate, as `{ id, doc }`, sorted by id. */
export function readCorpus() {
  return fs
    .readdirSync(CORPUS_DIR)
    .filter((f) => f.endsWith('.json5'))
    .sort()
    .map((file) => {
      const raw = fs.readFileSync(path.join(CORPUS_DIR, file), 'utf8');
      try {
        return { id: file.replace('.json5', ''), doc: JSON.parse(stripComments(raw)) };
      } catch (cause) {
        throw new Error(`${file} did not parse after comment stripping: ${cause.message}`);
      }
    });
}

/** Every fact key a candidate's encoded rule consults. */
export function factsIn(node, out = new Set()) {
  if (!node || typeof node !== 'object') return out;
  if (node.fact) out.add(node.fact);
  if (node.kind === 'incomeAtOrBelow') {
    out.add('annualHouseholdIncome');
    out.add('householdSize');
  }
  const children = node.of ? (Array.isArray(node.of) ? node.of : [node.of]) : [];
  for (const child of children) factsIn(child, out);
  return out;
}
