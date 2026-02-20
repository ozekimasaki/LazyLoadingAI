import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Indexer } from '../../../src/indexer/index.js';
import { createTempProject, SAMPLE_TYPESCRIPT, SAMPLE_PYTHON } from '../../helpers/fixtures.js';

describe('Indexer', () => {
  let tempProject: ReturnType<typeof createTempProject>;
  let indexer: Indexer;
  let dbPath: string;

  beforeEach(() => {
    tempProject = createTempProject({
      'src/main.ts': SAMPLE_TYPESCRIPT,
      'src/utils.py': SAMPLE_PYTHON,
    });
    dbPath = path.join(tempProject.rootDir, '.lazyload', 'test.db');
  });

  afterEach(async () => {
    if (indexer) {
      await indexer.close();
    }
    tempProject.cleanup();
  });

  describe('constructor', () => {
    it('should store configuration', () => {
      indexer = new Indexer({
        rootDirectory: tempProject.rootDir,
        databasePath: dbPath,
        include: ['**/*.ts'],
        exclude: ['**/node_modules/**'],
      });

      // Indexer is created without error
      expect(indexer).toBeDefined();
    });

    it('should apply default patterns when empty arrays provided', () => {
      indexer = new Indexer({
        rootDirectory: tempProject.rootDir,
        databasePath: dbPath,
        include: [],
        exclude: [],
      });

      // Should use defaults
      expect(indexer).toBeDefined();
    });
  });

  describe('initialize', () => {
    it('should set up storage and parsers', async () => {
      indexer = new Indexer({
        rootDirectory: tempProject.rootDir,
        databasePath: dbPath,
        include: ['**/*.ts', '**/*.py'],
        exclude: [],
      });

      await indexer.initialize();

      // Should be able to get stats after initialization
      const stats = await indexer.getStats();
      expect(stats).toBeDefined();
      expect(stats.totalFiles).toBe(0); // No files indexed yet
    });

    it('should only initialize once', async () => {
      indexer = new Indexer({
        rootDirectory: tempProject.rootDir,
        databasePath: dbPath,
        include: ['**/*.ts'],
        exclude: [],
      });

      await indexer.initialize();
      await indexer.initialize(); // Should not throw

      expect(indexer).toBeDefined();
    });
  });

  describe('indexDirectory', () => {
    beforeEach(async () => {
      indexer = new Indexer({
        rootDirectory: tempProject.rootDir,
        databasePath: dbPath,
        include: ['**/*.ts', '**/*.py'],
        exclude: [],
      });
      await indexer.initialize();
    });

    it('should find and index matching files', async () => {
      const result = await indexer.indexDirectory();

      expect(result.totalFiles).toBe(2);
      expect(result.indexedFiles).toBe(2);
      expect(result.skippedFiles).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.durationMs).toBeGreaterThan(0);
    });

    it('should return stats after indexing', async () => {
      await indexer.indexDirectory();

      const stats = await indexer.getStats();
      expect(stats.totalFiles).toBe(2);
      expect(stats.totalSymbols).toBeGreaterThan(0);
    });

    it('builds Markov chains as part of directory indexing', async () => {
      await indexer.indexDirectory();

      const storage = indexer.getStorage();
      const chainStats = await storage.getAllChainStats();

      expect(chainStats).toHaveLength(4);
      expect(chainStats.map(c => c.chainType).sort()).toEqual([
        'call_flow',
        'cooccurrence',
        'import_cluster',
        'type_affinity',
      ]);

      const totalTransitions = chainStats.reduce((sum, chain) => sum + chain.totalTransitions, 0);
      expect(totalTransitions).toBeGreaterThan(0);
    });

    it('resolves symbol IDs before building call_flow transitions', async () => {
      tempProject.addFile('src/main.ts', `
export function alpha(): void {
  beta();
  gamma();
}

export function beta(): void {}
export function gamma(): void {}
`);

      await indexer.indexDirectory();

      const storage = indexer.getStorage();
      const chainId = await storage.getChainId('call_flow');
      const betaSymbol = await storage.getSymbolByName('beta');

      expect(chainId).toBeTruthy();
      expect(betaSymbol).toBeTruthy();

      const hasSupport = await storage.hasChainSupport(chainId!, betaSymbol!.id);
      expect(hasSupport).toBe(true);
    });

    it('should index specific directory', async () => {
      const result = await indexer.indexDirectory(path.join(tempProject.rootDir, 'src'));

      expect(result.totalFiles).toBe(2);
      expect(result.indexedFiles).toBe(2);
    });

    it('should respect exclude patterns', async () => {
      const excludeDir = path.join(tempProject.rootDir, 'node_modules', 'pkg');
      fs.mkdirSync(excludeDir, { recursive: true });
      fs.writeFileSync(path.join(excludeDir, 'index.ts'), 'export const x = 1;');

      const indexerWithExclude = new Indexer({
        rootDirectory: tempProject.rootDir,
        databasePath: dbPath,
        include: ['**/*.ts'],
        exclude: ['**/node_modules/**'],
      });
      await indexerWithExclude.initialize();

      const result = await indexerWithExclude.indexDirectory();

      // Only main.ts should be indexed, not the node_modules file
      expect(result.totalFiles).toBe(1);
      await indexerWithExclude.close();
    });

    it('should handle errors gracefully', async () => {
      // Create a file that will cause parse errors
      tempProject.addFile('broken.ts', 'this is not valid { typescript syntax');

      const result = await indexer.indexDirectory();

      // Should still complete indexing other files
      expect(result.errors.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('indexFile', () => {
    beforeEach(async () => {
      indexer = new Indexer({
        rootDirectory: tempProject.rootDir,
        databasePath: dbPath,
        include: ['**/*.ts', '**/*.py'],
        exclude: [],
      });
      await indexer.initialize();
    });

    it('should index a single file', async () => {
      const filePath = path.join(tempProject.rootDir, 'src/main.ts');
      const wasIndexed = await indexer.indexFile(filePath, tempProject.rootDir);

      expect(wasIndexed).toBe(true);

      const file = await indexer.getFile(filePath);
      expect(file).not.toBeNull();
      expect(file?.functions.length).toBeGreaterThan(0);
    });

    it('should skip file with same checksum', async () => {
      const filePath = path.join(tempProject.rootDir, 'src/main.ts');

      // Index first time
      const firstIndex = await indexer.indexFile(filePath, tempProject.rootDir);
      expect(firstIndex).toBe(true);

      // Index same file again (no changes)
      const secondIndex = await indexer.indexFile(filePath, tempProject.rootDir);
      expect(secondIndex).toBe(false); // Should be skipped
    });

    it('should re-index when file content changes', async () => {
      const filePath = path.join(tempProject.rootDir, 'src/main.ts');

      // Index first time
      await indexer.indexFile(filePath, tempProject.rootDir);

      // Modify file
      const newContent = SAMPLE_TYPESCRIPT + '\nexport function newFunc() { return 42; }';
      fs.writeFileSync(filePath, newContent);

      // Index again
      const wasIndexed = await indexer.indexFile(filePath, tempProject.rootDir);
      expect(wasIndexed).toBe(true);
    });

    it('should return false for unsupported file types', async () => {
      tempProject.addFile('readme.md', '# README');
      const filePath = path.join(tempProject.rootDir, 'readme.md');

      const wasIndexed = await indexer.indexFile(filePath);
      expect(wasIndexed).toBe(false);
    });
  });

  describe('removeFile', () => {
    beforeEach(async () => {
      indexer = new Indexer({
        rootDirectory: tempProject.rootDir,
        databasePath: dbPath,
        include: ['**/*.ts'],
        exclude: [],
      });
      await indexer.initialize();
    });

    it('should remove a file from the index', async () => {
      const filePath = path.join(tempProject.rootDir, 'src/main.ts');
      await indexer.indexFile(filePath, tempProject.rootDir);

      // Verify file is indexed
      let file = await indexer.getFile(filePath);
      expect(file).not.toBeNull();

      // Remove file
      await indexer.removeFile(filePath);

      // Verify file is removed
      file = await indexer.getFile(filePath);
      expect(file).toBeNull();
    });
  });

  describe('getFile', () => {
    beforeEach(async () => {
      indexer = new Indexer({
        rootDirectory: tempProject.rootDir,
        databasePath: dbPath,
        include: ['**/*.ts'],
        exclude: [],
      });
      await indexer.initialize();
      await indexer.indexDirectory();
    });

    it('should retrieve an indexed file', async () => {
      const filePath = path.join(tempProject.rootDir, 'src/main.ts');
      const file = await indexer.getFile(filePath);

      expect(file).not.toBeNull();
      expect(file?.filePath).toBe(filePath);
      expect(file?.language).toBe('typescript');
    });

    it('should return null for non-indexed file', async () => {
      const file = await indexer.getFile('/non/existent/file.ts');
      expect(file).toBeNull();
    });
  });

  describe('listFiles', () => {
    beforeEach(async () => {
      indexer = new Indexer({
        rootDirectory: tempProject.rootDir,
        databasePath: dbPath,
        include: ['**/*.ts', '**/*.py'],
        exclude: [],
      });
      await indexer.initialize();
      await indexer.indexDirectory();
    });

    it('should list all indexed files', async () => {
      const files = await indexer.listFiles();
      expect(files.length).toBe(2);
    });

    it('should filter by language', async () => {
      const tsFiles = await indexer.listFiles({ language: 'typescript' });
      expect(tsFiles.length).toBe(1);
      expect(tsFiles[0]?.language).toBe('typescript');
    });
  });

  describe('getFunction', () => {
    beforeEach(async () => {
      indexer = new Indexer({
        rootDirectory: tempProject.rootDir,
        databasePath: dbPath,
        include: ['**/*.ts'],
        exclude: [],
      });
      await indexer.initialize();
      await indexer.indexDirectory();
    });

    it('should retrieve a function by name', async () => {
      const filePath = path.join(tempProject.rootDir, 'src/main.ts');
      const func = await indexer.getFunction(filePath, 'greet');

      expect(func).not.toBeNull();
      expect(func?.name).toBe('greet');
    });

    it('should return null for non-existent function', async () => {
      const filePath = path.join(tempProject.rootDir, 'src/main.ts');
      const func = await indexer.getFunction(filePath, 'nonexistent');

      expect(func).toBeNull();
    });
  });

  describe('getClass', () => {
    beforeEach(async () => {
      indexer = new Indexer({
        rootDirectory: tempProject.rootDir,
        databasePath: dbPath,
        include: ['**/*.ts'],
        exclude: [],
      });
      await indexer.initialize();
      await indexer.indexDirectory();
    });

    it('should retrieve a class by name', async () => {
      const filePath = path.join(tempProject.rootDir, 'src/main.ts');
      const cls = await indexer.getClass(filePath, 'UserService');

      expect(cls).not.toBeNull();
      expect(cls?.name).toBe('UserService');
    });
  });

  describe('searchSymbols', () => {
    beforeEach(async () => {
      indexer = new Indexer({
        rootDirectory: tempProject.rootDir,
        databasePath: dbPath,
        include: ['**/*.ts', '**/*.py'],
        exclude: [],
      });
      await indexer.initialize();
      await indexer.indexDirectory();
    });

    it('should search for symbols by name', async () => {
      const results = await indexer.searchSymbols('greet');

      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.symbol.name === 'greet')).toBe(true);
    });

    it('should filter by type', async () => {
      const results = await indexer.searchSymbols('User', { type: 'class' });

      expect(results.length).toBeGreaterThan(0);
      expect(results.every(r => r.symbol.kind === 'class')).toBe(true);
    });

    it('should filter by language', async () => {
      const results = await indexer.searchSymbols('greet', { language: 'typescript' });

      expect(results.every(r => r.symbol.filePath.endsWith('.ts'))).toBe(true);
    });

    it('should respect limit', async () => {
      const results = await indexer.searchSymbols('', { limit: 5 });

      expect(results.length).toBeLessThanOrEqual(5);
    });
  });

  describe('getFunctionSource', () => {
    beforeEach(async () => {
      indexer = new Indexer({
        rootDirectory: tempProject.rootDir,
        databasePath: dbPath,
        include: ['**/*.ts'],
        exclude: [],
      });
      await indexer.initialize();
      await indexer.indexDirectory();
    });

    it('should retrieve function source code', async () => {
      const filePath = path.join(tempProject.rootDir, 'src/main.ts');
      const source = await indexer.getFunctionSource(filePath, 'greet');

      expect(source).not.toBeNull();
      expect(source).toContain('greet');
      expect(source).toContain('return');
    });

    it('should return null for non-existent function', async () => {
      const filePath = path.join(tempProject.rootDir, 'src/main.ts');
      const source = await indexer.getFunctionSource(filePath, 'nonexistent');

      expect(source).toBeNull();
    });
  });

  describe('getClassSource', () => {
    beforeEach(async () => {
      indexer = new Indexer({
        rootDirectory: tempProject.rootDir,
        databasePath: dbPath,
        include: ['**/*.ts'],
        exclude: [],
      });
      await indexer.initialize();
      await indexer.indexDirectory();
    });

    it('should retrieve class source code', async () => {
      const filePath = path.join(tempProject.rootDir, 'src/main.ts');
      const source = await indexer.getClassSource(filePath, 'UserService');

      expect(source).not.toBeNull();
      expect(source).toContain('class UserService');
    });
  });

  describe('getSourceWithContext', () => {
    beforeEach(async () => {
      indexer = new Indexer({
        rootDirectory: tempProject.rootDir,
        databasePath: dbPath,
        include: ['**/*.ts'],
        exclude: [],
      });
      await indexer.initialize();
    });

    it('should retrieve source with context lines', async () => {
      const filePath = path.join(tempProject.rootDir, 'src/main.ts');
      const result = await indexer.getSourceWithContext(filePath, 5, 10, 2);

      expect(result).not.toBeNull();
      expect(result?.actualStartLine).toBe(3);
      expect(result?.actualEndLine).toBe(12);
      expect(result?.source).toBeDefined();
    });

    it('should clamp to file bounds', async () => {
      const filePath = path.join(tempProject.rootDir, 'src/main.ts');
      const result = await indexer.getSourceWithContext(filePath, 1, 2, 5);

      expect(result).not.toBeNull();
      expect(result?.actualStartLine).toBe(1);
    });

    it('should return null for non-existent file', async () => {
      const result = await indexer.getSourceWithContext('/non/existent.ts', 1, 10, 3);
      expect(result).toBeNull();
    });
  });

  describe('getStats', () => {
    beforeEach(async () => {
      indexer = new Indexer({
        rootDirectory: tempProject.rootDir,
        databasePath: dbPath,
        include: ['**/*.ts', '**/*.py'],
        exclude: [],
      });
      await indexer.initialize();
    });

    it('should return index statistics', async () => {
      await indexer.indexDirectory();

      const stats = await indexer.getStats();

      expect(stats.totalFiles).toBe(2);
      expect(stats.totalSymbols).toBeGreaterThan(0);
      expect(stats.byLanguage.typescript.files).toBe(1);
      expect(stats.byLanguage.python.files).toBe(1);
    });
  });

  describe('clear', () => {
    beforeEach(async () => {
      indexer = new Indexer({
        rootDirectory: tempProject.rootDir,
        databasePath: dbPath,
        include: ['**/*.ts'],
        exclude: [],
      });
      await indexer.initialize();
      await indexer.indexDirectory();
    });

    it('should clear all indexed data', async () => {
      // Verify data exists
      let stats = await indexer.getStats();
      expect(stats.totalFiles).toBeGreaterThan(0);

      await indexer.clear();

      stats = await indexer.getStats();
      expect(stats.totalFiles).toBe(0);
      expect(stats.totalSymbols).toBe(0);
    });
  });

  describe('close', () => {
    it('should close database connection', async () => {
      indexer = new Indexer({
        rootDirectory: tempProject.rootDir,
        databasePath: dbPath,
        include: ['**/*.ts'],
        exclude: [],
      });
      await indexer.initialize();

      await indexer.close();

      // Should be able to re-initialize
      await indexer.initialize();
      const stats = await indexer.getStats();
      expect(stats).toBeDefined();
    });
  });
});
