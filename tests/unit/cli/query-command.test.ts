import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('CLI query command', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  describe('JSON output', () => {
    it('prints JSON search results', async () => {
      // Mock Indexer for this test
      vi.doMock('../../../src/indexer/index.js', () => ({
        Indexer: class MockIndexer {
          constructor(_cfg: any) {}
          async initialize() {}
          async close() {}
          async searchSymbols(_q: string, _o: any) {
            return [
              {
                symbol: {
                  id: '1',
                  name: 'greet',
                  kind: 'function',
                  signature: 'function greet(): string',
                  filePath: '/tmp/x.ts',
                  line: 1,
                },
                score: 0.9,
                matches: [],
              },
            ];
          }
        },
      }));

      const { queryCommand } = await import('../../../src/cli/commands/query.js');
      await queryCommand.parseAsync(['node', 'query', 'greet', '--json'], { from: 'user' });

      const output = logSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(() => JSON.parse(output)).not.toThrow();
      expect(output).toContain('greet');
    });
  });

  describe('no results', () => {
    it('returns "No symbols found matching..." message when no results', async () => {
      vi.doMock('../../../src/indexer/index.js', () => ({
        Indexer: class MockIndexer {
          constructor(_cfg: any) {}
          async initialize() {}
          async close() {}
          async searchSymbols(_q: string, _o: any) {
            return [];
          }
        },
      }));

      const { queryCommand } = await import('../../../src/cli/commands/query.js');
      await queryCommand.parseAsync(['node', 'query', 'nonexistent'], { from: 'user' });

      const output = logSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(output).toContain('No symbols found matching');
    });
  });

  describe('human-readable output', () => {
    it('formats results in human-readable format', async () => {
      vi.doMock('../../../src/indexer/index.js', () => ({
        Indexer: class MockIndexer {
          constructor(_cfg: any) {}
          async initialize() {}
          async close() {}
          async searchSymbols(_q: string, _o: any) {
            return [
              {
                symbol: {
                  id: '1',
                  name: 'greet',
                  kind: 'function',
                  signature: 'function greet(): string',
                  filePath: '/tmp/x.ts',
                  line: 1,
                },
                score: 0.9,
                matches: [],
              },
            ];
          }
        },
      }));

      const { queryCommand } = await import('../../../src/cli/commands/query.js');
      await queryCommand.parseAsync(['node', 'query', 'greet'], { from: 'user' });

      const output = logSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(output).toContain('Found');
      expect(output).toContain('greet');
      expect(output).toContain('function');
    });
  });

  describe('error handling', () => {
    it('handles indexer errors and exits with code 1', async () => {
      vi.doMock('../../../src/indexer/index.js', () => ({
        Indexer: class MockIndexer {
          constructor(_cfg: any) {}
          async initialize() {
            throw new Error('Mock initialization error');
          }
          async close() {}
          async searchSymbols(_q: string, _o: any) {
            return [];
          }
        },
      }));

      const { queryCommand } = await import('../../../src/cli/commands/query.js');
      await queryCommand.parseAsync(['node', 'query', 'test'], { from: 'user' });

      const errorOutput = errorSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(errorOutput).toContain('Error');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
