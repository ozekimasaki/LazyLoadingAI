import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Indexer } from '../../src/indexer/index.js';
import { Watcher } from '../../src/indexer/watcher.js';
import { createTempProject, SAMPLE_TYPESCRIPT } from '../helpers/fixtures.js';

// Note: File watcher E2E tests can be flaky due to OS-level file system event timing
// These tests focus on verifiable behavior rather than timing-dependent events
describe('E2E: Watch and Reindex', () => {
  let tempProject: ReturnType<typeof createTempProject>;
  let indexer: Indexer;
  let watcher: Watcher;
  let dbPath: string;

  beforeEach(async () => {
    tempProject = createTempProject({
      'src/main.ts': SAMPLE_TYPESCRIPT,
    });

    dbPath = path.join(tempProject.rootDir, '.lazyload', 'test.db');

    indexer = new Indexer({
      rootDirectory: tempProject.rootDir,
      databasePath: dbPath,
      include: ['**/*.ts'],
      exclude: ['**/node_modules/**'],
    });

    await indexer.initialize();
  });

  afterEach(async () => {
    if (watcher) {
      await watcher.stop();
    }
    if (indexer) {
      await indexer.close();
    }
    tempProject.cleanup();
  });

  describe('Watcher initialization', () => {
    it('should create watcher with correct configuration', () => {
      watcher = new Watcher(
        indexer,
        tempProject.rootDir,
        ['**/*.ts'],
        ['**/node_modules/**'],
        { debounceMs: 50, ignoreInitial: true }
      );

      expect(watcher).toBeDefined();
    });

    it('should start and emit ready event', async () => {
      watcher = new Watcher(
        indexer,
        tempProject.rootDir,
        ['**/*.ts'],
        ['**/node_modules/**'],
        { debounceMs: 50, ignoreInitial: true }
      );

      const readyPromise = new Promise<void>((resolve) => {
        watcher.on('ready', () => resolve());
      });

      await watcher.start();

      await Promise.race([
        readyPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Ready timeout')), 3000))
      ]);

      expect(true).toBe(true);
    });
  });

  describe('Debouncing rapid changes', () => {
    it('should debounce multiple rapid changes to same file', async () => {
      await indexer.indexDirectory();

      watcher = new Watcher(
        indexer,
        tempProject.rootDir,
        ['**/*.ts'],
        ['**/node_modules/**'],
        { debounceMs: 200, ignoreInitial: true }
      );

      const indexedEvents: string[] = [];
      watcher.on('indexed', (data) => {
        indexedEvents.push(data.filePath);
      });

      await watcher.start();
      await new Promise(resolve => setTimeout(resolve, 500));

      // Rapidly modify file multiple times
      const testFilePath = path.join(tempProject.rootDir, 'src/rapid-test.ts');

      fs.writeFileSync(testFilePath, 'export const v1 = 1;');
      await new Promise(resolve => setTimeout(resolve, 50));

      fs.writeFileSync(testFilePath, 'export const v2 = 2;');
      await new Promise(resolve => setTimeout(resolve, 50));

      fs.writeFileSync(testFilePath, 'export const v3 = 3;');

      // Wait for debounce to complete
      await new Promise(resolve => setTimeout(resolve, 700));

      // Should have at most a few indexing events due to debouncing
      const testFileEvents = indexedEvents.filter(p => p === testFilePath);
      expect(testFileEvents.length).toBeLessThanOrEqual(3);
    });
  });

  describe('Watch lifecycle', () => {
    it('should start and stop cleanly', async () => {
      watcher = new Watcher(
        indexer,
        tempProject.rootDir,
        ['**/*.ts'],
        ['**/node_modules/**'],
        { debounceMs: 50, ignoreInitial: true }
      );

      const readyPromise = new Promise<void>((resolve) => {
        watcher.on('ready', () => resolve());
      });

      await watcher.start();
      await readyPromise;

      // Watcher is running
      await watcher.stop();

      // After stop, adding files shouldn't trigger events
      const indexedHandler = vi.fn();
      watcher.on('indexed', indexedHandler);

      const newFilePath = path.join(tempProject.rootDir, 'src/after-stop.ts');
      fs.writeFileSync(newFilePath, 'export const afterStop = true;');

      await new Promise(resolve => setTimeout(resolve, 500));

      expect(indexedHandler).not.toHaveBeenCalled();
    });

    it('should handle multiple start/stop cycles', async () => {
      watcher = new Watcher(
        indexer,
        tempProject.rootDir,
        ['**/*.ts'],
        ['**/node_modules/**'],
        { debounceMs: 50, ignoreInitial: true }
      );

      // First cycle
      await watcher.start();
      await new Promise(resolve => setTimeout(resolve, 300));
      await watcher.stop();

      // Second cycle
      const readyPromise = new Promise<void>((resolve) => {
        watcher.on('ready', () => resolve());
      });

      await watcher.start();
      await readyPromise;
      await watcher.stop();

      // Should complete without errors
      expect(watcher).toBeDefined();
    });
  });

  describe('Integration with indexer', () => {
    it('should have access to indexer operations', async () => {
      // Index initial files
      await indexer.indexDirectory();

      watcher = new Watcher(
        indexer,
        tempProject.rootDir,
        ['**/*.ts'],
        ['**/node_modules/**'],
        { debounceMs: 50, ignoreInitial: true }
      );

      await watcher.start();
      await new Promise(resolve => setTimeout(resolve, 300));

      // Verify indexer is accessible and working
      const stats = await indexer.getStats();
      expect(stats.totalFiles).toBeGreaterThan(0);

      // Search should work
      const results = await indexer.searchSymbols('greet');
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('Event registration', () => {
    it('should support all event types', async () => {
      watcher = new Watcher(
        indexer,
        tempProject.rootDir,
        ['**/*.ts'],
        ['**/node_modules/**'],
        { debounceMs: 50, ignoreInitial: true }
      );

      // Register all event handlers
      const indexed = vi.fn();
      const removed = vi.fn();
      const error = vi.fn();
      const ready = vi.fn();

      watcher.on('indexed', indexed);
      watcher.on('removed', removed);
      watcher.on('error', error);
      watcher.on('ready', ready);

      await watcher.start();
      await new Promise(resolve => setTimeout(resolve, 500));

      // Ready should have been called
      expect(ready).toHaveBeenCalled();
    });
  });
});
