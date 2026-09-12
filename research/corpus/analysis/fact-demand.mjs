/**
 * What the 60 candidates ask of the fact vocabulary.
 *
 * Run: node research/corpus/analysis/fact-demand.mjs
 *
 * Produces the two tables docs/interview-roadmap.md cites in "What the corpus
 * asks for":
 *
 * 1. **Demand** -- how many candidates name each fact key. This is the number
 *    FINDINGS.md §2 reports, and on its own it over-rates a fact: a key named
 *    by ten candidates that never decides any of them buys nothing.
 * 2. **Pruning power** -- how many candidates a *negative* answer definitively
 *    rules out. A fact only shortens the results list if answering it can move
 *    a program out of "might qualify", and only a fact that sits on a
 *    necessary condition can do that. See docs/standing-decisions.md, "The
 *    words", for the distinction.
 */

import { factsIn, readCorpus } from './corpus.mjs';

/** Three-valued evaluation, matching src/engine/evaluate.ts: 1 / 0 / null. */
function evaluate(node, answers) {
  if (!node) return null;
  switch (node.kind) {
    case 'always':
      return 1;
    case 'manualReview':
      return null;
    case 'compare': {
      const value = answers[node.fact];
      if (value === undefined) return null;
      switch (node.op) {
        case 'eq': return value === node.value ? 1 : 0;
        case 'neq': return value !== node.value ? 1 : 0;
        case 'gte': return value >= node.value ? 1 : 0;
        case 'lte': return value <= node.value ? 1 : 0;
        case 'gt': return value > node.value ? 1 : 0;
        case 'lt': return value < node.value ? 1 : 0;
        default: return null;
      }
    }
    case 'set': {
      const value = answers[node.fact];
      if (value === undefined) return null;
      const held = Array.isArray(value) ? value : [value];
      switch (node.op) {
        case 'in': return node.values.includes(value) ? 1 : 0;
        case 'notIn': return node.values.includes(value) ? 0 : 1;
        case 'includesAny': return held.some((v) => node.values.includes(v)) ? 1 : 0;
        case 'includesAll': return node.values.every((v) => held.includes(v)) ? 1 : 0;
        case 'excludes': return held.some((v) => node.values.includes(v)) ? 0 : 1;
        default: return null;
      }
    }
    case 'incomeAtOrBelow':
      return null; // income is already asked; not what this script measures
    case 'allOf': {
      const results = node.of.map((c) => evaluate(c, answers));
      if (results.includes(0)) return 0;
      return results.every((r) => r === 1) ? 1 : null;
    }
    case 'anyOf': {
      const results = node.of.map((c) => evaluate(c, answers));
      if (results.includes(1)) return 1;
      return results.every((r) => r === 0) ? 0 : null;
    }
    case 'not': {
      const inner = evaluate(node.of, answers);
      return inner === null ? null : inner ? 0 : 1;
    }
    default:
      return null;
  }
}

const corpus = readCorpus();
console.log(`${corpus.length} candidates\n`);

// --- 1. Demand: who names what ---------------------------------------------

const demand = new Map();
for (const { id, doc } of corpus) {
  for (const entry of doc.rule?.factsNeeded ?? []) {
    if (!demand.has(entry.key)) demand.set(entry.key, []);
    demand.get(entry.key).push(id);
  }
}
const byDemand = [...demand].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
const shared = byDemand.filter(([, ids]) => ids.length >= 2);

console.log('=== DEMAND: factsNeeded keys named by more than one candidate ===');
for (const [key, ids] of shared) {
  console.log(String(ids.length).padStart(3), key, '::', ids.join(', '));
}
console.log(
  `\n${byDemand.length} distinct keys across ${[...demand.values()].reduce((n, v) => n + v.length, 0)} entries; ` +
    `${byDemand.length - shared.length} named by exactly one candidate.`,
);

// --- 2. Pruning power: whose "no" settles something -------------------------

const prunes = new Map();
for (const { id, doc } of corpus) {
  const rule = doc.rule?.eligibility;
  if (!rule) continue;
  for (const fact of factsIn(rule)) {
    if (evaluate(rule, { [fact]: false }) === 0) {
      if (!prunes.has(fact)) prunes.set(fact, []);
      prunes.get(fact).push(id);
    }
  }
}

console.log('\n=== PRUNING POWER: a "no" to this fact rules the candidate out outright ===');
const byPruning = [...prunes]
  .filter(([, ids]) => ids.length >= 2)
  .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
for (const [key, ids] of byPruning) {
  console.log(String(ids.length).padStart(3), key, '::', ids.join(', '));
}
console.log(
  `\n${prunes.size} facts prune at least one candidate; ` +
    `${[...prunes.values()].filter((v) => v.length === 1).length} prune exactly one.`,
);
