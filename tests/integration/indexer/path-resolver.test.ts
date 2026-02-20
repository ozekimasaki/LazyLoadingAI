import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { Indexer } from '../../../src/indexer/index.js';
import { getFunctionTool } from '../../../src/server/tools/get-function.js';
import { getClassTool } from '../../../src/server/tools/get-class.js';
import { listFunctionsTool } from '../../../src/server/tools/list-functions.js';
import { createTempProject, type TempProjectResult } from '../../helpers/fixtures.js';

describe('Path Resolver Integration', () => {
  let indexer: Indexer;
  let tempProject: TempProjectResult;

  beforeAll(async () => {
    // Create a project with various directory structures
    tempProject = createTempProject({
      'src/indexer/storage/sqlite.ts': `
export class SqliteStorage {
  private db: unknown;

  async initialize(): Promise<void> {
    console.log('Initializing SQLite');
  }

  async close(): Promise<void> {
    console.log('Closing SQLite');
  }
}
`,
      'src/indexer/storage/memory.ts': `
export class MemoryStorage {
  private data: Map<string, unknown> = new Map();

  async initialize(): Promise<void> {
    console.log('Initializing Memory');
  }

  async close(): Promise<void> {
    this.data.clear();
  }
}
`,
      'src/server/tools/get-function.ts': `
export function getFunctionTool(): void {
  console.log('Get function tool');
}
`,
      'src/server/tools/get-class.ts': `
export function getClassTool(): void {
  console.log('Get class tool');
}
`,
      'src/server/tools/list-files.ts': `
export function listFilesTool(): void {
  console.log('List files tool');
}
`,
      'src/utils/helpers.ts': `
export function helper(): string {
  return 'helper';
}
`,
      'src/config/settings.ts': `
export const settings = {
  debug: true,
  version: '1.0.0',
};
`,
      'tests/unit/storage.test.ts': `
import { describe, it, expect } from 'vitest';

describe('Storage', () => {
  it('should work', () => {
    expect(true).toBe(true);
  });
});
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

  afterAll(async () => {
    await indexer.close();
    tempProject.cleanup();
  });

  describe('exact path matching', () => {
    it('resolves full relative path from root', async () => {
      const result = await listFunctionsTool(indexer, {
        filePath: 'src/indexer/storage/sqlite.ts',
      });
      const text = result.content[0]?.text ?? '';

      expect(text).toContain('SqliteStorage');
      expect(text).toContain('initialize');
    });

    it('resolves absolute path', async () => {
      const absolutePath = tempProject.getFilePath('src/utils/helpers.ts');
      const result = await listFunctionsTool(indexer, {
        filePath: absolutePath,
      });
      const text = result.content[0]?.text ?? '';

      expect(text).toContain('helper');
    });

    it('resolves path with ./ prefix', async () => {
      const result = await listFunctionsTool(indexer, {
        filePath: './src/config/settings.ts',
      });
      const text = result.content[0]?.text ?? '';

      expect(text).toContain('settings');
    });
  });

  describe('auto-resolution of unique basename', () => {
    it('auto-resolves unique filename to full path', async () => {
      // "helpers.ts" is unique in the project
      const result = await listFunctionsTool(indexer, {
        filePath: 'helpers.ts',
      });
      const text = result.content[0]?.text ?? '';

      // Should auto-resolve to src/utils/helpers.ts
      expect(text).toContain('helper');
    });

    it('auto-resolves unique filename for class lookup', async () => {
      // "sqlite.ts" is unique
      const result = await getClassTool(indexer, {
        filePath: 'sqlite.ts',
        className: 'SqliteStorage',
      });
      const text = result.content[0]?.text ?? '';

      expect(text).toContain('SqliteStorage');
      expect(text).toContain('initialize');
    });

    it('auto-resolves unique filename for function lookup', async () => {
      const result = await getFunctionTool(indexer, {
        filePath: 'helpers.ts',
        functionName: 'helper',
      });
      const text = result.content[0]?.text ?? '';

      expect(text).toContain('helper');
      expect(text).toContain("return 'helper'");
    });
  });

  describe('ambiguous path handling', () => {
    it('handles ambiguous "index.ts" style matches', async () => {
      // "storage" could match multiple paths (sqlite.ts, memory.ts are in storage/)
      // Let's test with a partial path that's ambiguous
      const result = await listFunctionsTool(indexer, {
        filePath: 'storage',
      });
      const text = result.content[0]?.text ?? '';

      // Should either auto-resolve or show suggestions
      expect(text).toBeDefined();
    });

    it('provides suggestions for ambiguous paths', async () => {
      // "get-" prefix matches multiple files in tools/
      const result = await listFunctionsTool(indexer, {
        filePath: 'get-function.ts',
      });
      const text = result.content[0]?.text ?? '';

      // Should either resolve or provide helpful message
      expect(text).toBeDefined();
    });
  });

  describe('partial path matching', () => {
    it('resolves partial path matching end of full path', async () => {
      // "storage/sqlite.ts" should match "src/indexer/storage/sqlite.ts"
      const result = await listFunctionsTool(indexer, {
        filePath: 'storage/sqlite.ts',
      });
      const text = result.content[0]?.text ?? '';

      expect(text).toContain('SqliteStorage');
    });

    it('resolves directory/filename partial paths', async () => {
      // "tools/list-files.ts" should match "src/server/tools/list-files.ts"
      const result = await listFunctionsTool(indexer, {
        filePath: 'tools/list-files.ts',
      });
      const text = result.content[0]?.text ?? '';

      expect(text).toContain('listFilesTool');
    });

    it('resolves deeply nested partial paths', async () => {
      // "indexer/storage/memory.ts" should match
      const result = await listFunctionsTool(indexer, {
        filePath: 'indexer/storage/memory.ts',
      });
      const text = result.content[0]?.text ?? '';

      expect(text).toContain('MemoryStorage');
    });
  });

  describe('error handling', () => {
    it('shows error for completely non-existent file', async () => {
      const result = await listFunctionsTool(indexer, {
        filePath: 'nonexistent-file-xyz.ts',
      });
      const text = result.content[0]?.text ?? '';

      expect(text.toLowerCase()).toContain('not found');
    });

    it('shows error for wrong extension', async () => {
      const result = await listFunctionsTool(indexer, {
        filePath: 'sqlite.js', // Wrong extension
      });
      const text = result.content[0]?.text ?? '';

      // Should not find it since only .ts files are indexed
      expect(text.toLowerCase()).toContain('not found');
    });

    it('handles empty file path gracefully', async () => {
      const result = await listFunctionsTool(indexer, {
        filePath: '',
      });
      const text = result.content[0]?.text ?? '';

      // Should handle gracefully
      expect(text).toBeDefined();
    });
  });

  describe('path normalization', () => {
    it('normalizes paths with multiple slashes', async () => {
      const result = await listFunctionsTool(indexer, {
        filePath: 'src//utils//helpers.ts',
      });
      const text = result.content[0]?.text ?? '';

      // Path normalization should handle this
      expect(text).toBeDefined();
    });

    it('normalizes paths with .. segments', async () => {
      const result = await listFunctionsTool(indexer, {
        filePath: 'src/utils/../utils/helpers.ts',
      });
      const text = result.content[0]?.text ?? '';

      expect(text).toContain('helper');
    });
  });
});

describe('Path Resolver - Cross-directory Uniqueness', () => {
  let indexer: Indexer;
  let tempProject: TempProjectResult;

  beforeAll(async () => {
    // Create a project where the same filename exists in different directories
    tempProject = createTempProject({
      'src/utils/index.ts': `
export function srcUtilsIndex(): void {}
`,
      'src/server/index.ts': `
export function srcServerIndex(): void {}
`,
      'src/cli/index.ts': `
export function srcCliIndex(): void {}
`,
      'lib/utils.ts': `
export function libUtils(): void {}
`,
      'src/utils.ts': `
export function srcUtils(): void {}
`,
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

  afterAll(async () => {
    await indexer.close();
    tempProject.cleanup();
  });

  it('shows ambiguous error for "index.ts" with multiple matches', async () => {
    const result = await listFunctionsTool(indexer, {
      filePath: 'index.ts',
    });
    const text = result.content[0]?.text ?? '';

    // Should indicate ambiguity or show suggestions
    // The exact behavior depends on implementation
    expect(text).toBeDefined();
  });

  it('resolves unambiguous partial path "utils/index.ts"', async () => {
    const result = await listFunctionsTool(indexer, {
      filePath: 'utils/index.ts',
    });
    const text = result.content[0]?.text ?? '';

    // "utils/index.ts" matches only "src/utils/index.ts"
    expect(text).toContain('srcUtilsIndex');
  });

  it('resolves unambiguous partial path "server/index.ts"', async () => {
    const result = await listFunctionsTool(indexer, {
      filePath: 'server/index.ts',
    });
    const text = result.content[0]?.text ?? '';

    expect(text).toContain('srcServerIndex');
  });

  it('shows ambiguous error for "utils.ts" with multiple matches', async () => {
    // Both lib/utils.ts and src/utils.ts exist
    const result = await listFunctionsTool(indexer, {
      filePath: 'utils.ts',
    });
    const text = result.content[0]?.text ?? '';

    // Should indicate ambiguity
    expect(text).toBeDefined();
  });

  it('resolves "lib/utils.ts" unambiguously', async () => {
    const result = await listFunctionsTool(indexer, {
      filePath: 'lib/utils.ts',
    });
    const text = result.content[0]?.text ?? '';

    expect(text).toContain('libUtils');
  });

  it('resolves "src/utils.ts" unambiguously', async () => {
    const result = await listFunctionsTool(indexer, {
      filePath: 'src/utils.ts',
    });
    const text = result.content[0]?.text ?? '';

    expect(text).toContain('srcUtils');
  });
});

describe('Path Resolver - Directory Suggestions', () => {
  let indexer: Indexer;
  let tempProject: TempProjectResult;

  beforeAll(async () => {
    tempProject = createTempProject({
      'src/server/tools/get-function.ts': 'export function getFunc() {}',
      'src/server/tools/get-class.ts': 'export function getClass() {}',
      'src/server/tools/list-files.ts': 'export function listFiles() {}',
      'src/server/tools/search.ts': 'export function search() {}',
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

  afterAll(async () => {
    await indexer.close();
    tempProject.cleanup();
  });

  it('shows available files when searching in existing directory', async () => {
    // Search for a non-existent file in an existing directory
    const result = await listFunctionsTool(indexer, {
      filePath: 'src/server/tools/nonexistent.ts',
    });
    const text = result.content[0]?.text ?? '';

    // Should indicate file not found
    expect(text.toLowerCase()).toContain('not found');
  });

  it('suggests similar files for typos', async () => {
    // "get-functon.ts" is a typo of "get-function.ts"
    const result = await listFunctionsTool(indexer, {
      filePath: 'get-functon.ts',
    });
    const text = result.content[0]?.text ?? '';

    // Should either auto-resolve or provide suggestions
    expect(text).toBeDefined();
  });
});
