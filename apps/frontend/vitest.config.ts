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
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'api/**/*.test.ts'],
  },
});
