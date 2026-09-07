/**
 * Registers the module-resolution hook so a plain
 * `node scripts/agentic-extract/index.ts` can
 * `import { PROGRAMS } from '@/data/programs'` and reach the sibling
 * scripts/program-benchmark seam. Reuses scripts/check-sources's hook verbatim
 * (as scripts/ingest-descriptive and scripts/program-benchmark do) -- it
 * resolves the `@/*` alias and fills in the extensionless `src/` imports, and
 * there is no reason to keep a fourth copy.
 *
 * Used as `node --import ./scripts/agentic-extract/register.mjs ...` (see the
 * `extract:agentic` npm script).
 */
import { register } from 'node:module';

register('../check-sources/resolve-hook.mjs', import.meta.url);
