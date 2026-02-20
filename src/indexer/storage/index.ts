/**
 * Storage interface and exports
 */

import type {
  FileIndex,
  FunctionSignature,
  ClassSignature,
  InterfaceSignature,
  TypeAliasSignature,
  VariableSignature,
  Language,
  SearchResult,
  QueryOptions,
  IndexStats,
  SymbolReference,
  CallGraphEdge,
  TypeRelationship,
} from '../../types/index.js';

export interface StorageInterface {
  // File operations
  saveFile(index: FileIndex): Promise<void>;
  getFile(filePath: string): Promise<FileIndex | null>;
  deleteFile(filePath: string): Promise<void>;
  getFileByChecksum(checksum: string): Promise<FileIndex | null>;
  listFiles(options?: { directory?: string; language?: Language }): Promise<FileIndex[]>;
  getAllFilePaths(): Promise<Array<{ filePath: string; relativePath: string }>>;

  // Symbol operations
  getFunction(filePath: string, name: string): Promise<FunctionSignature | null>;
  getClass(filePath: string, name: string): Promise<ClassSignature | null>;
  getInterface(filePath: string, name: string): Promise<InterfaceSignature | null>;
  getTypeAlias(filePath: string, name: string): Promise<TypeAliasSignature | null>;
  getVariable(filePath: string, name: string): Promise<VariableSignature | null>;

  // Search operations
  searchSymbols(query: string, options?: QueryOptions): Promise<SearchResult[]>;

  // Reference operations
  getReferences(symbolId: string): Promise<SymbolReference[]>;
  getReferencesByName(symbolName: string): Promise<SymbolReference[]>;
  getReferencesInFile(filePath: string): Promise<SymbolReference[]>;

  // Call graph operations
  getCallers(symbolId: string): Promise<CallGraphEdge[]>;
  getCallersByName(calleeName: string): Promise<CallGraphEdge[]>;
  getCallees(symbolId: string): Promise<CallGraphEdge[]>;
  getCalleesByName(callerName: string): Promise<CallGraphEdge[]>;

  // Type hierarchy operations
  getTypeHierarchy(symbolId: string): Promise<TypeRelationship[]>;
  getTypeHierarchyByName(className: string): Promise<TypeRelationship[]>;
  findImplementations(interfaceName: string): Promise<TypeRelationship[]>;
  getSubtypes(className: string): Promise<TypeRelationship[]>;

  // Resolution
  resolveSymbolReferences(): Promise<void>;

  // Stats
  getStats(): Promise<IndexStats>;

  // Lifecycle
  initialize(): Promise<void>;
  close(): Promise<void>;
  clear(): Promise<void>;
}

export { SqliteStorage } from './sqlite.js';
