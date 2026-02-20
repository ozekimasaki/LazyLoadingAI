/**
 * Main indexer orchestration
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import fg from 'fast-glob';

import type {
  FileIndex,
  IndexStats,
  Language,
  SearchResult,
  QueryOptions,
  SymbolReference,
  CallGraphEdge,
  TypeRelationship,
  ClassSignature,
  InterfaceSignature,
} from '../types/index.js';
import { ParserRegistry, createDefaultRegistry, ConfigurationParser, type ParserOptions } from './parsers/index.js';
import { SqliteStorage, type StorageInterface } from './storage/index.js';
import { PathResolver, type ResolveResult } from './path-resolver.js';
import { ImportResolver, type ResolvedImport } from './import-resolver.js';
import { buildAllChains } from '../markov/chains/index.js';

export interface IndexerConfig {
  rootDirectory: string;
  databasePath: string;
  include: string[];
  exclude: string[];
  parserOptions?: ParserOptions;
}

export interface IndexResult {
  totalFiles: number;
  indexedFiles: number;
  skippedFiles: number;
  errors: Array<{ file: string; error: string }>;
  durationMs: number;
}

export class Indexer {
  private config: IndexerConfig;
  private storage: StorageInterface;
  private registry: ParserRegistry | null = null;
  private initialized = false;
  private pathResolver: PathResolver | null = null;
  private importResolver: ImportResolver | null = null;
  private configParser: ConfigurationParser | null = null;

  constructor(config: IndexerConfig) {
    const defaultInclude = [
      '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.py',
      '**/package.json', '**/tsconfig.json', '**/tsconfig.*.json', '**/jsconfig.json',
      '**/pyproject.toml', '**/.eslintrc*', '**/eslint.config.*',
      '**/.prettierrc*', '**/prettier.config.*',
      '**/vite.config.*', '**/vitest.config.*',
      '**/jest.config.*', '**/babel.config.*', '**/.babelrc*',
      '**/docker-compose*.yml', '**/docker-compose*.yaml',
      '**/.github/workflows/*.yml', '**/.github/workflows/*.yaml',
    ];
    const defaultExclude = ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**', '**/venv/**', '**/__pycache__/**'];

    this.config = {
      ...config,
      include: config.include.length > 0 ? config.include : defaultInclude,
      exclude: config.exclude.length > 0 ? config.exclude : defaultExclude,
    };
    this.storage = new SqliteStorage(config.databasePath);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.storage.initialize();
    this.registry = await createDefaultRegistry(this.config.parserOptions);
    this.initialized = true;
  }

  async close(): Promise<void> {
    await this.storage.close();
    this.initialized = false;
  }

  async indexDirectory(directory?: string): Promise<IndexResult> {
    await this.initialize();

    const startTime = Date.now();
    const rootDir = directory ?? this.config.rootDirectory;
    const errors: Array<{ file: string; error: string }> = [];
    let indexedFiles = 0;
    let skippedFiles = 0;

    // Find all matching files
    const files = await fg(this.config.include, {
      cwd: rootDir,
      ignore: this.config.exclude,
      absolute: true,
      onlyFiles: true,
    });

    // Process each file
    for (const filePath of files) {
      try {
        const wasIndexed = await this.indexFile(filePath, rootDir);
        if (wasIndexed) {
          indexedFiles++;
        } else {
          skippedFiles++;
        }
      } catch (error) {
        errors.push({
          file: filePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Resolve cross-file symbol IDs before chain construction so chain states are queryable by symbol ID.
    await this.storage.resolveSymbolReferences();

    // Build Markov chains after indexing completes
    await buildAllChains(this.storage as SqliteStorage);

    const durationMs = Date.now() - startTime;

    return {
      totalFiles: files.length,
      indexedFiles,
      skippedFiles,
      errors,
      durationMs,
    };
  }

  async indexFile(filePath: string, rootDir?: string): Promise<boolean> {
    await this.initialize();

    if (!this.registry) {
      throw new Error('Parser registry not initialized');
    }

    const parser = this.registry.getByFilePath(filePath);
    if (!parser) {
      return false;
    }

    // Read file content
    const content = await fs.promises.readFile(filePath, 'utf-8');

    // Calculate checksum
    const checksum = crypto.createHash('sha256').update(content).digest('hex');

    // Check if file has changed
    const existingFile = await this.storage.getFile(filePath);
    if (existingFile && existingFile.checksum === checksum) {
      return false; // No changes
    }

    // Parse file
    const parseResult = await parser.parseFile(filePath, content);

    // Build file index
    const effectiveRootDir = rootDir ?? this.config.rootDirectory;
    const relativePath = path.relative(effectiveRootDir, filePath);
    const fileIndex = parser.buildFileIndex(filePath, relativePath, content, checksum, parseResult);

    // Save to storage
    await this.storage.saveFile(fileIndex);

    // Handle imports for TypeScript/JavaScript files
    if (fileIndex.language !== 'config' && fileIndex.imports.length > 0) {
      await this.saveFileImportsAndExports(filePath, fileIndex);
    }

    // Handle config files - save config entries
    if (parser.language === 'config') {
      await this.saveConfigEntries(filePath, content);
    }

    return true;
  }

  /**
   * Save file imports and exports for dependency tracking
   */
  private async saveFileImportsAndExports(filePath: string, fileIndex: FileIndex): Promise<void> {
    // Initialize import resolver lazily
    if (!this.importResolver) {
      this.importResolver = new ImportResolver({
        rootDir: this.config.rootDirectory,
      });
    }

    // Resolve imports
    const resolvedImports = this.importResolver.resolveImports(fileIndex.imports, filePath);

    // Convert to storage format
    const storageImports = resolvedImports.map(imp => ({
      source: imp.source,
      resolvedPath: imp.resolvedPath,
      isExternal: imp.isExternal || imp.isBuiltIn,
      isTypeOnly: imp.isTypeOnly,
      isReExport: imp.isReExport,
      specifiers: imp.specifiers,
    }));

    await (this.storage as SqliteStorage).saveFileImports(filePath, storageImports);

    // Save exports
    if (fileIndex.exports.length > 0) {
      const storageExports = fileIndex.exports.map(exp => {
        let resolvedPath: string | undefined;
        if (exp.source) {
          const resolved = this.importResolver?.resolveImport(
            { source: exp.source, specifiers: [], isTypeOnly: false },
            filePath
          );
          resolvedPath = resolved?.resolvedPath ?? undefined;
        }
        return {
          name: exp.name,
          isDefault: exp.isDefault,
          isReExport: exp.isReExport,
          reExportSource: exp.source,
          resolvedReExportPath: resolvedPath,
        };
      });

      await (this.storage as SqliteStorage).saveFileExports(filePath, storageExports);
    }
  }

  /**
   * Save configuration entries for config files
   */
  private async saveConfigEntries(filePath: string, content: string): Promise<void> {
    // Initialize config parser lazily
    if (!this.configParser) {
      this.configParser = new ConfigurationParser();
    }

    const { entries, errors } = await this.configParser.parseConfigFile(filePath, content);

    if (errors.length > 0) {
      // Log errors but continue
      for (const error of errors) {
        console.warn(`Config parse warning for ${filePath}: ${error.message}`);
      }
    }

    if (entries.length > 0) {
      const storageEntries = entries.map(entry => ({
        id: entry.id,
        name: entry.name,
        path: entry.path,
        valueType: entry.valueType,
        value: entry.value,
        rawValue: entry.rawValue,
        depth: entry.depth,
        parentPath: entry.parentPath,
        format: entry.format,
        configType: entry.configType,
        description: entry.description,
        lineNumber: entry.location.startLine,
      }));

      await (this.storage as SqliteStorage).saveConfigEntries(filePath, storageEntries);
    }
  }

  async removeFile(filePath: string): Promise<void> {
    await this.initialize();
    await this.storage.deleteFile(filePath);
  }

  /**
   * Get the PathResolver instance (lazy initialization)
   */
  private getPathResolver(): PathResolver {
    if (!this.pathResolver) {
      this.pathResolver = new PathResolver(
        this.config.rootDirectory,
        () => this.storage.getAllFilePaths()
      );
    }
    return this.pathResolver;
  }

  /**
   * Resolve a user-provided path to an absolute path in the index
   */
  async resolvePath(inputPath: string): Promise<ResolveResult> {
    await this.initialize();
    return this.getPathResolver().resolve(inputPath);
  }

  async getFile(filePath: string): Promise<FileIndex | null> {
    await this.initialize();

    // Try direct lookup first
    const directResult = await this.storage.getFile(filePath);
    if (directResult) return directResult;

    // Use path resolution for relative/partial paths
    const resolved = await this.resolvePath(filePath);
    if (!resolved.success) return null;

    return this.storage.getFile(resolved.result.resolvedPath);
  }

  async listFiles(options?: { directory?: string; language?: Language }): Promise<FileIndex[]> {
    await this.initialize();
    return this.storage.listFiles(options);
  }

  async getFunction(filePath: string, name: string): Promise<import('../types/index.js').FunctionSignature | null> {
    await this.initialize();

    // Try direct lookup first
    const directResult = await this.storage.getFunction(filePath, name);
    if (directResult) return directResult;

    // Use path resolution for relative/partial paths
    const resolved = await this.resolvePath(filePath);
    if (!resolved.success) return null;

    return this.storage.getFunction(resolved.result.resolvedPath, name);
  }

  /**
   * Get a function with detailed error information for ambiguous matches
   */
  async getFunctionWithDetails(
    filePath: string,
    name: string
  ): Promise<
    | { success: true; function: import('../types/index.js').FunctionSignature }
    | { success: false; error: string; suggestions?: string[] }
  > {
    await this.initialize();

    // Try direct lookup first
    const result = await (this.storage as SqliteStorage).getFunctionWithDetails(filePath, name);
    if (result.success) return result;

    // Use path resolution for relative/partial paths
    const resolved = await this.resolvePath(filePath);
    if (!resolved.success) {
      return { success: false, error: `File not found: ${filePath}` };
    }

    return (this.storage as SqliteStorage).getFunctionWithDetails(resolved.result.resolvedPath, name);
  }

  async getClass(filePath: string, name: string): Promise<import('../types/index.js').ClassSignature | null> {
    await this.initialize();

    // Try direct lookup first
    const directResult = await this.storage.getClass(filePath, name);
    if (directResult) return directResult;

    // Use path resolution for relative/partial paths
    const resolved = await this.resolvePath(filePath);
    if (!resolved.success) return null;

    return this.storage.getClass(resolved.result.resolvedPath, name);
  }

  async getInterface(filePath: string, name: string): Promise<import('../types/index.js').InterfaceSignature | null> {
    await this.initialize();

    // Try direct lookup first
    const directResult = await this.storage.getInterface(filePath, name);
    if (directResult) return directResult;

    // Use path resolution for relative/partial paths
    const resolved = await this.resolvePath(filePath);
    if (!resolved.success) return null;

    return this.storage.getInterface(resolved.result.resolvedPath, name);
  }

  /**
   * Try to get a class first, falling back to interface if not found.
   * Returns a discriminated union indicating which type was found.
   */
  async getClassOrInterface(
    filePath: string,
    name: string
  ): Promise<{ type: 'class'; data: ClassSignature } | { type: 'interface'; data: InterfaceSignature } | null> {
    await this.initialize();

    // Try direct lookup first
    const directResult = await (this.storage as SqliteStorage).getClassOrInterface(filePath, name);
    if (directResult) return directResult;

    // Use path resolution for relative/partial paths
    const resolved = await this.resolvePath(filePath);
    if (!resolved.success) return null;

    return (this.storage as SqliteStorage).getClassOrInterface(resolved.result.resolvedPath, name);
  }

  async searchSymbols(query: string, options?: QueryOptions): Promise<SearchResult[]> {
    await this.initialize();
    return this.storage.searchSymbols(query, options);
  }

  async getStats(): Promise<IndexStats> {
    await this.initialize();
    return this.storage.getStats();
  }

  async clear(): Promise<void> {
    await this.initialize();
    await this.storage.clear();
  }

  /**
   * Get the full source code for a function
   */
  async getFunctionSource(filePath: string, functionName: string): Promise<string | null> {
    const func = await this.getFunction(filePath, functionName);
    if (!func) return null;

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      const startLine = func.location.startLine - 1;
      const endLine = func.location.endLine;

      return lines.slice(startLine, endLine).join('\n');
    } catch {
      return null;
    }
  }

  /**
   * Get the full source code for a class
   */
  async getClassSource(filePath: string, className: string): Promise<string | null> {
    const cls = await this.getClass(filePath, className);
    if (!cls) return null;

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      const startLine = cls.location.startLine - 1;
      const endLine = cls.location.endLine;

      return lines.slice(startLine, endLine).join('\n');
    } catch {
      return null;
    }
  }

  /**
   * Get source code with context lines
   */
  async getSourceWithContext(
    filePath: string,
    startLine: number,
    endLine: number,
    contextLines: number = 3
  ): Promise<{ source: string; actualStartLine: number; actualEndLine: number } | null> {
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const lines = content.split('\n');

      const actualStartLine = Math.max(1, startLine - contextLines);
      const actualEndLine = Math.min(lines.length, endLine + contextLines);

      const source = lines.slice(actualStartLine - 1, actualEndLine).join('\n');

      return { source, actualStartLine, actualEndLine };
    } catch {
      return null;
    }
  }

  // Reference tracking methods

  /**
   * Get all references to a symbol by its ID
   */
  async getReferences(symbolId: string): Promise<SymbolReference[]> {
    await this.initialize();
    return this.storage.getReferences(symbolId);
  }

  /**
   * Get all references to a symbol by its name
   */
  async getReferencesByName(symbolName: string): Promise<SymbolReference[]> {
    await this.initialize();
    return this.storage.getReferencesByName(symbolName);
  }

  /**
   * Get all references in a specific file
   */
  async getReferencesInFile(filePath: string): Promise<SymbolReference[]> {
    await this.initialize();
    return this.storage.getReferencesInFile(filePath);
  }

  // Call graph methods

  /**
   * Get all functions that call a given function (by ID)
   */
  async getCallers(symbolId: string): Promise<CallGraphEdge[]> {
    await this.initialize();
    return this.storage.getCallers(symbolId);
  }

  /**
   * Get all functions that call a given function (by name)
   */
  async getCallersByName(functionName: string): Promise<CallGraphEdge[]> {
    await this.initialize();
    return this.storage.getCallersByName(functionName);
  }

  /**
   * Get all functions called by a given function (by ID)
   */
  async getCallees(symbolId: string): Promise<CallGraphEdge[]> {
    await this.initialize();
    return this.storage.getCallees(symbolId);
  }

  /**
   * Get all functions called by a given function (by name)
   */
  async getCalleesByName(functionName: string): Promise<CallGraphEdge[]> {
    await this.initialize();
    return this.storage.getCalleesByName(functionName);
  }

  // Type hierarchy methods

  /**
   * Get the type hierarchy for a class/interface (by ID)
   */
  async getTypeHierarchy(symbolId: string): Promise<TypeRelationship[]> {
    await this.initialize();
    return this.storage.getTypeHierarchy(symbolId);
  }

  /**
   * Get the type hierarchy for a class/interface (by name)
   */
  async getTypeHierarchyByName(className: string): Promise<TypeRelationship[]> {
    await this.initialize();
    return this.storage.getTypeHierarchyByName(className);
  }

  /**
   * Find all implementations of an interface
   */
  async findImplementations(interfaceName: string): Promise<TypeRelationship[]> {
    await this.initialize();
    return this.storage.findImplementations(interfaceName);
  }

  /**
   * Get all subtypes (classes that extend/implement) a given type
   */
  async getSubtypes(className: string): Promise<TypeRelationship[]> {
    await this.initialize();
    return this.storage.getSubtypes(className);
  }

  /**
   * Resolve symbol references across files
   * Call this after indexing to link symbol names to their IDs
   */
  async resolveSymbolReferences(): Promise<void> {
    await this.initialize();
    return this.storage.resolveSymbolReferences();
  }

  /**
   * Get the underlying storage for advanced queries
   * Used by type-based search and other advanced features
   */
  getStorage(): SqliteStorage {
    if (!this.storage) {
      throw new Error('Storage not initialized. Call initialize() first.');
    }
    return this.storage as SqliteStorage;
  }

  /**
   * Get the root directory being indexed
   */
  getRootDir(): string {
    return this.config.rootDirectory;
  }
}

export { Watcher } from './watcher.js';
export { PathResolver, type ResolveResult, type ResolveError, type ResolveErrorType, type ResolveOptions } from './path-resolver.js';
export { ImportResolver, type ResolvedImport, type ImportResolverOptions } from './import-resolver.js';
