import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TypeScriptParser } from '../../../src/indexer/parsers/typescript.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, '../../fixtures/typescript');

describe('TypeScriptParser', () => {
  let parser: TypeScriptParser;
  let sampleContent: string;
  const samplePath = path.join(fixturesDir, 'sample.ts');

  beforeAll(async () => {
    parser = new TypeScriptParser();
    sampleContent = await fs.promises.readFile(samplePath, 'utf-8');
  });

  describe('canParse', () => {
    it('should return true for TypeScript files', () => {
      expect(parser.canParse('test.ts')).toBe(true);
      expect(parser.canParse('test.tsx')).toBe(true);
      expect(parser.canParse('test.mts')).toBe(true);
    });

    it('should return true for JavaScript files', () => {
      expect(parser.canParse('test.js')).toBe(true);
      expect(parser.canParse('test.jsx')).toBe(true);
      expect(parser.canParse('test.mjs')).toBe(true);
    });

    it('should return false for non-JS/TS files', () => {
      expect(parser.canParse('test.py')).toBe(false);
      expect(parser.canParse('test.rb')).toBe(false);
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
      expect(greet?.parameters[0]?.type).toBe('string');
      expect(greet?.returnType).toBe('string');
      expect(greet?.modifiers.isExported).toBe(true);
    });

    it('should extract async functions', async () => {
      const result = await parser.parseFile(samplePath, sampleContent);

      const fetchUser = result.functions.find(f => f.name === 'fetchUser');
      expect(fetchUser).toBeDefined();
      expect(fetchUser?.modifiers.isAsync).toBe(true);
      expect(fetchUser?.returnType).toContain('Promise');
    });

    it('should extract arrow functions assigned to consts', async () => {
      const result = await parser.parseFile(samplePath, sampleContent);

      const multiply = result.functions.find(f => f.name === 'multiply');
      expect(multiply).toBeDefined();
      expect(multiply?.kind).toBe('function');
      expect(multiply?.parameters).toHaveLength(2);
    });

    it('should extract classes', async () => {
      const result = await parser.parseFile(samplePath, sampleContent);

      const userService = result.classes.find(c => c.name === 'UserService');
      expect(userService).toBeDefined();
      expect(userService?.extends).toBe('EventEmitter');
      expect(userService?.implements).toContain('Repository<User>');
      expect(userService?.methods.length).toBeGreaterThan(0);
      expect(userService?.properties.length).toBeGreaterThan(0);
    });

    it('should extract class methods', async () => {
      const result = await parser.parseFile(samplePath, sampleContent);

      const userService = result.classes.find(c => c.name === 'UserService');
      const findById = userService?.methods.find(m => m.name === 'findById');

      expect(findById).toBeDefined();
      expect(findById?.kind).toBe('method');
      expect(findById?.modifiers.isAsync).toBe(true);
      expect(findById?.parentClass).toBe('UserService');
    });

    it('should extract static methods', async () => {
      const result = await parser.parseFile(samplePath, sampleContent);

      const userService = result.classes.find(c => c.name === 'UserService');
      const create = userService?.methods.find(m => m.name === 'create');

      expect(create).toBeDefined();
      expect(create?.modifiers.isStatic).toBe(true);
    });

    it('should extract interfaces', async () => {
      const result = await parser.parseFile(samplePath, sampleContent);

      const user = result.interfaces.find(i => i.name === 'User');
      expect(user).toBeDefined();
      expect(user?.properties).toHaveLength(4);

      const repository = result.interfaces.find(i => i.name === 'Repository');
      expect(repository).toBeDefined();
      expect(repository?.typeParameters).toContain('T');
      expect(repository?.methods.length).toBe(4);
    });

    it('should extract type aliases', async () => {
      const result = await parser.parseFile(samplePath, sampleContent);

      const userId = result.typeAliases.find(t => t.name === 'UserId');
      expect(userId).toBeDefined();
      expect(userId?.type).toBe('string');
      expect(userId?.isExported).toBe(true);
    });

    it('should extract imports', async () => {
      const result = await parser.parseFile(samplePath, sampleContent);

      expect(result.imports.length).toBeGreaterThan(0);
      const eventsImport = result.imports.find(i => i.source === 'node:events');
      expect(eventsImport).toBeDefined();
    });

    it('should extract exports', async () => {
      const result = await parser.parseFile(samplePath, sampleContent);

      // Note: Direct exports (export function, export class) are detected via isExported flag
      // The exports array captures re-exports and default exports
      // Verify exported functions are marked correctly instead
      const exportedFuncs = result.functions.filter(f => f.modifiers.isExported);
      expect(exportedFuncs.length).toBeGreaterThan(0);
    });

    it('should extract JSDoc documentation', async () => {
      const result = await parser.parseFile(samplePath, sampleContent);

      const greet = result.functions.find(f => f.name === 'greet');
      expect(greet?.documentation).toBeDefined();
      expect(greet?.documentation?.description).toContain('greeting');
      expect(greet?.documentation?.params).toHaveLength(1);
      expect(greet?.documentation?.returns).toBeDefined();
    });

    it('should not include private functions by default', async () => {
      const result = await parser.parseFile(samplePath, sampleContent);

      const privateHelper = result.functions.find(f => f.name === '_privateHelper');
      expect(privateHelper).toBeUndefined();
    });

    it('should include private functions when option is set', async () => {
      const parserWithPrivate = new TypeScriptParser({ includePrivate: true });
      const result = await parserWithPrivate.parseFile(samplePath, sampleContent);

      const privateHelper = result.functions.find(f => f.name === '_privateHelper');
      expect(privateHelper).toBeDefined();
    });

    it('should extract abstract classes', async () => {
      const result = await parser.parseFile(samplePath, sampleContent);

      const baseEntity = result.classes.find(c => c.name === 'BaseEntity');
      expect(baseEntity).toBeDefined();
      expect(baseEntity?.isAbstract).toBe(true);
    });

    it('should extract generic functions', async () => {
      const result = await parser.parseFile(samplePath, sampleContent);

      const createPair = result.functions.find(f => f.name === 'createPair');
      expect(createPair).toBeDefined();
      expect(createPair?.typeParameters).toContain('T');
      expect(createPair?.typeParameters).toContain('U');
    });
  });

  describe('buildFileIndex', () => {
    it('should build a complete file index', async () => {
      const parseResult = await parser.parseFile(samplePath, sampleContent);
      const checksum = 'test-checksum';

      const fileIndex = parser.buildFileIndex(
        samplePath,
        'sample.ts',
        sampleContent,
        checksum,
        parseResult
      );

      expect(fileIndex.filePath).toBe(samplePath);
      expect(fileIndex.relativePath).toBe('sample.ts');
      expect(fileIndex.language).toBe('typescript');
      expect(fileIndex.checksum).toBe(checksum);
      expect(fileIndex.functions.length).toBeGreaterThan(0);
      expect(fileIndex.classes.length).toBeGreaterThan(0);
      expect(fileIndex.interfaces.length).toBeGreaterThan(0);
      expect(fileIndex.lineCount).toBeGreaterThan(0);
      expect(fileIndex.summary).toBeDefined();
    });
  });

  describe('callback extraction', () => {
    let callbacksContent: string;
    const callbacksPath = path.join(fixturesDir, 'callbacks.ts');

    beforeAll(async () => {
      callbacksContent = await fs.promises.readFile(callbacksPath, 'utf-8');
    });

    it('should extract describe/it test callbacks', async () => {
      const result = await parser.parseFile(callbacksPath, callbacksContent);

      const callbacks = result.functions.filter(f => f.kind === 'callback');
      const describeCallbacks = callbacks.filter(f => f.modifiers.callbackContext === 'describe');
      const itCallbacks = callbacks.filter(f => f.modifiers.callbackContext === 'it');
      const testCallbacks = callbacks.filter(f => f.modifiers.callbackContext === 'test');

      expect(describeCallbacks.length).toBeGreaterThanOrEqual(2); // 'UserService' and 'nested describe'
      expect(itCallbacks.length).toBeGreaterThanOrEqual(2); // 'should create a user' and 'should work nested'
      expect(testCallbacks.length).toBeGreaterThanOrEqual(1); // 'handles errors gracefully'
    });

    it('should extract beforeAll/afterEach callbacks', async () => {
      const result = await parser.parseFile(callbacksPath, callbacksContent);

      const callbacks = result.functions.filter(f => f.kind === 'callback');
      const beforeAllCallbacks = callbacks.filter(f => f.modifiers.callbackContext === 'beforeAll');
      const afterEachCallbacks = callbacks.filter(f => f.modifiers.callbackContext === 'afterEach');

      expect(beforeAllCallbacks.length).toBeGreaterThanOrEqual(1);
      expect(afterEachCallbacks.length).toBeGreaterThanOrEqual(1);
    });

    it('should extract event handler callbacks', async () => {
      const result = await parser.parseFile(callbacksPath, callbacksContent);

      const callbacks = result.functions.filter(f => f.kind === 'callback');
      const onCallbacks = callbacks.filter(f => f.modifiers.callbackContext?.startsWith('on:'));
      const onceCallbacks = callbacks.filter(f => f.modifiers.callbackContext?.startsWith('once:'));

      expect(onCallbacks.length).toBeGreaterThanOrEqual(1); // on('data', ...)
      expect(onceCallbacks.length).toBeGreaterThanOrEqual(1); // once('ready', ...)
    });

    it('should extract promise chain callbacks', async () => {
      const result = await parser.parseFile(callbacksPath, callbacksContent);

      const callbacks = result.functions.filter(f => f.kind === 'callback');
      const thenCallbacks = callbacks.filter(f => f.modifiers.callbackContext === 'then');
      const catchCallbacks = callbacks.filter(f => f.modifiers.callbackContext === 'catch');
      const finallyCallbacks = callbacks.filter(f => f.modifiers.callbackContext === 'finally');

      expect(thenCallbacks.length).toBeGreaterThanOrEqual(1);
      expect(catchCallbacks.length).toBeGreaterThanOrEqual(1);
      expect(finallyCallbacks.length).toBeGreaterThanOrEqual(1);
    });

    it('should extract CLI action callbacks', async () => {
      const result = await parser.parseFile(callbacksPath, callbacksContent);

      const callbacks = result.functions.filter(f => f.kind === 'callback');
      const actionCallbacks = callbacks.filter(f => f.modifiers.callbackContext === 'action');

      expect(actionCallbacks.length).toBeGreaterThanOrEqual(1);
    });

    it('should NOT extract array method callbacks', async () => {
      const result = await parser.parseFile(callbacksPath, callbacksContent);

      const callbacks = result.functions.filter(f => f.kind === 'callback');
      const mapCallbacks = callbacks.filter(f => f.modifiers.callbackContext === 'map');
      const filterCallbacks = callbacks.filter(f => f.modifiers.callbackContext === 'filter');
      const reduceCallbacks = callbacks.filter(f => f.modifiers.callbackContext === 'reduce');

      expect(mapCallbacks.length).toBe(0);
      expect(filterCallbacks.length).toBe(0);
      expect(reduceCallbacks.length).toBe(0);
    });

    it('should still extract regular functions alongside callbacks', async () => {
      const result = await parser.parseFile(callbacksPath, callbacksContent);

      const regularFunctions = result.functions.filter(f => f.kind === 'function');
      const regularFunctionNames = regularFunctions.map(f => f.name);

      expect(regularFunctionNames).toContain('regularFunction');
      expect(regularFunctionNames).toContain('arrowFunction');
    });

    it('should generate correct summary with callbacks', async () => {
      const parseResult = await parser.parseFile(callbacksPath, callbacksContent);
      const checksum = 'test-checksum';

      const fileIndex = parser.buildFileIndex(
        callbacksPath,
        'callbacks.ts',
        callbacksContent,
        checksum,
        parseResult
      );

      // Summary should mention test functions
      expect(fileIndex.summary).toContain('test functions');
    });
  });
});
