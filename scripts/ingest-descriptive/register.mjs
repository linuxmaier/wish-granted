/**
 * Registers the module-resolution hook so a plain `node scripts/ingest-descriptive/index.ts`
 * can `import { PROGRAMS } from '@/data/programs'`. Reuses scripts/check-sources's
 * hook verbatim -- it already resolves the `@/*` alias and fills in extensionless
 * `src/` imports, and there is no reason to keep a second copy.
 *
 * Used as `node --import ./scripts/ingest-descriptive/register.mjs ...` (see the
 * `ingest:descriptive` npm script). A hook must load on its own thread via
 * `register()`, which is why this is its own one-line file.
 */
import { register } from 'node:module';

register('../check-sources/resolve-hook.mjs', import.meta.url);
