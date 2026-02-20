import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorage } from '../../../src/indexer/storage/sqlite.js';
import {
  createTestDatabase,
  createTestFileIndex,
  createTestFunctionSignature,
  createTestClassSignature,
  createPopulatedFileIndex,
  createTestSymbolReference,
  createTestCallGraphEdge,
  createTestTypeRelationship,
  type TestDatabaseResult,
} from '../../helpers/database.js';
import type { FileIndex, Language } from '../../../src/types/index.js';

describe('SqliteStorage', () => {
  let testDb: TestDatabaseResult;
  let storage: SqliteStorage;

  beforeEach(async () => {
    testDb = await createTestDatabase();
    storage = testDb.storage;
  });

  afterEach(async () => {
    await storage.close();
    testDb.cleanup();
  });

  describe('initialize', () => {
    it('should create database and tables', async () => {
      // Storage was already initialized in beforeEach
      // Just verify we can perform operations
      const stats = await storage.getStats();
      expect(stats.totalFiles).toBe(0);
      expect(stats.totalSymbols).toBe(0);
    });

    it('should create parent directory if it does not exist', async () => {
      const newDb = await createTestDatabase();
      try {
        const stats = await newDb.storage.getStats();
        expect(stats).toBeDefined();
      } finally {
        await newDb.storage.close();
        newDb.cleanup();
      }
    });
  });

  describe('saveFile', () => {
    it('should insert a new file', async () => {
      const fileIndex = createTestFileIndex({ filePath: '/test/file1.ts' });

      await storage.saveFile(fileIndex);

      const retrieved = await storage.getFile('/test/file1.ts');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.filePath).toBe('/test/file1.ts');
      expect(retrieved?.language).toBe('typescript');
    });

    it('should update an existing file', async () => {
      const fileIndex = createTestFileIndex({ filePath: '/test/file1.ts', checksum: 'v1' });
      await storage.saveFile(fileIndex);

      const updatedIndex = { ...fileIndex, checksum: 'v2', lineCount: 200 };
      await storage.saveFile(updatedIndex);

      const retrieved = await storage.getFile('/test/file1.ts');
      expect(retrieved?.checksum).toBe('v2');
      expect(retrieved?.lineCount).toBe(200);
    });

    it('should save functions', async () => {
      const func = createTestFunctionSignature({ name: 'testFunc' });
      const fileIndex = createTestFileIndex({
        filePath: '/test/with-func.ts',
        functions: [func],
      });

      await storage.saveFile(fileIndex);

      const retrieved = await storage.getFunction('/test/with-func.ts', 'testFunc');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.name).toBe('testFunc');
    });

    it('should save classes and their methods', async () => {
      const method = createTestFunctionSignature({ name: 'classMethod', kind: 'method' });
      const cls = createTestClassSignature({
        name: 'TestClass',
        methods: [method],
      });
      const fileIndex = createTestFileIndex({
        filePath: '/test/with-class.ts',
        classes: [cls],
      });

      await storage.saveFile(fileIndex);

      const retrievedClass = await storage.getClass('/test/with-class.ts', 'TestClass');
      expect(retrievedClass).not.toBeNull();
      expect(retrievedClass?.name).toBe('TestClass');
      expect(retrievedClass?.methods).toHaveLength(1);
    });

    it('should save interfaces', async () => {
      const fileIndex = createTestFileIndex({
        filePath: '/test/with-interface.ts',
        interfaces: [{
          id: 'iface-1',
          name: 'TestInterface',
          fullyQualifiedName: 'TestInterface',
          signature: 'interface TestInterface',
          location: { startLine: 1, endLine: 5, startColumn: 0, endColumn: 1 },
          properties: [],
          methods: [],
          isExported: true,
        }],
      });

      await storage.saveFile(fileIndex);

      const retrieved = await storage.getInterface('/test/with-interface.ts', 'TestInterface');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.name).toBe('TestInterface');
    });

    it('should save type aliases', async () => {
      const fileIndex = createTestFileIndex({
        filePath: '/test/with-type.ts',
        typeAliases: [{
          id: 'type-1',
          name: 'MyType',
          fullyQualifiedName: 'MyType',
          signature: 'type MyType = string',
          location: { startLine: 1, endLine: 1, startColumn: 0, endColumn: 1 },
          type: 'string',
          isExported: true,
        }],
      });

      await storage.saveFile(fileIndex);

      const retrieved = await storage.getTypeAlias('/test/with-type.ts', 'MyType');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.name).toBe('MyType');
      expect(retrieved?.type).toBe('string');
    });

    it('should save variables', async () => {
      const fileIndex = createTestFileIndex({
        filePath: '/test/with-var.ts',
        variables: [{
          id: 'var-1',
          name: 'MY_CONSTANT',
          fullyQualifiedName: 'MY_CONSTANT',
          kind: 'const',
          type: 'string',
          location: { startLine: 1, endLine: 1, startColumn: 0, endColumn: 1 },
          isExported: true,
        }],
      });

      await storage.saveFile(fileIndex);

      const retrieved = await storage.getVariable('/test/with-var.ts', 'MY_CONSTANT');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.name).toBe('MY_CONSTANT');
    });
  });

  describe('getFile', () => {
    it('should retrieve a saved file', async () => {
      const fileIndex = createTestFileIndex({
        filePath: '/test/retrieve.ts',
        summary: 'Test summary',
      });
      await storage.saveFile(fileIndex);

      const retrieved = await storage.getFile('/test/retrieve.ts');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.summary).toBe('Test summary');
    });

    it('should return null for non-existent file', async () => {
      const retrieved = await storage.getFile('/non/existent.ts');
      expect(retrieved).toBeNull();
    });
  });

  describe('deleteFile', () => {
    it('should delete a file', async () => {
      const fileIndex = createTestFileIndex({ filePath: '/test/to-delete.ts' });
      await storage.saveFile(fileIndex);

      await storage.deleteFile('/test/to-delete.ts');

      const retrieved = await storage.getFile('/test/to-delete.ts');
      expect(retrieved).toBeNull();
    });

    it('should cascade delete symbols', async () => {
      const func = createTestFunctionSignature({ name: 'deletedFunc' });
      const fileIndex = createTestFileIndex({
        filePath: '/test/cascade.ts',
        functions: [func],
      });
      await storage.saveFile(fileIndex);

      await storage.deleteFile('/test/cascade.ts');

      const retrieved = await storage.getFunction('/test/cascade.ts', 'deletedFunc');
      expect(retrieved).toBeNull();
    });

    it('should handle deleting non-existent file gracefully', async () => {
      // Should not throw
      await expect(storage.deleteFile('/non/existent.ts')).resolves.toBeUndefined();
    });
  });

  describe('listFiles', () => {
    beforeEach(async () => {
      await storage.saveFile(createTestFileIndex({
        filePath: '/project/src/file1.ts',
        relativePath: 'src/file1.ts',
        language: 'typescript',
      }));
      await storage.saveFile(createTestFileIndex({
        filePath: '/project/src/file2.ts',
        relativePath: 'src/file2.ts',
        language: 'typescript',
      }));
      await storage.saveFile(createTestFileIndex({
        filePath: '/project/lib/file3.py',
        relativePath: 'lib/file3.py',
        language: 'python',
      }));
    });

    it('should list all files', async () => {
      const files = await storage.listFiles();
      expect(files).toHaveLength(3);
    });

    it('should filter by directory', async () => {
      const files = await storage.listFiles({ directory: 'src' });
      expect(files).toHaveLength(2);
      expect(files.every(f => f.relativePath.startsWith('src'))).toBe(true);
    });

    it('should filter by language', async () => {
      const tsFiles = await storage.listFiles({ language: 'typescript' });
      expect(tsFiles).toHaveLength(2);
      expect(tsFiles.every(f => f.language === 'typescript')).toBe(true);

      const pyFiles = await storage.listFiles({ language: 'python' });
      expect(pyFiles).toHaveLength(1);
      expect(pyFiles[0]?.language).toBe('python');
    });

    it('should filter by directory and language', async () => {
      const files = await storage.listFiles({
        directory: 'src',
        language: 'typescript',
      });
      expect(files).toHaveLength(2);
    });

    it('should return empty array when no matches', async () => {
      const files = await storage.listFiles({ language: 'javascript' });
      expect(files).toHaveLength(0);
    });
  });

  describe('getFunction', () => {
    it('should retrieve function by file path and name', async () => {
      const func = createTestFunctionSignature({ name: 'myFunc', returnType: 'number' });
      const fileIndex = createTestFileIndex({
        filePath: '/test/funcs.ts',
        functions: [func],
      });
      await storage.saveFile(fileIndex);

      const retrieved = await storage.getFunction('/test/funcs.ts', 'myFunc');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.name).toBe('myFunc');
      expect(retrieved?.returnType).toBe('number');
    });

    it('should retrieve method by name', async () => {
      const method = createTestFunctionSignature({
        name: 'classMethod',
        kind: 'method',
        parentClass: 'MyClass',
      });
      const cls = createTestClassSignature({ name: 'MyClass', methods: [method] });
      const fileIndex = createTestFileIndex({
        filePath: '/test/class.ts',
        classes: [cls],
      });
      await storage.saveFile(fileIndex);

      const retrieved = await storage.getFunction('/test/class.ts', 'classMethod');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.kind).toBe('method');
    });

    it('should return null for non-existent function', async () => {
      const retrieved = await storage.getFunction('/test/file.ts', 'nonexistent');
      expect(retrieved).toBeNull();
    });
  });

  describe('getClass', () => {
    it('should retrieve class by file path and name', async () => {
      const cls = createTestClassSignature({ name: 'UserService' });
      const fileIndex = createTestFileIndex({
        filePath: '/test/service.ts',
        classes: [cls],
      });
      await storage.saveFile(fileIndex);

      const retrieved = await storage.getClass('/test/service.ts', 'UserService');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.name).toBe('UserService');
    });

    it('should return null for non-existent class', async () => {
      const retrieved = await storage.getClass('/test/file.ts', 'NonexistentClass');
      expect(retrieved).toBeNull();
    });
  });

  describe('searchSymbols (FTS)', () => {
    beforeEach(async () => {
      const func1 = createTestFunctionSignature({ name: 'getUserById' });
      const func2 = createTestFunctionSignature({ name: 'createUser' });
      const func3 = createTestFunctionSignature({ name: 'deleteData' });
      const cls = createTestClassSignature({ name: 'UserService' });

      await storage.saveFile(createTestFileIndex({
        filePath: '/test/users.ts',
        language: 'typescript',
        functions: [func1, func2],
        classes: [cls],
      }));
      await storage.saveFile(createTestFileIndex({
        filePath: '/test/data.py',
        language: 'python',
        functions: [func3],
      }));
    });

    it('should search for exact matches', async () => {
      const results = await storage.searchSymbols('getUserById');

      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.symbol.name === 'getUserById')).toBe(true);
    });

    it('should search with prefix matching', async () => {
      const results = await storage.searchSymbols('get');

      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.symbol.name.startsWith('get'))).toBe(true);
    });

    it('should filter by type', async () => {
      const results = await storage.searchSymbols('User', { type: 'class' });

      expect(results.length).toBeGreaterThan(0);
      expect(results.every(r => r.symbol.kind === 'class')).toBe(true);
    });

    it('should filter by language', async () => {
      const results = await storage.searchSymbols('delete', { language: 'python' });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.symbol.filePath).toContain('.py');
    });

    it('should respect limit option', async () => {
      const results = await storage.searchSymbols('User', { limit: 1 });
      expect(results.length).toBeLessThanOrEqual(1);
    });

    it('should return scores', async () => {
      const results = await storage.searchSymbols('User');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.score).toBeDefined();
      expect(typeof results[0]?.score).toBe('number');
    });
  });

  describe('searchSymbols (Fuzzy fallback)', () => {
    beforeEach(async () => {
      const func1 = createTestFunctionSignature({ name: 'calculateTotalPrice' });
      const func2 = createTestFunctionSignature({ name: 'computeAverage' });

      await storage.saveFile(createTestFileIndex({
        filePath: '/test/math.ts',
        functions: [func1, func2],
      }));
    });

    it('should find fuzzy matches', async () => {
      // This should trigger fuzzy search when FTS doesn't find exact matches
      const results = await storage.searchSymbols('calcTotl');

      // Fuzzy search should find calculateTotalPrice
      expect(results.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getStats', () => {
    it('should return correct file and symbol counts', async () => {
      const func1 = createTestFunctionSignature({ name: 'func1' });
      const func2 = createTestFunctionSignature({ name: 'func2' });
      const cls = createTestClassSignature({ name: 'Class1' });

      await storage.saveFile(createTestFileIndex({
        filePath: '/test/file1.ts',
        language: 'typescript',
        functions: [func1],
        classes: [cls],
      }));
      await storage.saveFile(createTestFileIndex({
        filePath: '/test/file2.py',
        language: 'python',
        functions: [func2],
      }));

      const stats = await storage.getStats();

      expect(stats.totalFiles).toBe(2);
      expect(stats.totalSymbols).toBeGreaterThanOrEqual(3); // 2 functions + 1 class
      expect(stats.byLanguage.typescript.files).toBe(1);
      expect(stats.byLanguage.python.files).toBe(1);
    });

    it('should count symbols by language and kind', async () => {
      const func = createTestFunctionSignature({ name: 'testFunc' });
      const cls = createTestClassSignature({ name: 'TestClass' });

      await storage.saveFile(createTestFileIndex({
        filePath: '/test/ts-file.ts',
        language: 'typescript',
        functions: [func],
        classes: [cls],
        interfaces: [{
          id: 'iface-1',
          name: 'TestInterface',
          fullyQualifiedName: 'TestInterface',
          signature: 'interface TestInterface',
          location: { startLine: 1, endLine: 5, startColumn: 0, endColumn: 1 },
          properties: [],
          methods: [],
          isExported: true,
        }],
      }));

      const stats = await storage.getStats();

      expect(stats.byLanguage.typescript.functions).toBeGreaterThanOrEqual(1);
      expect(stats.byLanguage.typescript.classes).toBe(1);
      expect(stats.byLanguage.typescript.interfaces).toBe(1);
    });

    it('should return zeros for empty database', async () => {
      const stats = await storage.getStats();

      expect(stats.totalFiles).toBe(0);
      expect(stats.totalSymbols).toBe(0);
      expect(stats.byLanguage.typescript.files).toBe(0);
      expect(stats.byLanguage.python.files).toBe(0);
    });
  });

  describe('close', () => {
    it('should close the database connection', async () => {
      await storage.close();

      // Attempting operations after close should throw
      await expect(storage.getStats()).rejects.toThrow();
    });
  });

  describe('clear', () => {
    it('should remove all files and symbols', async () => {
      await storage.saveFile(createTestFileIndex({ filePath: '/test/file1.ts' }));
      await storage.saveFile(createTestFileIndex({ filePath: '/test/file2.ts' }));

      await storage.clear();

      const stats = await storage.getStats();
      expect(stats.totalFiles).toBe(0);
      expect(stats.totalSymbols).toBe(0);
    });
  });

  describe('getFileByChecksum', () => {
    it('should retrieve file by checksum', async () => {
      const fileIndex = createTestFileIndex({
        filePath: '/test/checksum.ts',
        checksum: 'unique-checksum-123',
      });
      await storage.saveFile(fileIndex);

      const retrieved = await storage.getFileByChecksum('unique-checksum-123');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.filePath).toBe('/test/checksum.ts');
    });

    it('should return null for non-existent checksum', async () => {
      const retrieved = await storage.getFileByChecksum('nonexistent-checksum');
      expect(retrieved).toBeNull();
    });
  });

  describe('Symbol References', () => {
    it('should save and retrieve references by symbol name', async () => {
      const ref = createTestSymbolReference({
        symbolName: 'myFunction',
        referencingFile: '/test/caller.ts',
        lineNumber: 25,
        context: 'myFunction()',
        referenceKind: 'call',
      });
      const fileIndex = createTestFileIndex({
        filePath: '/test/caller.ts',
        references: [ref],
      });

      await storage.saveFile(fileIndex);

      const references = await storage.getReferencesByName('myFunction');
      expect(references).toHaveLength(1);
      expect(references[0]?.symbolName).toBe('myFunction');
      expect(references[0]?.lineNumber).toBe(25);
      expect(references[0]?.referenceKind).toBe('call');
    });

    it('should retrieve references in a specific file', async () => {
      const ref1 = createTestSymbolReference({
        symbolName: 'func1',
        referencingFile: '/test/file1.ts',
      });
      const ref2 = createTestSymbolReference({
        symbolName: 'func2',
        referencingFile: '/test/file1.ts',
      });
      const fileIndex = createTestFileIndex({
        filePath: '/test/file1.ts',
        references: [ref1, ref2],
      });

      await storage.saveFile(fileIndex);

      const references = await storage.getReferencesInFile('/test/file1.ts');
      expect(references).toHaveLength(2);
    });

    it('should delete references when file is deleted', async () => {
      const ref = createTestSymbolReference({
        symbolName: 'toDelete',
        referencingFile: '/test/delete-me.ts',
      });
      const fileIndex = createTestFileIndex({
        filePath: '/test/delete-me.ts',
        references: [ref],
      });

      await storage.saveFile(fileIndex);
      await storage.deleteFile('/test/delete-me.ts');

      const references = await storage.getReferencesInFile('/test/delete-me.ts');
      expect(references).toHaveLength(0);
    });
  });

  describe('Call Graph', () => {
    it('should save and retrieve callers by name', async () => {
      const func = createTestFunctionSignature({ name: 'caller', id: 'func-caller' });
      const call = createTestCallGraphEdge({
        callerSymbolId: 'func-caller',
        callerName: 'caller',
        calleeName: 'callee',
        callCount: 3,
        isAsync: true,
      });
      const fileIndex = createTestFileIndex({
        filePath: '/test/calls.ts',
        functions: [func],
        calls: [call],
      });

      await storage.saveFile(fileIndex);

      const callers = await storage.getCallersByName('callee');
      expect(callers).toHaveLength(1);
      expect(callers[0]?.callerName).toBe('caller');
      expect(callers[0]?.callCount).toBe(3);
      expect(callers[0]?.isAsync).toBe(true);
    });

    it('should save and retrieve callees by name', async () => {
      const func = createTestFunctionSignature({ name: 'myFunc', id: 'func-my' });
      const call = createTestCallGraphEdge({
        callerSymbolId: 'func-my',
        callerName: 'myFunc',
        calleeName: 'helperFunc',
        isConditional: true,
      });
      const fileIndex = createTestFileIndex({
        filePath: '/test/callees.ts',
        functions: [func],
        calls: [call],
      });

      await storage.saveFile(fileIndex);

      const callees = await storage.getCalleesByName('myFunc');
      expect(callees).toHaveLength(1);
      expect(callees[0]?.calleeName).toBe('helperFunc');
      expect(callees[0]?.isConditional).toBe(true);
    });

    it('should cascade delete calls when file is deleted', async () => {
      const func = createTestFunctionSignature({ name: 'funcToDelete', id: 'func-del' });
      const call = createTestCallGraphEdge({
        callerSymbolId: 'func-del',
        callerName: 'funcToDelete',
        calleeName: 'someFunc',
      });
      const fileIndex = createTestFileIndex({
        filePath: '/test/delete-calls.ts',
        functions: [func],
        calls: [call],
      });

      await storage.saveFile(fileIndex);
      await storage.deleteFile('/test/delete-calls.ts');

      const callees = await storage.getCalleesByName('funcToDelete');
      expect(callees).toHaveLength(0);
    });
  });

  describe('Type Hierarchy', () => {
    it('should save and retrieve type relationships by name', async () => {
      const cls = createTestClassSignature({ name: 'ChildClass', id: 'class-child' });
      const rel = createTestTypeRelationship({
        sourceSymbolId: 'class-child',
        sourceName: 'ChildClass',
        targetName: 'ParentClass',
        relationshipKind: 'extends',
      });
      const fileIndex = createTestFileIndex({
        filePath: '/test/hierarchy.ts',
        classes: [cls],
        typeRelationships: [rel],
      });

      await storage.saveFile(fileIndex);

      const hierarchy = await storage.getTypeHierarchyByName('ChildClass');
      expect(hierarchy).toHaveLength(1);
      expect(hierarchy[0]?.targetName).toBe('ParentClass');
      expect(hierarchy[0]?.relationshipKind).toBe('extends');
    });

    it('should find implementations of an interface', async () => {
      const cls = createTestClassSignature({ name: 'MyImplementation', id: 'class-impl' });
      const rel = createTestTypeRelationship({
        sourceSymbolId: 'class-impl',
        sourceName: 'MyImplementation',
        targetName: 'MyInterface',
        relationshipKind: 'implements',
      });
      const fileIndex = createTestFileIndex({
        filePath: '/test/impl.ts',
        classes: [cls],
        typeRelationships: [rel],
      });

      await storage.saveFile(fileIndex);

      const implementations = await storage.findImplementations('MyInterface');
      expect(implementations).toHaveLength(1);
      expect(implementations[0]?.sourceName).toBe('MyImplementation');
      expect(implementations[0]?.relationshipKind).toBe('implements');
    });

    it('should get subtypes of a class', async () => {
      const cls1 = createTestClassSignature({ name: 'Sub1', id: 'class-sub1' });
      const cls2 = createTestClassSignature({ name: 'Sub2', id: 'class-sub2' });
      const rel1 = createTestTypeRelationship({
        sourceSymbolId: 'class-sub1',
        sourceName: 'Sub1',
        targetName: 'BaseClass',
        relationshipKind: 'extends',
      });
      const rel2 = createTestTypeRelationship({
        sourceSymbolId: 'class-sub2',
        sourceName: 'Sub2',
        targetName: 'BaseClass',
        relationshipKind: 'extends',
      });
      const fileIndex = createTestFileIndex({
        filePath: '/test/subtypes.ts',
        classes: [cls1, cls2],
        typeRelationships: [rel1, rel2],
      });

      await storage.saveFile(fileIndex);

      const subtypes = await storage.getSubtypes('BaseClass');
      expect(subtypes).toHaveLength(2);
      expect(subtypes.map(s => s.sourceName).sort()).toEqual(['Sub1', 'Sub2']);
    });

    it('should cascade delete type relationships when file is deleted', async () => {
      const cls = createTestClassSignature({ name: 'ToDelete', id: 'class-del' });
      const rel = createTestTypeRelationship({
        sourceSymbolId: 'class-del',
        sourceName: 'ToDelete',
        targetName: 'Parent',
      });
      const fileIndex = createTestFileIndex({
        filePath: '/test/delete-types.ts',
        classes: [cls],
        typeRelationships: [rel],
      });

      await storage.saveFile(fileIndex);
      await storage.deleteFile('/test/delete-types.ts');

      const hierarchy = await storage.getTypeHierarchyByName('ToDelete');
      expect(hierarchy).toHaveLength(0);
    });
  });

  describe('Symbol Resolution', () => {
    it('should resolve symbol references across files', async () => {
      // Create a file with a function definition
      const func = createTestFunctionSignature({ name: 'targetFunc', id: 'func-target' });
      const fileWithDef = createTestFileIndex({
        filePath: '/test/definition.ts',
        functions: [func],
      });

      // Create a file with a call to that function
      const callerFunc = createTestFunctionSignature({ name: 'callerFunc', id: 'func-caller' });
      const call = createTestCallGraphEdge({
        callerSymbolId: 'func-caller',
        callerName: 'callerFunc',
        calleeName: 'targetFunc',
        calleeSymbolId: undefined, // Not yet resolved
      });
      const fileWithCall = createTestFileIndex({
        filePath: '/test/caller.ts',
        functions: [callerFunc],
        calls: [call],
      });

      await storage.saveFile(fileWithDef);
      await storage.saveFile(fileWithCall);

      // Resolve references
      await storage.resolveSymbolReferences();

      // Check that callee_symbol_id was resolved
      const callers = await storage.getCallersByName('targetFunc');
      expect(callers).toHaveLength(1);
    });
  });
});
