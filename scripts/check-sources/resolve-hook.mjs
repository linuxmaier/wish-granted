/**
 * A module-resolution hook so a plain `node scripts/check-sources/index.ts`
 * can `import { PROGRAMS, stalePrograms } from '@/data/programs'` -- the same
 * import the app and the vitest suite use.
 *
 * Two things stand between a Node-run script and the `src/` tree:
 *
 *   1. `@/*` is a tsconfig/vite path alias Node knows nothing about.
 *   2. Files under `src/` use extensionless relative imports (`./facts`),
 *      because Vite resolves them; Node's ESM resolver requires the extension.
 *
 * refresh-income-tables (#6) sidesteps both by reading income-tables.ts as
 * text. This script genuinely needs the evaluated `PROGRAMS` array -- the real
 * ids, the real `source.url`s, and the real `stalePrograms()` helper #7 asks to
 * wire up -- so it resolves the alias and fills in extensions instead. Zero
 * dependencies: this is a built-in `node:module` customization hook.
 *
 * This is the ONLY direction that is allowed: scripts/ may read src/, never the
 * reverse (see docs/design.md). Nothing here runs in, or changes, the browser
 * bundle.
 */
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = new URL('../../src/', import.meta.url).href;

function isFile(url) {
  try {
    return statSync(fileURLToPath(url)).isFile();
  } catch {
    return false;
  }
}

/** Try `<path>.ts`, `.tsx`, `/index.ts`, then the literal path. */
function withExtension(url) {
  for (const candidate of [url + '.ts', url + '.tsx', url + '/index.ts', url]) {
    if (isFile(candidate)) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@' || specifier.startsWith('@/')) {
    const rest = specifier === '@' ? '' : specifier.slice(2);
    const resolved = withExtension(new URL(rest, SRC).href);
    if (resolved) return { url: resolved, shortCircuit: true };
  }

  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    // Extensionless relative import from a file we already pulled in from src/.
    if (context.parentURL && (specifier.startsWith('./') || specifier.startsWith('../'))) {
      const resolved = withExtension(new URL(specifier, context.parentURL).href);
      if (resolved) return { url: resolved, shortCircuit: true };
    }
    throw err;
  }
}
