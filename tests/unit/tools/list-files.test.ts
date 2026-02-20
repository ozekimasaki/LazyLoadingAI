/**
 * Unit tests for list-files tool
 */

import { describe, it, expect } from 'vitest';
import { listFilesTool } from '../../../src/server/tools/list-files.js';
import {
  createTestFileIndex,
  createTestFunctionSignature,
  createTestClassSignature,
} from '../../helpers/database.js';
import type { FileIndex } from '../../../src/types/index.js';

/**
 * Create a mock indexer with customizable listFiles response
 */
function createMockIndexer(files: FileIndex[]) {
  return {
    async listFiles(options?: { directory?: string; language?: string }) {
      let result = files;
      if (options?.directory) {
        result = result.filter(f => f.relativePath.startsWith(options.directory!));
      }
      if (options?.language) {
        result = result.filter(f => f.language === options.language);
      }
      return result;
    },
  };
}


async function runListFiles(indexer: any, input: Record<string, unknown> = {}) {
  return listFilesTool(indexer, { format: 'markdown', ...input } as any);
}

describe('listFilesTool', () => {
  describe('empty index', () => {
    it('returns helpful message when no files indexed', async () => {
      const mockIndexer = createMockIndexer([]);

      const result = await runListFiles(mockIndexer as any, {});

      expect(result.content[0].text).toContain('No indexed files found');
      expect(result.content[0].text).toContain('lazy-load index');
    });
  });

  describe('basic listing', () => {
    it('lists files with basic info', async () => {
      const files = [
        createTestFileIndex({
          filePath: '/project/src/index.ts',
          relativePath: 'src/index.ts',
          language: 'typescript',
          lineCount: 100,
          functions: [createTestFunctionSignature()],
          classes: [createTestClassSignature()],
        }),
      ];
      const mockIndexer = createMockIndexer(files);

      const result = await runListFiles(mockIndexer as any, {});

      expect(result.content[0].text).toContain('### index.ts (100 lines)');
      expect(result.content[0].text).toContain('src/index.ts');
      expect(result.content[0].text).toContain('typescript');
      expect(result.content[0].text).toContain('100');
      expect(result.content[0].text).toContain('Functions');
      expect(result.content[0].text).toContain('Classes');
    });

    it('groups files by directory', async () => {
      const files = [
        createTestFileIndex({
          filePath: '/project/src/core/engine.ts',
          relativePath: 'src/core/engine.ts',
          lineCount: 200,
        }),
        createTestFileIndex({
          filePath: '/project/src/core/utils.ts',
          relativePath: 'src/core/utils.ts',
          lineCount: 50,
        }),
        createTestFileIndex({
          filePath: '/project/src/api/handler.ts',
          relativePath: 'src/api/handler.ts',
          lineCount: 150,
        }),
      ];
      const mockIndexer = createMockIndexer(files);

      const result = await runListFiles(mockIndexer as any, {});

      expect(result.content[0].text).toContain('## src/core/');
      expect(result.content[0].text).toContain('## src/api/');
    });

    it('shows file summary when available', async () => {
      const files = [
        createTestFileIndex({
          filePath: '/project/src/main.ts',
          relativePath: 'src/main.ts',
          lineCount: 50,
          summary: 'Main entry point for the application',
        }),
      ];
      const mockIndexer = createMockIndexer(files);

      const result = await runListFiles(mockIndexer as any, {});

      expect(result.content[0].text).toContain('Main entry point for the application');
    });

    it('supports compact output format', async () => {
      const files = [
        createTestFileIndex({
          filePath: '/project/src/index.ts',
          relativePath: 'src/index.ts',
          language: 'typescript',
          lineCount: 100,
          functions: [createTestFunctionSignature()],
          classes: [createTestClassSignature()],
        }),
      ];
      const mockIndexer = createMockIndexer(files);

      const result = await runListFiles(mockIndexer as any, { format: 'compact' });
      const text = result.content[0].text;

      expect(text).toContain('[FILES]');
      expect(text).toContain('path\tlanguage\tlines\tfunctions\tclasses');
      expect(text).toContain('src/index.ts');
      expect(text).not.toContain('## src/');
    });
  });

  describe('limit parameter', () => {
    it('limits results to specified count', async () => {
      const files = Array(10).fill(null).map((_, i) =>
        createTestFileIndex({
          filePath: `/project/src/file${i}.ts`,
          relativePath: `src/file${i}.ts`,
          lineCount: 50 + i,
        })
      );
      const mockIndexer = createMockIndexer(files);

      const result = await runListFiles(mockIndexer as any, { limit: 3 });

      // Should show pagination info
      expect(result.content[0].text).toContain('1-3 of');
      expect(result.content[0].text).toContain('More files available');
      expect(result.content[0].text).toContain('offset: 3');
    });

    it('uses default limit of 50', async () => {
      const files = Array(60).fill(null).map((_, i) =>
        createTestFileIndex({
          filePath: `/project/src/file${i}.ts`,
          relativePath: `src/file${i}.ts`,
          lineCount: 50,
        })
      );
      const mockIndexer = createMockIndexer(files);

      const result = await runListFiles(mockIndexer as any, {});

      expect(result.content[0].text).toContain('1-50 of 60');
      expect(result.content[0].text).toContain('More files available');
    });

    it('does not show pagination hint when all files shown', async () => {
      const files = Array(5).fill(null).map((_, i) =>
        createTestFileIndex({
          filePath: `/project/src/file${i}.ts`,
          relativePath: `src/file${i}.ts`,
          lineCount: 50,
        })
      );
      const mockIndexer = createMockIndexer(files);

      const result = await runListFiles(mockIndexer as any, { limit: 10 });

      expect(result.content[0].text).not.toContain('More files available');
      expect(result.content[0].text).toContain('5 total');
    });
  });

  describe('offset pagination', () => {
    it('skips files according to offset', async () => {
      const files = Array(10).fill(null).map((_, i) =>
        createTestFileIndex({
          filePath: `/project/src/file${i}.ts`,
          relativePath: `src/file${i}.ts`,
          lineCount: 50 + i,
        })
      );
      const mockIndexer = createMockIndexer(files);

      const result = await runListFiles(mockIndexer as any, { limit: 3, offset: 3 });

      expect(result.content[0].text).toContain('4-6 of 10');
      expect(result.content[0].text).toContain('file3.ts');
      expect(result.content[0].text).not.toContain('file0.ts');
    });

    it('shows correct pagination for middle pages', async () => {
      const files = Array(20).fill(null).map((_, i) =>
        createTestFileIndex({
          filePath: `/project/src/file${i.toString().padStart(2, '0')}.ts`,
          relativePath: `src/file${i.toString().padStart(2, '0')}.ts`,
          lineCount: 50,
        })
      );
      const mockIndexer = createMockIndexer(files);

      const result = await runListFiles(mockIndexer as any, { limit: 5, offset: 10 });

      expect(result.content[0].text).toContain('11-15 of 20');
      expect(result.content[0].text).toContain('offset: 15');
    });

    it('handles offset at end of list', async () => {
      const files = Array(10).fill(null).map((_, i) =>
        createTestFileIndex({
          filePath: `/project/src/file${i}.ts`,
          relativePath: `src/file${i}.ts`,
          lineCount: 50,
        })
      );
      const mockIndexer = createMockIndexer(files);

      const result = await runListFiles(mockIndexer as any, { limit: 5, offset: 8 });

      expect(result.content[0].text).toContain('9-10 of 10');
      expect(result.content[0].text).not.toContain('More files available');
    });
  });

  describe('exclude_patterns filtering', () => {
    it('excludes files matching glob patterns', async () => {
      const files = [
        createTestFileIndex({
          filePath: '/project/src/main.ts',
          relativePath: 'src/main.ts',
          lineCount: 100,
        }),
        createTestFileIndex({
          filePath: '/project/src/generated/api.ts',
          relativePath: 'src/generated/api.ts',
          lineCount: 500,
        }),
        createTestFileIndex({
          filePath: '/project/src/utils.ts',
          relativePath: 'src/utils.ts',
          lineCount: 50,
        }),
      ];
      const mockIndexer = createMockIndexer(files);

      const result = await runListFiles(mockIndexer as any, {
        exclude_patterns: ['**/generated/**'],
      });

      expect(result.content[0].text).toContain('main.ts');
      expect(result.content[0].text).toContain('utils.ts');
      expect(result.content[0].text).not.toContain('generated');
    });

    it('supports multiple exclude patterns', async () => {
      const files = [
        createTestFileIndex({
          filePath: '/project/src/main.ts',
          relativePath: 'src/main.ts',
          lineCount: 100,
        }),
        createTestFileIndex({
          filePath: '/project/src/old/legacy.ts',
          relativePath: 'src/old/legacy.ts',
          lineCount: 200,
        }),
        createTestFileIndex({
          filePath: '/project/src/temp/scratch.ts',
          relativePath: 'src/temp/scratch.ts',
          lineCount: 30,
        }),
      ];
      const mockIndexer = createMockIndexer(files);

      const result = await runListFiles(mockIndexer as any, {
        exclude_patterns: ['**/old/**', '**/temp/**'],
      });

      expect(result.content[0].text).toContain('main.ts');
      expect(result.content[0].text).not.toContain('legacy.ts');
      expect(result.content[0].text).not.toContain('scratch.ts');
    });

    it('supports wildcard patterns for file extensions', async () => {
      const files = [
        createTestFileIndex({
          filePath: '/project/src/app.ts',
          relativePath: 'src/app.ts',
          lineCount: 100,
        }),
        createTestFileIndex({
          filePath: '/project/src/app.d.ts',
          relativePath: 'src/app.d.ts',
          lineCount: 20,
        }),
        createTestFileIndex({
          filePath: '/project/src/types.d.ts',
          relativePath: 'src/types.d.ts',
          lineCount: 50,
        }),
      ];
      const mockIndexer = createMockIndexer(files);

      const result = await runListFiles(mockIndexer as any, {
        exclude_patterns: ['**/*.d.ts'],
      });

      expect(result.content[0].text).toContain('app.ts');
      expect(result.content[0].text).not.toContain('app.d.ts');
      expect(result.content[0].text).not.toContain('types.d.ts');
    });
  });

  describe('include_tests flag', () => {
    it('excludes test files with .test. and .spec. patterns by default', async () => {
      const files = [
        createTestFileIndex({
          filePath: '/project/src/service.ts',
          relativePath: 'src/service.ts',
          lineCount: 200,
        }),
        createTestFileIndex({
          filePath: '/project/src/service.test.ts',
          relativePath: 'src/service.test.ts',
          lineCount: 150,
        }),
        createTestFileIndex({
          filePath: '/project/src/utils.spec.ts',
          relativePath: 'src/utils.spec.ts',
          lineCount: 100,
        }),
        createTestFileIndex({
          filePath: '/project/src/__tests__/unit.ts',
          relativePath: 'src/__tests__/unit.ts',
          lineCount: 100,
        }),
      ];
      const mockIndexer = createMockIndexer(files);

      const result = await runListFiles(mockIndexer as any, {});

      expect(result.content[0].text).toContain('service.ts');
      expect(result.content[0].text).not.toContain('service.test.ts');
      expect(result.content[0].text).not.toContain('utils.spec.ts');
      expect(result.content[0].text).not.toContain('__tests__');
    });

    it('includes test files when include_tests is true', async () => {
      const files = [
        createTestFileIndex({
          filePath: '/project/src/service.ts',
          relativePath: 'src/service.ts',
          lineCount: 200,
        }),
        createTestFileIndex({
          filePath: '/project/src/service.test.ts',
          relativePath: 'src/service.test.ts',
          lineCount: 150,
        }),
        createTestFileIndex({
          filePath: '/project/tests/e2e.spec.ts',
          relativePath: 'tests/e2e.spec.ts',
          lineCount: 400,
        }),
      ];
      const mockIndexer = createMockIndexer(files);

      const result = await runListFiles(mockIndexer as any, { include_tests: true });

      expect(result.content[0].text).toContain('service.ts');
      expect(result.content[0].text).toContain('service.test.ts');
      expect(result.content[0].text).toContain('e2e.spec.ts');
    });

    it('excludes test file patterns within src directory', async () => {
      const files = [
        createTestFileIndex({ relativePath: 'src/app.ts', filePath: '/p/src/app.ts', lineCount: 100 }),
        createTestFileIndex({ relativePath: 'src/app.test.ts', filePath: '/p/src/app.test.ts', lineCount: 50 }),
        createTestFileIndex({ relativePath: 'src/app.spec.ts', filePath: '/p/src/app.spec.ts', lineCount: 50 }),
        createTestFileIndex({ relativePath: 'src/__tests__/mock.ts', filePath: '/p/src/__tests__/mock.ts', lineCount: 20 }),
        createTestFileIndex({ relativePath: 'src/components/tests/widget.ts', filePath: '/p/src/components/tests/widget.ts', lineCount: 30 }),
      ];
      const mockIndexer = createMockIndexer(files);

      const result = await runListFiles(mockIndexer as any, {});

      expect(result.content[0].text).toContain('app.ts');
      expect(result.content[0].text).not.toContain('.test.');
      expect(result.content[0].text).not.toContain('.spec.');
      expect(result.content[0].text).not.toContain('__tests__');
      expect(result.content[0].text).not.toContain('components/tests');
    });
  });

  describe('summary_only mode', () => {
    it('shows only directory summaries when summary_only is true', async () => {
      const files = [
        createTestFileIndex({
          filePath: '/project/src/core/engine.ts',
          relativePath: 'src/core/engine.ts',
          lineCount: 500,
          functions: [createTestFunctionSignature(), createTestFunctionSignature()],
          classes: [createTestClassSignature()],
        }),
        createTestFileIndex({
          filePath: '/project/src/core/utils.ts',
          relativePath: 'src/core/utils.ts',
          lineCount: 100,
          functions: [createTestFunctionSignature()],
        }),
        createTestFileIndex({
          filePath: '/project/src/api/handler.ts',
          relativePath: 'src/api/handler.ts',
          lineCount: 200,
          functions: [createTestFunctionSignature(), createTestFunctionSignature(), createTestFunctionSignature()],
          classes: [createTestClassSignature(), createTestClassSignature()],
        }),
      ];
      const mockIndexer = createMockIndexer(files);

      const result = await runListFiles(mockIndexer as any, { summary_only: true });

      const text = result.content[0].text;
      expect(text).toContain('Codebase Summary');
      expect(text).toContain('| Directory | Files | Lines | Functions | Classes |');
      expect(text).toContain('src/core/');
      expect(text).toContain('src/api/');
      // Should show aggregated counts
      expect(text).toContain('2'); // 2 files in src/core
      expect(text).toContain('600'); // 500 + 100 lines in src/core
    });

    it('shows total file count in summary mode', async () => {
      const files = Array(15).fill(null).map((_, i) =>
        createTestFileIndex({
          filePath: `/project/src/file${i}.ts`,
          relativePath: `src/file${i}.ts`,
          lineCount: 50,
        })
      );
      const mockIndexer = createMockIndexer(files);

      const result = await runListFiles(mockIndexer as any, { summary_only: true });

      expect(result.content[0].text).toContain('15 files');
    });

    it('sorts directories by file count descending', async () => {
      const files = [
        // src/small/ - 1 file
        createTestFileIndex({
          filePath: '/project/src/small/one.ts',
          relativePath: 'src/small/one.ts',
          lineCount: 50,
        }),
        // src/large/ - 3 files
        createTestFileIndex({
          filePath: '/project/src/large/a.ts',
          relativePath: 'src/large/a.ts',
          lineCount: 100,
        }),
        createTestFileIndex({
          filePath: '/project/src/large/b.ts',
          relativePath: 'src/large/b.ts',
          lineCount: 100,
        }),
        createTestFileIndex({
          filePath: '/project/src/large/c.ts',
          relativePath: 'src/large/c.ts',
          lineCount: 100,
        }),
      ];
      const mockIndexer = createMockIndexer(files);

      const result = await runListFiles(mockIndexer as any, { summary_only: true });

      const text = result.content[0].text;
      const largeIndex = text.indexOf('src/large/');
      const smallIndex = text.indexOf('src/small/');
      expect(largeIndex).toBeLessThan(smallIndex);
    });

    it('notes when tests are excluded in summary', async () => {
      const files = [
        createTestFileIndex({
          filePath: '/project/src/app.ts',
          relativePath: 'src/app.ts',
          lineCount: 100,
        }),
      ];
      const mockIndexer = createMockIndexer(files);

      const result = await runListFiles(mockIndexer as any, { summary_only: true });

      expect(result.content[0].text).toContain('excluding tests');
    });

    it('does not note test exclusion when tests included', async () => {
      const files = [
        createTestFileIndex({
          filePath: '/project/src/app.ts',
          relativePath: 'src/app.ts',
          lineCount: 100,
        }),
      ];
      const mockIndexer = createMockIndexer(files);

      const result = await runListFiles(mockIndexer as any, {
        summary_only: true,
        include_tests: true,
      });

      expect(result.content[0].text).not.toContain('excluding tests');
    });

    it('includes hint to use list_files without summary_only', async () => {
      const files = [
        createTestFileIndex({
          filePath: '/project/src/app.ts',
          relativePath: 'src/app.ts',
          lineCount: 100,
        }),
      ];
      const mockIndexer = createMockIndexer(files);

      const result = await runListFiles(mockIndexer as any, { summary_only: true });

      expect(result.content[0].text).toContain('without `summary_only`');
    });

    it('supports compact summary output', async () => {
      const files = [
        createTestFileIndex({
          filePath: '/project/src/core/engine.ts',
          relativePath: 'src/core/engine.ts',
          lineCount: 200,
          functions: [createTestFunctionSignature()],
          classes: [createTestClassSignature()],
        }),
      ];
      const mockIndexer = createMockIndexer(files);

      const result = await runListFiles(mockIndexer as any, {
        summary_only: true,
        format: 'compact',
      });
      const text = result.content[0].text;

      expect(text).toContain('[DIRECTORIES]');
      expect(text).toContain('directory\tfiles\tlines\tfunctions\tclasses');
      expect(text).toContain('src/core/');
      expect(text).not.toContain('Codebase Summary');
    });
  });

  describe('directory filtering', () => {
    it('filters to specified directory', async () => {
      const files = [
        createTestFileIndex({
          filePath: '/project/src/core/engine.ts',
          relativePath: 'src/core/engine.ts',
          lineCount: 200,
        }),
        createTestFileIndex({
          filePath: '/project/src/api/handler.ts',
          relativePath: 'src/api/handler.ts',
          lineCount: 100,
        }),
        createTestFileIndex({
          filePath: '/project/lib/utils.ts',
          relativePath: 'lib/utils.ts',
          lineCount: 50,
        }),
      ];
      const mockIndexer = createMockIndexer(files);

      const result = await runListFiles(mockIndexer as any, { directory: 'src' });

      expect(result.content[0].text).toContain('engine.ts');
      expect(result.content[0].text).toContain('handler.ts');
      expect(result.content[0].text).not.toContain('lib/utils.ts');
    });
  });

  describe('language filtering', () => {
    it('filters by language', async () => {
      const files = [
        createTestFileIndex({
          filePath: '/project/src/app.ts',
          relativePath: 'src/app.ts',
          language: 'typescript',
          lineCount: 100,
        }),
        createTestFileIndex({
          filePath: '/project/src/script.py',
          relativePath: 'src/script.py',
          language: 'python',
          lineCount: 50,
        }),
        createTestFileIndex({
          filePath: '/project/src/utils.ts',
          relativePath: 'src/utils.ts',
          language: 'typescript',
          lineCount: 75,
        }),
      ];
      const mockIndexer = createMockIndexer(files);

      const result = await runListFiles(mockIndexer as any, { language: 'typescript' });

      expect(result.content[0].text).toContain('app.ts');
      expect(result.content[0].text).toContain('utils.ts');
      expect(result.content[0].text).not.toContain('script.py');
    });
  });

  describe('combined filtering', () => {
    it('applies multiple filters together', async () => {
      const files = [
        createTestFileIndex({
          filePath: '/project/src/core/engine.ts',
          relativePath: 'src/core/engine.ts',
          language: 'typescript',
          lineCount: 200,
        }),
        createTestFileIndex({
          filePath: '/project/src/core/engine.test.ts',
          relativePath: 'src/core/engine.test.ts',
          language: 'typescript',
          lineCount: 100,
        }),
        createTestFileIndex({
          filePath: '/project/src/core/script.py',
          relativePath: 'src/core/script.py',
          language: 'python',
          lineCount: 50,
        }),
        createTestFileIndex({
          filePath: '/project/lib/helper.ts',
          relativePath: 'lib/helper.ts',
          language: 'typescript',
          lineCount: 30,
        }),
      ];
      const mockIndexer = createMockIndexer(files);

      const result = await runListFiles(mockIndexer as any, {
        directory: 'src',
        language: 'typescript',
        include_tests: false,
      });

      expect(result.content[0].text).toContain('engine.ts');
      expect(result.content[0].text).not.toContain('engine.test.ts');
      expect(result.content[0].text).not.toContain('script.py');
      expect(result.content[0].text).not.toContain('helper.ts');
    });
  });
});
