import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Tests run in node by default. A test that renders DOM opts into jsdom with a
 * `// @vitest-environment jsdom` docblock, so the thousands of engine tests do
 * not pay for a DOM they never touch. Kept apart from `vite.config.ts`, whose
 * build-only plugins have no business in a test run.
 */
export default defineConfig({
  plugins: [react()],
  // The build bakes template covers into this module; tests draw them live, as dev does.
  resolve: { alias: { 'virtual:template-covers': fileURLToPath(new URL('./src/components/home/noBakedCovers.ts', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'api/**/*.test.ts'],
  },
});
