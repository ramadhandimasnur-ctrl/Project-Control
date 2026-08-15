import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      // Services import `server-only`, which throws outside a React Server
      // Component graph. Aliasing it to an empty module lets tests reach the
      // service layer while the guard stays in force for the real build.
      'server-only': fileURLToPath(new URL('./src/test/server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    globals: false,
    // Integration tests talk to a hosted database; a single import performs
    // several round trips. Unit tests are unaffected — they finish in
    // milliseconds either way.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    include: ['src/**/__tests__/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['node_modules/**', 'legacy/**', 'tests/e2e/**', '.next/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      // Charter section 8: lib/calc must stay at 90%+.
      include: ['src/lib/calc/**/*.ts'],
      exclude: ['src/lib/calc/**/__tests__/**'],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
  },
});
