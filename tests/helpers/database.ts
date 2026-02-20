/**
 * Test database utilities
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { v4 as uuidv4 } from 'crypto';
import { SqliteStorage } from '../../src/indexer/storage/sqlite.js';
import type {
  FileIndex,
  FunctionSignature,
  ClassSignature,
  Language,
  SymbolReference,
  CallGraphEdge,
  TypeRelationship,
} from '../../src/types/index.js';

export interface TestDatabaseResult {
  storage: SqliteStorage;
  dbPath: string;
  tempDir: string;
  cleanup: () => void;
}

/**
 * Create a test database with a unique name
 */
export async function createTestDatabase(): Promise<TestDatabaseResult> {
  const tempDir = path.join(os.tmpdir(), `lazyload-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const dbPath = path.join(tempDir, 'test.db');
  const storage = new SqliteStorage(dbPath);
  await storage.initialize();

  const cleanup = () => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  };

  return { storage, dbPath, tempDir, cleanup };
}

/**
 * Create a test FileIndex with default values
 */
export function createTestFileIndex(overrides: Partial<FileIndex> = {}): FileIndex {
  const id = Math.random().toString(36).slice(2);
  return {
    filePath: `/test/files/test-${id}.ts`,
    relativePath: `test-${id}.ts`,
    language: 'typescript' as Language,
    checksum: `checksum-${id}`,
    lastModified: Date.now(),
    lineCount: 100,
    summary: 'Test file for unit tests',
    functions: [],
    classes: [],
    interfaces: [],
    typeAliases: [],
    variables: [],
    imports: [],
    exports: [],
    references: [],
    calls: [],
    typeRelationships: [],
    ...overrides,
  };
}

/**
 * Create a test FunctionSignature with default values
 */
export function createTestFunctionSignature(overrides: Partial<FunctionSignature> = {}): FunctionSignature {
  const id = Math.random().toString(36).slice(2);
  const name = overrides.name ?? `testFunction_${id}`;
  return {
    id: `func-${id}`,
    name,
    fullyQualifiedName: name,
    kind: 'function',
    signature: `function ${name}(): void`,
    location: {
      startLine: 1,
      endLine: 5,
      startColumn: 0,
      endColumn: 1,
    },
    parameters: [],
    returnType: 'void',
    typeParameters: [],
    modifiers: {
      isExported: true,
      isAsync: false,
      isGenerator: false,
      isStatic: false,
      isAbstract: false,
      visibility: 'public',
    },
    ...overrides,
  };
}

/**
 * Create a test ClassSignature with default values
 */
export function createTestClassSignature(overrides: Partial<ClassSignature> = {}): ClassSignature {
  const id = Math.random().toString(36).slice(2);
  const name = overrides.name ?? `TestClass_${id}`;
  return {
    id: `class-${id}`,
    name,
    fullyQualifiedName: name,
    signature: `class ${name}`,
    location: {
      startLine: 10,
      endLine: 50,
      startColumn: 0,
      endColumn: 1,
    },
    methods: [],
    properties: [],
    isAbstract: false,
    isExported: true,
    ...overrides,
  };
}

/**
 * Create a complete FileIndex with functions and classes for testing
 */
export function createPopulatedFileIndex(filePath: string, relativePath: string): FileIndex {
  const func1 = createTestFunctionSignature({ name: 'greet', returnType: 'string' });
  const func2 = createTestFunctionSignature({ name: 'calculate', returnType: 'number' });
  const cls1 = createTestClassSignature({ name: 'UserService' });

  return createTestFileIndex({
    filePath,
    relativePath,
    functions: [func1, func2],
    classes: [cls1],
  });
}

/**
 * Create a test SymbolReference with default values
 */
export function createTestSymbolReference(overrides: Partial<SymbolReference> = {}): SymbolReference {
  const id = Math.random().toString(36).slice(2);
  return {
    id: `ref-${id}`,
    symbolId: '',
    symbolName: overrides.symbolName ?? 'testSymbol',
    referencingFile: '/test/file.ts',
    referencingSymbolId: undefined,
    referencingSymbolName: undefined,
    lineNumber: 10,
    columnNumber: 5,
    context: 'testSymbol()',
    referenceKind: 'call',
    ...overrides,
  };
}

/**
 * Create a test CallGraphEdge with default values
 */
export function createTestCallGraphEdge(overrides: Partial<CallGraphEdge> = {}): CallGraphEdge {
  const id = Math.random().toString(36).slice(2);
  return {
    id: `call-${id}`,
    callerSymbolId: `func-${id}`,
    callerName: overrides.callerName ?? 'callerFunc',
    calleeName: overrides.calleeName ?? 'calleeFunc',
    calleeSymbolId: undefined,
    callCount: 1,
    isAsync: false,
    isConditional: false,
    ...overrides,
  };
}

/**
 * Create a test TypeRelationship with default values
 */
export function createTestTypeRelationship(overrides: Partial<TypeRelationship> = {}): TypeRelationship {
  const id = Math.random().toString(36).slice(2);
  return {
    id: `rel-${id}`,
    sourceSymbolId: `class-${id}`,
    sourceName: overrides.sourceName ?? 'ChildClass',
    targetName: overrides.targetName ?? 'ParentClass',
    targetSymbolId: undefined,
    relationshipKind: 'extends',
    ...overrides,
  };
}
