/**
 * Vitest setup file
 * This file runs before each test file
 */

import { beforeAll, afterAll } from 'vitest';
import { resetRegistry } from '../src/indexer/parsers/registry.js';

// Reset the singleton parser registry before tests
beforeAll(() => {
  resetRegistry();
});

// Clean up after all tests
afterAll(() => {
  resetRegistry();
});

// Increase default timeout for slow tests
if (process.env.CI) {
  // Longer timeouts in CI environment
  beforeAll(() => {
    vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
  });
}
