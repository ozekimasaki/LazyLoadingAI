/**
 * Abstract base class for language parsers
 */

import type {
  Language,
  FileIndex,
  FunctionSignature,
  ClassSignature,
  InterfaceSignature,
  TypeAliasSignature,
  VariableSignature,
  ImportInfo,
  ExportInfo,
  SymbolReference,
  CallGraphEdge,
  TypeRelationship,
  ParseStatus,
  ParseWarning,
} from '../../types/index.js';

export interface ParseResult {
  functions: FunctionSignature[];
  classes: ClassSignature[];
  interfaces: InterfaceSignature[];
  typeAliases: TypeAliasSignature[];
  variables: VariableSignature[];
  imports: ImportInfo[];
  exports: ExportInfo[];
  references: SymbolReference[];
  calls: CallGraphEdge[];
  typeRelationships: TypeRelationship[];
  errors: ParseError[];
}

export interface ParseError {
  message: string;
  line?: number;
  column?: number;
  severity: 'error' | 'warning';
}

export interface ParserOptions {
  extractDocumentation?: boolean;
  includePrivate?: boolean;
  maxFileSize?: number;
}

export abstract class LanguageParser {
  protected options: ParserOptions;

  constructor(options: ParserOptions = {}) {
    this.options = {
      extractDocumentation: true,
      includePrivate: false,
      maxFileSize: 1024 * 1024, // 1MB
      ...options,
    };
  }

  /**
   * Check if this parser can handle the given file
   */
  abstract canParse(filePath: string): boolean;

  /**
   * Parse a file and extract symbols
   */
  abstract parseFile(filePath: string, content: string): Promise<ParseResult>;

  /**
   * Get the language this parser handles
   */
  abstract get language(): Language;

  /**
   * Get file extensions this parser handles
   */
  abstract get extensions(): string[];

  /**
   * Generate a unique ID for a symbol
   */
  protected generateId(filePath: string, name: string, kind: string, line: number): string {
    const normalizedPath = filePath.replace(/\\/g, '/');
    return `${normalizedPath}:${name}:${kind}:${line}`;
  }

  /**
   * Generate a fully qualified name for a symbol
   */
  protected generateFullyQualifiedName(
    filePath: string,
    name: string,
    parentName?: string
  ): string {
    const modulePath = filePath.replace(/\.(ts|tsx|js|jsx|py)$/, '').replace(/\\/g, '/');
    if (parentName) {
      return `${modulePath}#${parentName}.${name}`;
    }
    return `${modulePath}#${name}`;
  }

  /**
   * Check if content exceeds max file size
   */
  protected isFileTooLarge(content: string): boolean {
    return Buffer.byteLength(content, 'utf8') > (this.options.maxFileSize ?? Infinity);
  }

  /**
   * Build a file index from parse results
   */
  buildFileIndex(
    filePath: string,
    relativePath: string,
    content: string,
    checksum: string,
    parseResult: ParseResult,
    parseStatus: ParseStatus = 'complete',
    parseWarnings?: ParseWarning[]
  ): FileIndex {
    const lineCount = content.split('\n').length;
    const fileSize = Buffer.byteLength(content, 'utf8');
    const summary = this.generateFileSummary(parseResult);

    return {
      filePath,
      relativePath,
      language: this.language,
      checksum,
      lastModified: Date.now(),
      functions: parseResult.functions,
      classes: parseResult.classes,
      interfaces: parseResult.interfaces,
      typeAliases: parseResult.typeAliases,
      variables: parseResult.variables,
      imports: parseResult.imports,
      exports: parseResult.exports,
      references: parseResult.references,
      calls: parseResult.calls,
      typeRelationships: parseResult.typeRelationships,
      summary,
      lineCount,
      parseStatus,
      parseWarnings,
      fileSize,
    };
  }

  /**
   * Build a skipped file index for files that couldn't be fully parsed (e.g., too large)
   */
  buildSkippedFileIndex(
    filePath: string,
    relativePath: string,
    content: string,
    checksum: string,
    warning: ParseWarning
  ): FileIndex {
    const lineCount = content.split('\n').length;
    const fileSize = Buffer.byteLength(content, 'utf8');

    return {
      filePath,
      relativePath,
      language: this.language,
      checksum,
      lastModified: Date.now(),
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
      summary: `Skipped: ${warning.message}`,
      lineCount,
      parseStatus: 'skipped',
      parseWarnings: [warning],
      fileSize,
    };
  }

  /**
   * Create a FILE_TOO_LARGE warning
   */
  createFileTooLargeWarning(fileSize: number, maxSize: number, lineCount: number): ParseWarning {
    return {
      code: 'FILE_TOO_LARGE',
      message: `File size (${this.formatBytes(fileSize)}) exceeds limit (${this.formatBytes(maxSize)})`,
      details: {
        fileSize,
        maxSize,
        lineCount,
      },
    };
  }

  /**
   * Format bytes to human readable string
   */
  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /**
   * Generate a summary of the file contents
   */
  protected generateFileSummary(parseResult: ParseResult): string {
    const parts: string[] = [];

    // Separate regular functions from callbacks
    const regularFunctions = parseResult.functions.filter(f => f.kind !== 'callback');
    const callbacks = parseResult.functions.filter(f => f.kind === 'callback');

    // Count test callbacks specifically
    const testFrameworkContexts = new Set([
      'describe', 'it', 'test', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll',
      'suite', 'spec', 'context', 'before', 'after'
    ]);
    const testCallbacks = callbacks.filter(f =>
      f.modifiers.callbackContext && testFrameworkContexts.has(f.modifiers.callbackContext)
    );
    const otherCallbacks = callbacks.filter(f =>
      !f.modifiers.callbackContext || !testFrameworkContexts.has(f.modifiers.callbackContext)
    );

    if (regularFunctions.length > 0) {
      const exported = regularFunctions.filter(f => f.modifiers.isExported);
      parts.push(
        `${regularFunctions.length} functions (${exported.length} exported)`
      );
    }

    if (testCallbacks.length > 0) {
      parts.push(`${testCallbacks.length} test functions`);
    }

    if (otherCallbacks.length > 0) {
      parts.push(`${otherCallbacks.length} callbacks`);
    }

    if (parseResult.classes.length > 0) {
      const classNames = parseResult.classes.map(c => c.name).join(', ');
      parts.push(`Classes: ${classNames}`);
    }

    if (parseResult.interfaces.length > 0) {
      const interfaceNames = parseResult.interfaces.map(i => i.name).join(', ');
      parts.push(`Interfaces: ${interfaceNames}`);
    }

    if (parseResult.typeAliases.length > 0) {
      parts.push(`${parseResult.typeAliases.length} type aliases`);
    }

    if (parts.length === 0) {
      return 'Empty or declaration-only file';
    }

    return parts.join('; ');
  }
}
