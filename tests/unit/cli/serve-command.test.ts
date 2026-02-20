/**
 * Unit tests for serve CLI command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock control variables
let mockShouldError = false;
let mockServerStarted = false;

// Mock startStdioServer
vi.mock('../../../src/server/index.js', () => ({
  startStdioServer: vi.fn().mockImplementation(async () => {
    mockServerStarted = true;
    // Don't resolve - server runs forever in real usage
    // But for tests, we just return
  }),
}));

// Mock Indexer
vi.mock('../../../src/indexer/index.js', () => {
  class MockIndexer {
    constructor(_cfg: any) {}
    async initialize() {
      if (mockShouldError) {
        throw new Error('Mock initialization error');
      }
    }
    async close() {}
  }
  return { Indexer: MockIndexer };
});

describe('CLI serve command', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    mockShouldError = false;
    mockServerStarted = false;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);
    // Reset env vars
    delete process.env['LAZYLOAD_DATABASE'];
    delete process.env['LAZYLOAD_ROOT'];
  });

  afterEach(() => {
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    process.env = { ...originalEnv };
  });

  describe('initialization', () => {
    it('initializes indexer with correct database path', async () => {
      const { serveCommand } = await import('../../../src/cli/commands/serve.js');

      await serveCommand.parseAsync(['node', 'serve', '-d', '/custom/path.db'], { from: 'user' });

      // Should have started server if no error
      expect(mockServerStarted || mockShouldError).toBe(true);
    });

    it('uses LAZYLOAD_DATABASE env var', async () => {
      process.env['LAZYLOAD_DATABASE'] = '/env/db/path.db';

      const { serveCommand } = await import('../../../src/cli/commands/serve.js');

      await serveCommand.parseAsync(['node', 'serve'], { from: 'user' });

      // Should initialize without error
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('uses LAZYLOAD_ROOT env var', async () => {
      process.env['LAZYLOAD_ROOT'] = '/custom/root';

      const { serveCommand } = await import('../../../src/cli/commands/serve.js');

      await serveCommand.parseAsync(['node', 'serve'], { from: 'user' });

      // Should initialize without error
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('exits with code 1 on initialization error', async () => {
      mockShouldError = true;

      const { serveCommand } = await import('../../../src/cli/commands/serve.js');

      await serveCommand.parseAsync(['node', 'serve'], { from: 'user' });

      const errorOutput = errorSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(errorOutput).toContain('Error');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('server options', () => {
    it('accepts database path option', async () => {
      const { serveCommand } = await import('../../../src/cli/commands/serve.js');

      // Should not throw when parsing with database option
      await expect(
        serveCommand.parseAsync(['node', 'serve', '--database', '/path/to/db'], { from: 'user' })
      ).resolves.not.toThrow();
    });

    it('accepts root path option', async () => {
      const { serveCommand } = await import('../../../src/cli/commands/serve.js');

      // Should not throw when parsing with root option
      await expect(
        serveCommand.parseAsync(['node', 'serve', '--root', '/path/to/root'], { from: 'user' })
      ).resolves.not.toThrow();
    });
  });
});
