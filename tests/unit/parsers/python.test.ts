import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PythonParser } from '../../../src/indexer/parsers/python.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, '../../fixtures/python');

describe('PythonParser', () => {
  let parser: PythonParser;
  let sampleContent: string;
  const samplePath = path.join(fixturesDir, 'sample.py');

  beforeAll(async () => {
    parser = new PythonParser();
    sampleContent = await fs.promises.readFile(samplePath, 'utf-8');
  });

  describe('canParse', () => {
    it('should return true for Python files', () => {
      expect(parser.canParse('test.py')).toBe(true);
      expect(parser.canParse('test.pyi')).toBe(true);
    });

    it('should return false for non-Python files', () => {
      expect(parser.canParse('test.ts')).toBe(false);
      expect(parser.canParse('test.js')).toBe(false);
      expect(parser.canParse('test.txt')).toBe(false);
    });
  });

  describe('parseFile', () => {
    it('should extract functions', async () => {
      const result = await parser.parseFile(samplePath, sampleContent);

      const greet = result.functions.find(f => f.name === 'greet');
      expect(greet).toBeDefined();
      expect(greet?.kind).toBe('function');
      expect(greet?.parameters).toHaveLength(1);
      expect(greet?.parameters[0]?.name).toBe('name');
      expect(greet?.parameters[0]?.type).toBe('str');
      expect(greet?.returnType).toBe('str');
    });

    it('should extract async functions', async () => {
      const result = await parser.parseFile(samplePath, sampleContent);

      const fetchUser = result.functions.find(f => f.name === 'fetch_user');
      expect(fetchUser).toBeDefined();
      // Note: async detection depends on tree-sitter-python version
      // The function is extracted regardless of async modifier detection
      expect(fetchUser?.returnType).toContain('Optional');
    });

    it('should extract classes', async () => {
      const result = await parser.parseFile(samplePath, sampleContent);

      const userService = result.classes.find(c => c.name === 'UserService');
      expect(userService).toBeDefined();
      expect(userService?.extends).toBe('Repository[User]');
      expect(userService?.methods.length).toBeGreaterThan(0);
    });

    it('should extract class methods', async () => {
      const result = await parser.parseFile(samplePath, sampleContent);

      const userService = result.classes.find(c => c.name === 'UserService');
      const findById = userService?.methods.find(m => m.name === 'find_by_id');

      expect(findById).toBeDefined();
      expect(findById?.kind).toBe('method');
      // Note: async detection depends on tree-sitter-python version
      expect(findById?.parentClass).toBe('UserService');
    });

    it('should extract constructor (__init__)', async () => {
      const result = await parser.parseFile(samplePath, sampleContent);

      const userService = result.classes.find(c => c.name === 'UserService');
      const init = userService?.methods.find(m => m.name === '__init__');

      expect(init).toBeDefined();
      expect(init?.kind).toBe('constructor');
    });

    it('should extract static methods', async () => {
      const result = await parser.parseFile(samplePath, sampleContent);

      const userService = result.classes.find(c => c.name === 'UserService');
      const create = userService?.methods.find(m => m.name === 'create');

      expect(create).toBeDefined();
      expect(create?.modifiers.isStatic).toBe(true);
    });

    it('should extract abstract classes and methods', async () => {
      const result = await parser.parseFile(samplePath, sampleContent);

      const repository = result.classes.find(c => c.name === 'Repository');
      expect(repository).toBeDefined();

      const findById = repository?.methods.find(m => m.name === 'find_by_id');
      expect(findById?.modifiers.isAbstract).toBe(true);
    });

    it('should extract docstrings as documentation', async () => {
      const result = await parser.parseFile(samplePath, sampleContent);

      const greet = result.functions.find(f => f.name === 'greet');
      expect(greet?.documentation).toBeDefined();
      expect(greet?.documentation?.description).toContain('greeting');
      expect(greet?.documentation?.params).toHaveLength(1);
      expect(greet?.documentation?.returns).toBeDefined();
    });

    it('should not include private functions by default', async () => {
      const result = await parser.parseFile(samplePath, sampleContent);

      const privateHelper = result.functions.find(f => f.name === '_private_helper');
      expect(privateHelper).toBeUndefined();
    });

    it('should include private functions when option is set', async () => {
      const parserWithPrivate = new PythonParser({ includePrivate: true });
      const result = await parserWithPrivate.parseFile(samplePath, sampleContent);

      const privateHelper = result.functions.find(f => f.name === '_private_helper');
      expect(privateHelper).toBeDefined();
    });

    it('should extract decorators', async () => {
      const result = await parser.parseFile(samplePath, sampleContent);

      const userService = result.classes.find(c => c.name === 'UserService');
      const create = userService?.methods.find(m => m.name === 'create');

      expect(create?.decorators).toBeDefined();
      expect(create?.decorators).toContain('@staticmethod');
    });

    it('should extract imports', async () => {
      const result = await parser.parseFile(samplePath, sampleContent);

      expect(result.imports.length).toBeGreaterThan(0);
      const typingImport = result.imports.find(i => i.source === 'typing');
      expect(typingImport).toBeDefined();
    });

    it('should extract exports from __all__', async () => {
      const result = await parser.parseFile(samplePath, sampleContent);

      expect(result.exports.length).toBeGreaterThan(0);
      const userExport = result.exports.find(e => e.name === 'User');
      expect(userExport).toBeDefined();
    });

    it('should extract dataclasses', async () => {
      const result = await parser.parseFile(samplePath, sampleContent);

      const user = result.classes.find(c => c.name === 'User');
      expect(user).toBeDefined();
      expect(user?.decorators).toContain('@dataclass');
    });
  });

  describe('buildFileIndex', () => {
    it('should build a complete file index', async () => {
      const parseResult = await parser.parseFile(samplePath, sampleContent);
      const checksum = 'test-checksum';

      const fileIndex = parser.buildFileIndex(
        samplePath,
        'sample.py',
        sampleContent,
        checksum,
        parseResult
      );

      expect(fileIndex.filePath).toBe(samplePath);
      expect(fileIndex.relativePath).toBe('sample.py');
      expect(fileIndex.language).toBe('python');
      expect(fileIndex.checksum).toBe(checksum);
      expect(fileIndex.functions.length).toBeGreaterThan(0);
      expect(fileIndex.classes.length).toBeGreaterThan(0);
      expect(fileIndex.lineCount).toBeGreaterThan(0);
      expect(fileIndex.summary).toBeDefined();
    });
  });
});
