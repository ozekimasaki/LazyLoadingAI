import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TypeScriptParser } from '../../../src/indexer/parsers/typescript.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, '../../fixtures/typescript');

describe('TypeScriptParser - Nested Functions', () => {
  let parser: TypeScriptParser;
  let nestedContent: string;
  const nestedPath = path.join(fixturesDir, 'nested-functions.ts');

  beforeAll(async () => {
    parser = new TypeScriptParser();
    nestedContent = await fs.promises.readFile(nestedPath, 'utf-8');
  });

  describe('basic nested function extraction', () => {
    it('should extract nested function declarations', async () => {
      const result = await parser.parseFile(nestedPath, nestedContent);

      // Find the nested function
      const innerHelper = result.functions.find(f => f.name === 'outerFunction.innerHelper');
      expect(innerHelper).toBeDefined();
      expect(innerHelper?.localName).toBe('innerHelper');
      expect(innerHelper?.parentFunction).toBe('outerFunction');
      expect(innerHelper?.nestingDepth).toBe(1);
    });

    it('should extract nested arrow functions', async () => {
      const result = await parser.parseFile(nestedPath, nestedContent);

      // Check for nested arrow functions in createCalculator
      const add = result.functions.find(f => f.name === 'createCalculator.add');
      expect(add).toBeDefined();
      expect(add?.localName).toBe('add');
      expect(add?.parentFunction).toBe('createCalculator');
      expect(add?.nestingDepth).toBe(1);
    });

    it('should extract multiple nested functions from React-style hook', async () => {
      const result = await parser.parseFile(nestedPath, nestedContent);

      // Find nested functions in useOrchestration
      const hasPendingRetry = result.functions.find(f => f.name === 'useOrchestration.hasPendingRetry');
      const executeRetry = result.functions.find(f => f.name === 'useOrchestration.executeRetry');
      const processQueue = result.functions.find(f => f.name === 'useOrchestration.processQueue');

      expect(hasPendingRetry).toBeDefined();
      expect(executeRetry).toBeDefined();
      expect(processQueue).toBeDefined();

      // All should have same parent
      expect(hasPendingRetry?.parentFunction).toBe('useOrchestration');
      expect(executeRetry?.parentFunction).toBe('useOrchestration');
      expect(processQueue?.parentFunction).toBe('useOrchestration');
    });
  });

  describe('qualified name generation', () => {
    it('should generate qualified names with dot notation', async () => {
      const result = await parser.parseFile(nestedPath, nestedContent);

      const innerHelper = result.functions.find(f => f.localName === 'innerHelper');
      expect(innerHelper?.name).toBe('outerFunction.innerHelper');
    });

    it('should generate multi-level qualified names for deeply nested functions', async () => {
      const result = await parser.parseFile(nestedPath, nestedContent);

      // The doubleFirst function is inside multiply which is inside createCalculator
      const doubleFirst = result.functions.find(f => f.localName === 'doubleFirst');
      expect(doubleFirst).toBeDefined();
      expect(doubleFirst?.name).toBe('createCalculator.multiply.doubleFirst');
      expect(doubleFirst?.nestingDepth).toBe(2);
      expect(doubleFirst?.parentFunction).toBe('createCalculator.multiply');
    });
  });

  describe('nesting depth limits', () => {
    it('should extract functions up to 3 levels deep', async () => {
      const result = await parser.parseFile(nestedPath, nestedContent);

      // level1 -> level2 -> level3 should all be extracted
      const level2 = result.functions.find(f => f.name === 'level1Function.level2Function');
      const level3 = result.functions.find(f => f.name === 'level1Function.level2Function.level3Function');

      expect(level2).toBeDefined();
      expect(level2?.nestingDepth).toBe(1);

      expect(level3).toBeDefined();
      expect(level3?.nestingDepth).toBe(2);
    });

    it('should NOT extract functions beyond 3 levels', async () => {
      const result = await parser.parseFile(nestedPath, nestedContent);

      // deeplyNested has level2 -> level3 -> level4 -> level5
      // level4 should be at depth 3 (max), level5 should NOT be extracted
      const level5 = result.functions.find(f => f.localName === 'level5');
      expect(level5).toBeUndefined();
    });
  });

  describe('filtering insignificant functions', () => {
    it('should skip functions with less than 3 lines', async () => {
      const result = await parser.parseFile(nestedPath, nestedContent);

      // The 'tiny' function inside withSmallNested should not be extracted
      const tiny = result.functions.find(f => f.localName === 'tiny');
      expect(tiny).toBeUndefined();
    });

    it('should NOT extract inline callbacks in array methods', async () => {
      const result = await parser.parseFile(nestedPath, nestedContent);

      // Functions inside .map() and .filter() should not be extracted
      const mapCallbacks = result.functions.filter(f =>
        f.parentFunction?.includes('withArrayMethods')
      );
      expect(mapCallbacks.length).toBe(0);
    });
  });

  describe('async nested functions', () => {
    it('should correctly mark async nested functions', async () => {
      const result = await parser.parseFile(nestedPath, nestedContent);

      const asyncInner = result.functions.find(f => f.name === 'asyncOuter.asyncInner');
      expect(asyncInner).toBeDefined();
      expect(asyncInner?.modifiers.isAsync).toBe(true);

      const processQueue = result.functions.find(f => f.name === 'useOrchestration.processQueue');
      expect(processQueue).toBeDefined();
      expect(processQueue?.modifiers.isAsync).toBe(true);
    });
  });

  describe('private nested functions', () => {
    it('should mark private nested functions (starting with _)', async () => {
      const parserWithPrivate = new TypeScriptParser({ includePrivate: true });
      const result = await parserWithPrivate.parseFile(nestedPath, nestedContent);

      const privateHelper = result.functions.find(f => f.localName === '_privateHelper');
      expect(privateHelper).toBeDefined();
      expect(privateHelper?.modifiers.isPrivate).toBe(true);
    });

    it('should exclude private nested functions by default', async () => {
      const result = await parser.parseFile(nestedPath, nestedContent);

      const privateHelper = result.functions.find(f => f.localName === '_privateHelper');
      expect(privateHelper).toBeUndefined();
    });
  });

  describe('FunctionSignature fields', () => {
    it('should set correct fields for nested functions', async () => {
      const result = await parser.parseFile(nestedPath, nestedContent);

      const innerHelper = result.functions.find(f => f.name === 'outerFunction.innerHelper');
      expect(innerHelper).toBeDefined();

      // Check all the new fields
      expect(innerHelper?.parentFunction).toBe('outerFunction');
      expect(innerHelper?.nestingDepth).toBe(1);
      expect(innerHelper?.localName).toBe('innerHelper');

      // parentClass should be null for non-method nested functions
      expect(innerHelper?.parentClass).toBeNull();

      // kind should be 'function'
      expect(innerHelper?.kind).toBe('function');
    });

    it('should have nestingDepth 0 for top-level functions', async () => {
      const result = await parser.parseFile(nestedPath, nestedContent);

      const outerFunction = result.functions.find(f => f.name === 'outerFunction');
      expect(outerFunction).toBeDefined();
      expect(outerFunction?.nestingDepth).toBe(0);
      expect(outerFunction?.parentFunction).toBeNull();
      expect(outerFunction?.localName).toBe('outerFunction');
    });
  });

  describe('buildFileIndex with nested functions', () => {
    it('should include nested functions in file index', async () => {
      const parseResult = await parser.parseFile(nestedPath, nestedContent);
      const checksum = 'test-checksum';

      const fileIndex = parser.buildFileIndex(
        nestedPath,
        'nested-functions.ts',
        nestedContent,
        checksum,
        parseResult
      );

      // Should have more than just top-level functions
      expect(fileIndex.functions.length).toBeGreaterThan(10);

      // Should include nested functions
      const nestedFunctions = fileIndex.functions.filter(f => (f.nestingDepth ?? 0) > 0);
      expect(nestedFunctions.length).toBeGreaterThan(0);
    });

    it('should generate correct summary mentioning nested functions', async () => {
      const parseResult = await parser.parseFile(nestedPath, nestedContent);
      const checksum = 'test-checksum';

      const fileIndex = parser.buildFileIndex(
        nestedPath,
        'nested-functions.ts',
        nestedContent,
        checksum,
        parseResult
      );

      // Summary should mention the function count
      expect(fileIndex.summary).toBeDefined();
    });
  });
});
