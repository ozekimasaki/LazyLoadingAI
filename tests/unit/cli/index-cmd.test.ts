/**
 * Unit tests for index CLI command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock control variables
let mockShouldError = false;
let mockIndexResult = {
  totalFiles: 10,
  indexedFiles: 8,
  skippedFiles: 2,
  errors: [] as Array<{ file: string; error: string }>,
  durationMs: 150,
};

// Mock config loader
vi.mock('../../../src/config/loader.js', () => ({
  loadConfig: vi.fn().mockRejectedValue(new Error('No config')),
  getDefaultConfig: vi.fn().mockReturnValue({
    include: ['**/*.ts'],
    exclude: ['**/node_modules/**'],
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
    async indexDirectory() {
      return mockIndexResult;
    }
    async getStats() {
      return {
        totalFiles: 10,
        totalSymbols: 50,
        byLanguage: {
          typescript: { files: 8, functions: 30, classes: 10, interfaces: 5, typeAliases: 3, variables: 2 },
          javascript: { files: 0, functions: 0, classes: 0, interfaces: 0, typeAliases: 0, variables: 0 },
          python: { files: 0, functions: 0, classes: 0, interfaces: 0, typeAliases: 0, variables: 0 },
        },
        indexingDurationMs: 150,
      };
    }
  }
  return { Indexer: MockIndexer };
});

describe('CLI index command', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockShouldError = false;
    mockIndexResult = {
      totalFiles: 10,
      indexedFiles: 8,
      skippedFiles: 2,
      errors: [],
      durationMs: 150,
    };
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  describe('successful indexing', () => {
    it('shows completion message', async () => {
      const { indexCommand } = await import('../../../src/cli/commands/index-cmd.js');

      await indexCommand.parseAsync(['node', 'index', '.'], { from: 'user' });

      const output = logSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(output).toContain('Indexing complete');
    });

    it('shows file count and duration', async () => {
      const { indexCommand } = await import('../../../src/cli/commands/index-cmd.js');

      await indexCommand.parseAsync(['node', 'index', '.'], { from: 'user' });

      const output = logSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(output).toContain('Total files:');
      expect(output).toContain('Indexed:');
      expect(output).toContain('Skipped:');
      expect(output).toContain('Duration:');
    });

    it('shows stats after indexing', async () => {
      const { indexCommand } = await import('../../../src/cli/commands/index-cmd.js');

      await indexCommand.parseAsync(['node', 'index', '.'], { from: 'user' });

      const output = logSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(output).toContain('Index statistics');
      expect(output).toContain('Total symbols:');
    });
  });

  describe('verbose mode', () => {
    it('shows individual errors in verbose mode', async () => {
      mockIndexResult = {
        ...mockIndexResult,
        errors: [
          { file: '/path/to/error.ts', error: 'Parse error' },
        ],
      };

      const { indexCommand } = await import('../../../src/cli/commands/index-cmd.js');

      await indexCommand.parseAsync(['node', 'index', '.', '--verbose'], { from: 'user' });

      const output = logSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(output).toContain('Errors:');
      expect(output).toContain('error.ts');
    });
  });

  describe('error handling', () => {
    it('handles errors and exits with code 1', async () => {
      mockShouldError = true;

      const { indexCommand } = await import('../../../src/cli/commands/index-cmd.js');

      await indexCommand.parseAsync(['node', 'index', '.'], { from: 'user' });

      const errorOutput = errorSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(errorOutput).toContain('Error');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('custom output path', () => {
    it('accepts custom output path option', async () => {
      const { indexCommand } = await import('../../../src/cli/commands/index-cmd.js');

      await indexCommand.parseAsync(['node', 'index', '.', '-o', 'custom/path.db'], { from: 'user' });

      const output = logSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(output).toContain('Database:');
      expect(output).toContain('custom/path.db');
    });
  });
});
