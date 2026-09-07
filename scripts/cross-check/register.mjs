/**
 * Registers the shared module-resolution hook so a plain
 * `node scripts/cross-check/index.ts` can `import { PROGRAMS } from
 * '@/data/programs'` and reach the sibling scripts/program-benchmark and
 * scripts/agentic-extract seams. Reuses scripts/check-sources's hook verbatim,
 * exactly as scripts/program-benchmark and scripts/agentic-extract do -- it
 * resolves the `@/*` alias and the extensionless `src/` imports.
 *
 * Used as `node --import ./scripts/cross-check/register.mjs ...` (see the
 * `extract:cross-check` npm script).
 */
import { register } from 'node:module';

register('../check-sources/resolve-hook.mjs', import.meta.url);
