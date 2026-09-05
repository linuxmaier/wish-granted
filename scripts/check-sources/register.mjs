/**
 * Registers ./resolve-hook.mjs as a module-resolution customization hook.
 * Used as `node --import ./scripts/check-sources/register.mjs ...` (see the
 * `check:sources` npm script). A hook has to load on its own thread via
 * `register()`, which is why this is a separate one-line file from the hook
 * itself.
 */
import { register } from 'node:module';

register('./resolve-hook.mjs', import.meta.url);
