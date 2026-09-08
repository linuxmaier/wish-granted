/**
 * Registers the shared module-resolution hook so a plain
 * `node scripts/triage/index.ts` can `import { PROGRAMS } from '@/data/programs'`
 * and reach the sibling scripts/tier3-extract, scripts/cross-check,
 * scripts/check-sources and scripts/agentic-extract seams. Reuses
 * scripts/check-sources's hook verbatim, exactly as the other pipeline scripts
 * do -- it resolves the `@/*` alias and the extensionless `src/` imports.
 *
 * Used as `node --import ./scripts/triage/register.mjs ...` (see the
 * `extract:triage` npm script).
 */
import { register } from 'node:module';

register('../check-sources/resolve-hook.mjs', import.meta.url);
