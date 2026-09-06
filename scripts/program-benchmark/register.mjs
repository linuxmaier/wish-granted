/**
 * Registers the module-resolution hook so a plain
 * `node scripts/program-benchmark/index.ts` can
 * `import { PROGRAMS } from '@/data/programs'`. Reuses scripts/check-sources's
 * hook verbatim (as scripts/ingest-descriptive does) -- it resolves the `@/*`
 * alias and fills in the extensionless `src/` imports, and there is no reason
 * to keep a third copy.
 *
 * Used as `node --import ./scripts/program-benchmark/register.mjs ...` (see the
 * `eval:program-extraction` npm script).
 */
import { register } from 'node:module';

register('../check-sources/resolve-hook.mjs', import.meta.url);
