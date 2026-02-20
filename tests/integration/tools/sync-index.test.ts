import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Indexer } from '../../../src/indexer/index.js';
import { syncIndexTool } from '../../../src/server/tools/sync-index.js';
import { listFilesTool } from '../../../src/server/tools/list-files.js';
import { searchSymbolsTool } from '../../../src/server/tools/search-symbols.js';
import { createTempProject, type TempProjectResult } from '../../helpers/fixtures.js';

describe('Sync Index Integration', () => {
  let indexer: Indexer;
  let tempProject: TempProjectResult;

  beforeEach(async () => {
    tempProject = createTempProject({
      'src/original.ts': `
export const originalValue = 1;

export function originalFunction(): number {
  return originalValue;
}
`,
      'src/utils.ts': `
export function helper(): string {
  return 'helper';
}
`,
    });

    indexer = new Indexer({
      rootDirectory: tempProject.rootDir,
      databasePath: path.join(tempProject.rootDir, '.lazyload', 'test.db'),
      include: ['**/*.ts'],
      exclude: ['node_modules/**'],
    });
    await indexer.initialize();
    await indexer.indexDirectory();
  });

  afterEach(async () => {
    await indexer.close();
    tempProject.cleanup();
  });

  describe('detecting new files', () => {
    it('detects and indexes new files via full sync', async () => {
      // Add a new file to the real file system
      tempProject.addFile('src/new-file.ts', `
export const newValue = 42;

export function newFunction(): number {
  return newValue;
}
`);

      // Run full sync
      const result = await syncIndexTool(indexer, {});
      const text = result.content[0]?.text ?? '';

      expect(text).toContain('Re-indexed');
      expect(text).toContain('Index Sync Complete');
    });

    it('indexes specific new file via targeted sync', async () => {
      // Add a new file
      const newFilePath = tempProject.addFile('src/targeted.ts', `
export const targetedValue = 100;
`);

      // Run targeted sync for just this file
      const result = await syncIndexTool(indexer, {
        files: [newFilePath],
      });
      const text = result.content[0]?.text ?? '';

      expect(text).toContain('Targeted sync');
      expect(text).toContain('Re-indexed');
    });

    it('newly added file appears in search results after sync', async () => {
      // Add a new file with a unique symbol
      tempProject.addFile('src/searchable.ts', `
export function uniqueSearchableSymbol(): void {
  console.log('searchable');
}
`);

      // Sync the index
      await syncIndexTool(indexer, {});

      // Search for the new symbol
      const searchResult = await searchSymbolsTool(indexer, {
        query: 'uniqueSearchableSymbol',
      });
      const text = searchResult.content[0]?.text ?? '';

      expect(text).toContain('uniqueSearchableSymbol');
    });

    it('newly added file appears in file list after sync', async () => {
      tempProject.addFile('src/listed-file.ts', `
export const listed = true;
`);

      await syncIndexTool(indexer, {});

      const listResult = await listFilesTool(indexer, {});
      const text = listResult.content[0]?.text ?? '';

      expect(text).toContain('listed-file.ts');
    });
  });

  describe('detecting deleted files', () => {
    it('detects and removes deleted files from index', async () => {
      // Verify original file is indexed
      const beforeList = await listFilesTool(indexer, {});
      expect(beforeList.content[0]?.text).toContain('original.ts');

      // Delete the file from real file system
      tempProject.removeFile('src/original.ts');

      // Run sync
      const result = await syncIndexTool(indexer, {});
      const text = result.content[0]?.text ?? '';

      // Should report removal
      expect(text).toMatch(/removed|re-indexed/i);
    });

    it('deleted file symbols can be removed via targeted sync', async () => {
      // Verify symbol is searchable before
      const beforeSearch = await searchSymbolsTool(indexer, {
        query: 'originalFunction',
      });
      expect(beforeSearch.content[0]?.text).toContain('originalFunction');

      const filePath = tempProject.getFilePath('src/original.ts');

      // Delete the file
      tempProject.removeFile('src/original.ts');

      // Targeted sync for the deleted file should remove it
      const result = await syncIndexTool(indexer, {
        files: [filePath],
      });
      expect(result.content[0]?.text).toContain('Removed');

      // Symbol should no longer be found
      const afterSearch = await searchSymbolsTool(indexer, {
        query: 'originalFunction',
      });
      expect(afterSearch.content[0]?.text).toContain('No matches');
    });

    it('handles targeted sync of deleted file', async () => {
      const filePath = tempProject.getFilePath('src/original.ts');

      // Delete the file
      tempProject.removeFile('src/original.ts');

      // Run targeted sync for the deleted file
      const result = await syncIndexTool(indexer, {
        files: [filePath],
      });
      const text = result.content[0]?.text ?? '';

      expect(text).toContain('Removed');
    });
  });

  describe('detecting modified files', () => {
    it('detects modified files and re-indexes them', async () => {
      // Modify an existing file - add new content
      tempProject.addFile('src/original.ts', `
export const originalValue = 1;

export function originalFunction(): number {
  return originalValue;
}

// New addition
export const newAddition = 999;

export function addedFunction(): number {
  return newAddition;
}
`);

      // Sync
      const result = await syncIndexTool(indexer, {});
      const text = result.content[0]?.text ?? '';

      expect(text).toContain('Re-indexed');
    });

    it('new symbols in modified file are searchable after sync', async () => {
      // Add new symbol to existing file
      tempProject.addFile('src/original.ts', `
export const originalValue = 1;
export const brandNewSymbol = 'new';

export function originalFunction(): number {
  return originalValue;
}

export function brandNewFunction(): string {
  return brandNewSymbol;
}
`);

      // Sync
      await syncIndexTool(indexer, {});

      // Search for new symbol
      const searchResult = await searchSymbolsTool(indexer, {
        query: 'brandNewFunction',
      });
      const text = searchResult.content[0]?.text ?? '';

      expect(text).toContain('brandNewFunction');
    });

    it('removed symbols from modified file are no longer searchable', async () => {
      // Verify original symbol exists
      const beforeSearch = await searchSymbolsTool(indexer, {
        query: 'originalFunction',
      });
      expect(beforeSearch.content[0]?.text).toContain('originalFunction');

      // Modify file to remove the function
      tempProject.addFile('src/original.ts', `
export const originalValue = 1;
// originalFunction has been removed
`);

      // Sync
      await syncIndexTool(indexer, {});

      // Original function should no longer be found
      const afterSearch = await searchSymbolsTool(indexer, {
        query: 'originalFunction',
      });
      expect(afterSearch.content[0]?.text).toContain('No matches');
    });
  });

  describe('sync options', () => {
    it('reports sync duration', async () => {
      const result = await syncIndexTool(indexer, {});
      const text = result.content[0]?.text ?? '';

      expect(text).toContain('Duration');
      expect(text).toMatch(/\d+ms/);
    });

    it('shows summary statistics', async () => {
      // Add a file and delete another
      tempProject.addFile('src/added.ts', 'export const a = 1;');
      tempProject.removeFile('src/utils.ts');

      const result = await syncIndexTool(indexer, {});
      const text = result.content[0]?.text ?? '';

      expect(text).toContain('Summary');
      expect(text).toContain('Re-indexed');
      expect(text).toContain('Removed');
      expect(text).toContain('Unchanged');
    });

    it('can rebuild markov chains after sync', async () => {
      tempProject.addFile('src/new.ts', `
export function newFunc(): void {}
`);

      const result = await syncIndexTool(indexer, {
        rebuild_chains: true,
      });
      const text = result.content[0]?.text ?? '';

      // Should indicate chains were rebuilt
      expect(text).toMatch(/chain|rebuilt|markov/i);
    });
  });

  describe('error handling', () => {
    it('reports errors for invalid file paths', async () => {
      const result = await syncIndexTool(indexer, {
        files: ['/nonexistent/path/file.ts'],
      });
      const text = result.content[0]?.text ?? '';

      // Should report as removed since file doesn't exist
      expect(text).toContain('Removed');
    });

    it('continues processing other files when one fails', async () => {
      tempProject.addFile('src/valid.ts', 'export const v = 1;');

      const result = await syncIndexTool(indexer, {
        files: [
          '/nonexistent/file.ts',
          tempProject.getFilePath('src/valid.ts'),
        ],
      });
      const text = result.content[0]?.text ?? '';

      // Should process both - one removed, one indexed
      expect(text).toContain('Sync Complete');
    });
  });
});

describe('Sync Index - Multiple File Types', () => {
  let indexer: Indexer;
  let tempProject: TempProjectResult;

  beforeEach(async () => {
    tempProject = createTempProject({
      'src/app.ts': `
export function app(): void {}
`,
      'src/utils.py': `
def utility():
    return "util"
`,
    });

    indexer = new Indexer({
      rootDirectory: tempProject.rootDir,
      databasePath: path.join(tempProject.rootDir, '.lazyload', 'test.db'),
      include: ['**/*.ts', '**/*.py'],
      exclude: [],
    });
    await indexer.initialize();
    await indexer.indexDirectory();
  });

  afterEach(async () => {
    await indexer.close();
    tempProject.cleanup();
  });

  it('syncs new TypeScript files', async () => {
    tempProject.addFile('src/new.ts', 'export const x = 1;');
    await syncIndexTool(indexer, {});

    const result = await listFilesTool(indexer, { language: 'typescript' });
    expect(result.content[0]?.text).toContain('new.ts');
  });

  it('syncs new Python files', async () => {
    tempProject.addFile('src/new_module.py', 'def new_func(): pass');
    await syncIndexTool(indexer, {});

    const result = await listFilesTool(indexer, { language: 'python' });
    expect(result.content[0]?.text).toContain('new_module.py');
  });

  it('handles mixed file type changes', async () => {
    tempProject.addFile('src/added.ts', 'export const ts = 1;');
    tempProject.addFile('src/added.py', 'py = 1');
    tempProject.removeFile('src/utils.py');

    const result = await syncIndexTool(indexer, {});
    const text = result.content[0]?.text ?? '';

    expect(text).toContain('Sync Complete');
  });
});

describe('Sync Index - Directory Structure Changes', () => {
  let indexer: Indexer;
  let tempProject: TempProjectResult;

  beforeEach(async () => {
    tempProject = createTempProject({
      'src/index.ts': 'export const main = true;',
    });

    indexer = new Indexer({
      rootDirectory: tempProject.rootDir,
      databasePath: path.join(tempProject.rootDir, '.lazyload', 'test.db'),
      include: ['**/*.ts'],
      exclude: [],
    });
    await indexer.initialize();
    await indexer.indexDirectory();
  });

  afterEach(async () => {
    await indexer.close();
    tempProject.cleanup();
  });

  it('indexes files in newly created subdirectories', async () => {
    // Create a new subdirectory with files
    tempProject.addFile('src/components/button.ts', `
export function Button(): void {}
`);
    tempProject.addFile('src/components/input.ts', `
export function Input(): void {}
`);

    await syncIndexTool(indexer, {});

    const result = await listFilesTool(indexer, {});
    const text = result.content[0]?.text ?? '';

    expect(text).toContain('button.ts');
    expect(text).toContain('input.ts');
  });

  it('indexes deeply nested new files', async () => {
    tempProject.addFile('src/features/auth/providers/google.ts', `
export function googleAuth(): void {}
`);

    await syncIndexTool(indexer, {});

    const result = await searchSymbolsTool(indexer, {
      query: 'googleAuth',
    });

    expect(result.content[0]?.text).toContain('googleAuth');
  });
});
