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
    // tests, not under tests/ -- see that file's own docblock for why (it
    // keeps a TS-extension requirement scoped to scripts/tsconfig.json
    // instead of the root tsconfig).
    include: ['tests/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
  },
});
