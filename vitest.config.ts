import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/types/**'],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },
    testTimeout: 15000,
    hookTimeout: 15000,
    pool: 'forks',
    // Stabilize watcher-heavy suites on systems with lower open-file limits.
    maxWorkers: 2,
    setupFiles: ['./tests/vitest.setup.ts'],
    sequence: {
      shuffle: false,
    },
  },
});
