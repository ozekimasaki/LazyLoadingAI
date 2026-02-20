import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';

describe('CLI stats command', () => {
  const origExists = fs.existsSync;
  const origStatSync = fs.statSync;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    (fs.existsSync as any) = origExists;
    (fs.statSync as any) = origStatSync;
    exitSpy.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  describe('missing database', () => {
    it('prints error and exits when database missing', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);

      const { statsCommand } = await import('../../../src/cli/commands/stats.js');
      await statsCommand.parseAsync(['node', 'stats'], { from: 'user' });

      const printed = errorSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(printed).toMatch(/Database not found/i);
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('JSON output', () => {
    it('outputs valid JSON structure', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'statSync').mockReturnValue({ size: 102400 } as any);

      vi.doMock('../../../src/indexer/index.js', () => ({
        Indexer: class MockIndexer {
          constructor(_cfg: any) {}
          async initialize() {}
          async close() {}
          async getStats() {
            return {
              totalFiles: 10,
              totalSymbols: 50,
              byLanguage: {
                typescript: { files: 8, functions: 30, classes: 10, interfaces: 5, typeAliases: 3, variables: 2 },
                javascript: { files: 2, functions: 5, classes: 2, interfaces: 0, typeAliases: 0, variables: 3 },
                python: { files: 0, functions: 0, classes: 0, interfaces: 0, typeAliases: 0, variables: 0 },
              },
              indexingDurationMs: 150,
            };
          }
        },
      }));

      const { statsCommand } = await import('../../../src/cli/commands/stats.js');
      await statsCommand.parseAsync(['node', 'stats', '--json'], { from: 'user' });

      const output = logSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(() => JSON.parse(output)).not.toThrow();

      const parsed = JSON.parse(output);
      expect(parsed).toHaveProperty('totalFiles');
      expect(parsed).toHaveProperty('totalSymbols');
      expect(parsed).toHaveProperty('byLanguage');
    });
  });

  describe('human-readable output', () => {
    it('displays per-language statistics', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'statSync').mockReturnValue({ size: 102400 } as any);

      vi.doMock('../../../src/indexer/index.js', () => ({
        Indexer: class MockIndexer {
          constructor(_cfg: any) {}
          async initialize() {}
          async close() {}
          async getStats() {
            return {
              totalFiles: 10,
              totalSymbols: 50,
              byLanguage: {
                typescript: { files: 8, functions: 30, classes: 10, interfaces: 5, typeAliases: 3, variables: 2 },
                javascript: { files: 2, functions: 5, classes: 2, interfaces: 0, typeAliases: 0, variables: 3 },
                python: { files: 0, functions: 0, classes: 0, interfaces: 0, typeAliases: 0, variables: 0 },
              },
              indexingDurationMs: 150,
            };
          }
        },
      }));

      const { statsCommand } = await import('../../../src/cli/commands/stats.js');
      await statsCommand.parseAsync(['node', 'stats'], { from: 'user' });

      const output = logSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(output).toContain('Index Statistics');
      expect(output).toContain('Total Files:');
      expect(output).toContain('Total Symbols:');
      expect(output).toContain('By Language:');
      expect(output).toContain('Typescript');
    });

    it('displays database size', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'statSync').mockReturnValue({ size: 102400 } as any);

      vi.doMock('../../../src/indexer/index.js', () => ({
        Indexer: class MockIndexer {
          constructor(_cfg: any) {}
          async initialize() {}
          async close() {}
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
        },
      }));

      const { statsCommand } = await import('../../../src/cli/commands/stats.js');
      await statsCommand.parseAsync(['node', 'stats'], { from: 'user' });

      const output = logSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(output).toContain('Database Size:');
      expect(output).toContain('KB');
    });
  });
});
