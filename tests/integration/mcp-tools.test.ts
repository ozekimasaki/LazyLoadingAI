import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Indexer } from '../../src/indexer/index.js';
import { listFilesTool } from '../../src/server/tools/list-files.js';
import { listFunctionsTool } from '../../src/server/tools/list-functions.js';
import { getFunctionTool } from '../../src/server/tools/get-function.js';
import { getClassTool } from '../../src/server/tools/get-class.js';
import { searchSymbolsTool } from '../../src/server/tools/search-symbols.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, '../fixtures');


async function runListFiles(indexer: Indexer, input: Record<string, unknown> = {}) {
  return listFilesTool(indexer, { format: 'markdown', ...input } as any);
}

async function runListFunctions(indexer: Indexer, input: Record<string, unknown> = {}) {
  return listFunctionsTool(indexer, { format: 'markdown', ...input } as any);
}

async function runGetFunction(indexer: Indexer, input: Record<string, unknown> = {}) {
  return getFunctionTool(indexer, { format: 'markdown', ...input } as any);
}

async function runGetClass(indexer: Indexer, input: Record<string, unknown> = {}) {
  return getClassTool(indexer, { format: 'markdown', ...input } as any);
}

async function runSearchSymbols(indexer: Indexer, input: Record<string, unknown> = {}) {
  return searchSymbolsTool(indexer, { format: 'markdown', ...input } as any);
}

describe('MCP Tools Integration', () => {
  let indexer: Indexer;
  let tempDir: string;
  let dbPath: string;

  beforeAll(async () => {
    // Create a temp directory for the database
    tempDir = path.join(os.tmpdir(), `lazyload-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    dbPath = path.join(tempDir, 'test.db');

    // Create and initialize indexer
    indexer = new Indexer({
      rootDirectory: fixturesDir,
      databasePath: dbPath,
      include: ['**/*.ts', '**/*.py'],
      exclude: [],
    });

    await indexer.initialize();
    await indexer.indexDirectory();
  });

  afterAll(async () => {
    await indexer.close();

    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('list_files', () => {
    it('should list indexed files', async () => {
      const result = await runListFiles(indexer, {});

      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe('text');
      expect(result.content[0]?.text).toContain('sample.ts');
      expect(result.content[0]?.text).toContain('sample.py');
    });

    it('should filter by language', async () => {
      const result = await runListFiles(indexer, { language: 'typescript' });

      expect(result.content[0]?.text).toContain('sample.ts');
      expect(result.content[0]?.text).not.toContain('sample.py');
    });
  });

  describe('list_functions', () => {
    it('should list functions in a TypeScript file', async () => {
      const filePath = path.join(fixturesDir, 'typescript/sample.ts');
      const result = await runListFunctions(indexer, { filePath });

      expect(result.content[0]?.text).toContain('greet');
      expect(result.content[0]?.text).toContain('fetchUser');
      expect(result.content[0]?.text).toContain('UserService');
    });

    it('should list functions in a Python file', async () => {
      const filePath = path.join(fixturesDir, 'python/sample.py');
      const result = await runListFunctions(indexer, { filePath });

      expect(result.content[0]?.text).toContain('greet');
      expect(result.content[0]?.text).toContain('fetch_user');
      expect(result.content[0]?.text).toContain('UserService');
    });

    it('should handle non-existent files', async () => {
      const result = await runListFunctions(indexer, {
        filePath: '/nonexistent/file.ts',
      });

      expect(result.content[0]?.text).toContain('not found');
    });

    it('should support compact output format', async () => {
      const filePath = path.join(fixturesDir, 'typescript/sample.ts');
      const result = await runListFunctions(indexer, {
        filePath,
        format: 'compact',
      });

      const text = result.content[0]?.text ?? '';
      expect(text).toContain('[FILE]');
      expect(text).toContain('name\tkind\tline\texported\tasync\tsignature');
      expect(text).toContain('greet');
    });
  });

  describe('get_function', () => {
    it('should retrieve function source code', async () => {
      const filePath = path.join(fixturesDir, 'typescript/sample.ts');
      const result = await runGetFunction(indexer, {
        filePath,
        functionName: 'greet',
      });

      expect(result.content[0]?.text).toContain('greet');
      expect(result.content[0]?.text).toContain('Source Code');
      expect(result.content[0]?.text).toContain('return');
    });

    it('should retrieve class method source code', async () => {
      const filePath = path.join(fixturesDir, 'typescript/sample.ts');
      const result = await runGetFunction(indexer, {
        filePath,
        functionName: 'findById',
      });

      expect(result.content[0]?.text).toContain('findById');
    });

    it('should include context when requested', async () => {
      const filePath = path.join(fixturesDir, 'typescript/sample.ts');
      const result = await runGetFunction(indexer, {
        filePath,
        functionName: 'greet',
        includeContext: true,
        contextLines: 2,
      });

      expect(result.content[0]?.text).toContain('Source Code');
    });

    it('should handle non-existent functions', async () => {
      const filePath = path.join(fixturesDir, 'typescript/sample.ts');
      const result = await runGetFunction(indexer, {
        filePath,
        functionName: 'nonexistent',
      });

      expect(result.content[0]?.text).toContain('not found');
    });

    it('should support compact output format', async () => {
      const filePath = path.join(fixturesDir, 'typescript/sample.ts');
      const result = await runGetFunction(indexer, {
        filePath,
        functionName: 'greet',
        format: 'compact',
      });

      const text = result.content[0]?.text ?? '';
      expect(text).toContain('[FUNCTION]');
      expect(text).toContain('name\tkind\tfile\tline\tclass\tasync\texported\tsignature');
      expect(text).toContain('===SOURCE===');
      expect(text).not.toContain('# greet');
    });
  });

  describe('get_class', () => {
    it('should retrieve class source code', async () => {
      const filePath = path.join(fixturesDir, 'typescript/sample.ts');
      const result = await runGetClass(indexer, {
        filePath,
        className: 'UserService',
      });

      expect(result.content[0]?.text).toContain('UserService');
      expect(result.content[0]?.text).toContain('Source Code');
      expect(result.content[0]?.text).toContain('class UserService');
    });

    it('should show only signatures when methodsOnly is true', async () => {
      const filePath = path.join(fixturesDir, 'typescript/sample.ts');
      const result = await runGetClass(indexer, {
        filePath,
        className: 'UserService',
        methodsOnly: true,
      });

      expect(result.content[0]?.text).toContain('Signature');
      expect(result.content[0]?.text).not.toContain('Source Code');
    });

    it('should handle non-existent classes', async () => {
      const filePath = path.join(fixturesDir, 'typescript/sample.ts');
      const result = await runGetClass(indexer, {
        filePath,
        className: 'NonexistentClass',
      });

      expect(result.content[0]?.text).toContain('not found');
    });

    it('should support compact output format', async () => {
      const filePath = path.join(fixturesDir, 'typescript/sample.ts');
      const result = await runGetClass(indexer, {
        filePath,
        className: 'UserService',
        format: 'compact',
      });

      const text = result.content[0]?.text ?? '';
      expect(text).toContain('[CLASS] UserService');
      expect(text).toContain('[METHODS]');
      expect(text).toContain('[PROPERTIES]');
      expect(text).toContain('===SOURCE===');
      expect(text).not.toContain('# UserService');
    });
  });

  describe('search_symbols', () => {
    it('should search for symbols by name', async () => {
      const result = await runSearchSymbols(indexer, {
        query: 'greet',
      });

      expect(result.content[0]?.text).toContain('greet');
      expect(result.content[0]?.text).toContain('Search Results');
    });

    it('should filter by type', async () => {
      const result = await runSearchSymbols(indexer, {
        query: 'User',
        type: 'class',
      });

      expect(result.content[0]?.text).toContain('UserService');
    });

    it('should filter by language', async () => {
      const result = await runSearchSymbols(indexer, {
        query: 'greet',
        language: 'typescript',
      });

      expect(result.content[0]?.text).toContain('.ts');
      expect(result.content[0]?.text).not.toContain('.py');
    });

    it('should handle no results', async () => {
      const result = await runSearchSymbols(indexer, {
        query: 'xyznonexistent123',
      });

      // Short error message now
      expect(result.content[0]?.text).toContain('No matches for');
    });

    it('should support fuzzy matching', async () => {
      const result = await runSearchSymbols(indexer, {
        query: 'usrserv', // Fuzzy match for UserService
      });

      // Should find UserService even with typo
      expect(result.content[0]?.text.toLowerCase()).toContain('user');
    });

    it('should support type-based search without query', async () => {
      const result = await runSearchSymbols(indexer, {
        return_type: 'User',
      });

      expect(result.content[0]?.text).toContain('Type-Based Search Results');
      expect(result.content[0]?.text).toContain('fetchUser');
    });

    it('should reject incompatible symbol type filter in type mode', async () => {
      const result = await runSearchSymbols(indexer, {
        return_type: 'User',
        type: 'class',
      });

      expect(result.content[0]?.text).toContain('Type-based search only supports');
    });
  });
});
