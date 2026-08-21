/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Static build. No server runtime and no API routes: the whole app -- the
// interview, the rules engine, and the program dataset -- ships to the browser
// and runs there. See docs/design.md, "Privacy architecture".
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
  test: {
    // Engine and data tests are pure functions and run fastest in node; the UI
    // smoke test opts into jsdom with a per-file docblock.
    environment: 'node',
    // scripts/llm-extraction's own harness test lives next to the code it
    // tests, not under tests/ -- see that file's own docblock for why. Scoped
    // to that one directory deliberately: scripts/refresh-income-tables (#24)
    // has its own *.test.ts files too, written for Node's built-in test
    // runner (`npm run test:refresh-income-tables`), not vitest -- a broader
    // `scripts/**/*.test.ts` glob would sweep those in and vitest would
    // reject them ("No test suite found") since they don't use describe/it.
    include: ['tests/**/*.test.{ts,tsx}', 'scripts/llm-extraction/**/*.test.ts'],
  },
});
