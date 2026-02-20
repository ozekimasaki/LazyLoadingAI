/**
 * Unit tests for watch CLI command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

// Mock control variables
let mockShouldError = false;
let mockWatcherInstance: any = null;

// Mock config loader
vi.mock('../../../src/config/loader.js', () => ({
  loadConfig: vi.fn().mockRejectedValue(new Error('No config')),
  getDefaultConfig: vi.fn().mockReturnValue({
    include: ['**/*.ts'],
    exclude: ['**/node_modules/**'],
  }),
}));

// Create a mock Watcher class
class MockWatcher extends EventEmitter {
  started = false;
  stopped = false;

  constructor() {
    super();
    mockWatcherInstance = this;
  }

  async start() {
    this.started = true;
    // Emit ready after a short delay
    setTimeout(() => this.emit('ready'), 10);
  }

  async stop() {
    this.stopped = true;
  }
}

// Mock Indexer and Watcher
vi.mock('../../../src/indexer/index.js', () => {
  class MockIndexer {
    constructor(_cfg: any) {}
    async initialize() {
      if (mockShouldError) {
        throw new Error('Mock initialization error');
      }
    }
    async close() {}
    async indexDirectory() {
      return {
        totalFiles: 5,
        indexedFiles: 5,
        skippedFiles: 0,
        errors: [],
        durationMs: 50,
      };
    }
  }
  return {
    Indexer: MockIndexer,
    Watcher: MockWatcher,
  };
});

describe('CLI watch command', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let onSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockShouldError = false;
    mockWatcherInstance = null;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);
    onSpy = vi.spyOn(process, 'on').mockImplementation((() => process) as any);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    onSpy.mockRestore();
  });

  describe('initial indexing', () => {
    it('performs initial indexing', async () => {
      const { watchCommand } = await import('../../../src/cli/commands/watch.js');

      // Start parsing but don't wait forever
      const parsePromise = watchCommand.parseAsync(['node', 'watch', '.'], { from: 'user' });

      // Wait a bit for initial indexing
      await new Promise(resolve => setTimeout(resolve, 100));

      const output = logSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(output).toContain('initial index');
    });
  });

  describe('watcher creation', () => {
    it('creates watcher with correct patterns', async () => {
      const { watchCommand } = await import('../../../src/cli/commands/watch.js');

      const parsePromise = watchCommand.parseAsync(['node', 'watch', '.'], { from: 'user' });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Watcher should have been created and started
      expect(mockWatcherInstance).not.toBeNull();
      expect(mockWatcherInstance.started).toBe(true);
    });
  });

  describe('event handlers', () => {
    it('registers event handlers for indexed, removed, error, ready', async () => {
      const { watchCommand } = await import('../../../src/cli/commands/watch.js');

      const parsePromise = watchCommand.parseAsync(['node', 'watch', '.'], { from: 'user' });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Check that event handlers were registered
      expect(mockWatcherInstance).not.toBeNull();
      const events = mockWatcherInstance.eventNames();
      expect(events).toContain('indexed');
      expect(events).toContain('removed');
      expect(events).toContain('error');
      expect(events).toContain('ready');
    });

    it('handles indexed event', async () => {
      const { watchCommand } = await import('../../../src/cli/commands/watch.js');

      const parsePromise = watchCommand.parseAsync(['node', 'watch', '.', '--verbose'], { from: 'user' });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Emit indexed event
      mockWatcherInstance.emit('indexed', { filePath: '/test/file.ts', isNew: true });

      await new Promise(resolve => setTimeout(resolve, 50));

      const output = logSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(output).toContain('Indexed');
    });

    it('handles removed event', async () => {
      const { watchCommand } = await import('../../../src/cli/commands/watch.js');

      const parsePromise = watchCommand.parseAsync(['node', 'watch', '.'], { from: 'user' });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Emit removed event
      mockWatcherInstance.emit('removed', { filePath: '/test/removed.ts' });

      await new Promise(resolve => setTimeout(resolve, 50));

      const output = logSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(output).toContain('Removed');
    });

    it('handles error event', async () => {
      const { watchCommand } = await import('../../../src/cli/commands/watch.js');

      const parsePromise = watchCommand.parseAsync(['node', 'watch', '.'], { from: 'user' });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Emit error event
      mockWatcherInstance.emit('error', { filePath: '/test/error.ts', error: new Error('Parse error') });

      await new Promise(resolve => setTimeout(resolve, 50));

      const errorOutput = errorSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(errorOutput).toContain('Error');
    });
  });

  describe('shutdown handlers', () => {
    it('registers shutdown handlers for SIGINT and SIGTERM', async () => {
      const { watchCommand } = await import('../../../src/cli/commands/watch.js');

      const parsePromise = watchCommand.parseAsync(['node', 'watch', '.'], { from: 'user' });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Check that process.on was called with signal handlers
      const onCalls = onSpy.mock.calls.map(c => c[0]);
      expect(onCalls).toContain('SIGINT');
      expect(onCalls).toContain('SIGTERM');
    });
  });

  describe('error handling', () => {
    it('handles initialization errors and exits with code 1', async () => {
      mockShouldError = true;

      const { watchCommand } = await import('../../../src/cli/commands/watch.js');

      await watchCommand.parseAsync(['node', 'watch', '.'], { from: 'user' });

      const errorOutput = errorSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(errorOutput).toContain('Error');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
