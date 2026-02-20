/**
 * Mock Indexer for unit tests
 */

import type {
  FileIndex,
  FunctionSignature,
  ClassSignature,
  InterfaceSignature,
  SearchResult,
  QueryOptions,
  IndexStats,
  Language,
  SymbolReference,
  CallGraphEdge,
  TypeRelationship,
} from '../../../src/types/index.js';

export interface MockIndexerOptions {
  files?: Map<string, FileIndex>;
  functions?: Map<string, FunctionSignature>;
  classes?: Map<string, ClassSignature>;
  searchResults?: SearchResult[];
  stats?: IndexStats;
  symbolReferences?: SymbolReference[];
  callGraphEdges?: CallGraphEdge[];
  typeRelationships?: TypeRelationship[];
}

/**
 * Create a mock indexer that doesn't require file system or database
 */
export function createMockIndexer(options: MockIndexerOptions = {}) {
  const files = options.files ?? new Map<string, FileIndex>();
  const functions = options.functions ?? new Map<string, FunctionSignature>();
  const classes = options.classes ?? new Map<string, ClassSignature>();
  const searchResults = options.searchResults ?? [];
  const symbolReferences = options.symbolReferences ?? [];
  const callGraphEdges = options.callGraphEdges ?? [];
  const typeRelationships = options.typeRelationships ?? [];
  const stats = options.stats ?? {
    totalFiles: files.size,
    totalSymbols: functions.size + classes.size,
    byLanguage: {
      typescript: { files: 0, functions: 0, classes: 0, interfaces: 0, typeAliases: 0, variables: 0 },
      javascript: { files: 0, functions: 0, classes: 0, interfaces: 0, typeAliases: 0, variables: 0 },
      python: { files: 0, functions: 0, classes: 0, interfaces: 0, typeAliases: 0, variables: 0 },
    },
    indexingDurationMs: 0,
  };

  // Create a mock storage for getStorage()
  const mockStorage = {
    async getReferencesByName(symbolName: string): Promise<SymbolReference[]> {
      return symbolReferences.filter(ref => ref.symbolName === symbolName);
    },
    async searchSymbols(query: string, queryOptions?: QueryOptions): Promise<SearchResult[]> {
      let results = searchResults.filter(r =>
        r.symbol.name.toLowerCase().includes(query.toLowerCase())
      );
      if (queryOptions?.type && queryOptions.type !== 'all') {
        results = results.filter(r => r.symbol.kind === queryOptions.type);
      }
      if (queryOptions?.limit) {
        results = results.slice(0, queryOptions.limit);
      }
      return results;
    },
    async getStats(): Promise<IndexStats> {
      return stats;
    },
    async listConfigFiles(_options?: { configType?: string; directory?: string }): Promise<Array<{ filePath: string; relativePath: string; format: string; configType: string; entryCount: number }>> {
      return [];
    },
  };

  return {
    initialized: false,

    getStorage() {
      return mockStorage;
    },

    async initialize(): Promise<void> {
      this.initialized = true;
    },

    async close(): Promise<void> {
      this.initialized = false;
    },

    async indexDirectory(): Promise<{ totalFiles: number; indexedFiles: number; skippedFiles: number; errors: Array<{ file: string; error: string }>; durationMs: number }> {
      return {
        totalFiles: files.size,
        indexedFiles: files.size,
        skippedFiles: 0,
        errors: [],
        durationMs: 100,
      };
    },

    async indexFile(_filePath: string): Promise<boolean> {
      return true;
    },

    async removeFile(_filePath: string): Promise<void> {
      // Mock implementation
    },

    async getFile(filePath: string): Promise<FileIndex | null> {
      return files.get(filePath) ?? null;
    },

    async listFiles(listOptions?: { directory?: string; language?: Language }): Promise<FileIndex[]> {
      let result = Array.from(files.values());
      if (listOptions?.directory) {
        result = result.filter(f => f.filePath.startsWith(listOptions.directory!));
      }
      if (listOptions?.language) {
        result = result.filter(f => f.language === listOptions.language);
      }
      return result;
    },

    async getFunction(filePath: string, name: string): Promise<FunctionSignature | null> {
      return functions.get(`${filePath}:${name}`) ?? null;
    },

    async getClass(filePath: string, name: string): Promise<ClassSignature | null> {
      return classes.get(`${filePath}:${name}`) ?? null;
    },

    async getInterface(_filePath: string, _name: string): Promise<InterfaceSignature | null> {
      return null;
    },

    async searchSymbols(query: string, queryOptions?: QueryOptions): Promise<SearchResult[]> {
      let results = searchResults.filter(r =>
        r.symbol.name.toLowerCase().includes(query.toLowerCase())
      );

      if (queryOptions?.type && queryOptions.type !== 'all') {
        results = results.filter(r => r.symbol.kind === queryOptions.type);
      }

      if (queryOptions?.limit) {
        results = results.slice(0, queryOptions.limit);
      }

      return results;
    },

    async getStats(): Promise<IndexStats> {
      return stats;
    },

    async clear(): Promise<void> {
      files.clear();
      functions.clear();
      classes.clear();
    },

    async getFunctionSource(_filePath: string, _functionName: string): Promise<string | null> {
      return 'function mock() { return "mock"; }';
    },

    async getClassSource(_filePath: string, _className: string): Promise<string | null> {
      return 'class Mock { }';
    },

    async getSourceWithContext(
      _filePath: string,
      startLine: number,
      endLine: number,
      contextLines: number = 3
    ): Promise<{ source: string; actualStartLine: number; actualEndLine: number } | null> {
      return {
        source: '// mock source',
        actualStartLine: Math.max(1, startLine - contextLines),
        actualEndLine: endLine + contextLines,
      };
    },

    // Reference tracking methods
    async findImplementations(interfaceName: string): Promise<TypeRelationship[]> {
      return typeRelationships.filter(
        rel => rel.targetName === interfaceName && rel.relationshipKind === 'implements'
      );
    },

    async getSubtypes(className: string): Promise<TypeRelationship[]> {
      return typeRelationships.filter(
        rel => rel.targetName === className && (rel.relationshipKind === 'extends' || rel.relationshipKind === 'mixin')
      );
    },

    async getReferencesByName(symbolName: string): Promise<SymbolReference[]> {
      return symbolReferences.filter(ref => ref.symbolName === symbolName);
    },

    async getCallersByName(functionName: string): Promise<CallGraphEdge[]> {
      return callGraphEdges.filter(edge => edge.calleeName === functionName);
    },

    async getCalleesByName(functionName: string): Promise<CallGraphEdge[]> {
      return callGraphEdges.filter(edge => edge.callerName === functionName);
    },

    async getTypeHierarchyByName(className: string): Promise<TypeRelationship[]> {
      return typeRelationships.filter(rel => rel.sourceName === className);
    },
  };
}

export type MockIndexer = ReturnType<typeof createMockIndexer>;
