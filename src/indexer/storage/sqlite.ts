/**
 * SQLite storage implementation for the index
 */

import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import Fuse from 'fuse.js';

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
  LanguageStats,
  SymbolReference,
  CallGraphEdge,
  TypeRelationship,
  ReferenceKind,
  RelationshipKind,
} from '../../types/index.js';

import type { SymbolTypeInfo, ParsedType, TypeSearchOptions } from '../type-extractor.js';
import { extractFunctionTypeInfo, filterByTypeSearch } from '../type-extractor.js';

import type { StorageInterface } from './index.js';

interface SymbolRow {
  id: string;
  file_path: string;
  name: string;
  fully_qualified_name: string;
  kind: string;
  signature: string;
  language: string;
  line_start: number;
  line_end: number;
  data: string;
}

interface FileRow {
  file_path: string;
  relative_path: string;
  language: string;
  checksum: string;
  last_modified: number;
  summary: string;
  line_count: number;
  data: string;
  parse_status: string | null;
  parse_warnings: string | null;
  file_size: number | null;
}

export class SqliteStorage implements StorageInterface {
  private db: Database.Database | null = null;
  private dbPath: string;
  private fuse: Fuse<SymbolRow> | null = null;
  private symbolCache: SymbolRow[] = [];
  private cacheValid = false;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    // Ensure directory exists
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);

    // Enable WAL mode for better concurrency
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    // Create tables
    this.createTables();
  }

  private createTables(): void {
    if (!this.db) throw new Error('Database not initialized');

    // Files table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        file_path TEXT PRIMARY KEY,
        relative_path TEXT NOT NULL,
        language TEXT NOT NULL,
        checksum TEXT NOT NULL,
        last_modified INTEGER NOT NULL,
        summary TEXT,
        line_count INTEGER NOT NULL,
        data TEXT NOT NULL,
        parse_status TEXT DEFAULT 'complete',
        parse_warnings TEXT,
        file_size INTEGER
      )
    `);

    // Migration: Add parse_status columns if they don't exist
    this.migrateFilesTable();

    // Symbols table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS symbols (
        id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        name TEXT NOT NULL,
        fully_qualified_name TEXT NOT NULL,
        kind TEXT NOT NULL,
        signature TEXT NOT NULL,
        language TEXT NOT NULL,
        line_start INTEGER NOT NULL,
        line_end INTEGER NOT NULL,
        data TEXT NOT NULL,
        local_name TEXT,
        parent_function TEXT,
        nesting_depth INTEGER DEFAULT 0,
        FOREIGN KEY (file_path) REFERENCES files(file_path) ON DELETE CASCADE
      )
    `);

    // Migration: Add columns if they don't exist
    this.migrateSymbolsTable();

    // Create indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_symbols_file_path ON symbols(file_path);
      CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
      CREATE INDEX IF NOT EXISTS idx_symbols_kind ON symbols(kind);
      CREATE INDEX IF NOT EXISTS idx_symbols_language ON symbols(language);
      CREATE INDEX IF NOT EXISTS idx_symbols_local_name ON symbols(local_name);
      CREATE INDEX IF NOT EXISTS idx_symbols_parent_function ON symbols(parent_function);
      CREATE INDEX IF NOT EXISTS idx_files_checksum ON files(checksum);
      CREATE INDEX IF NOT EXISTS idx_files_language ON files(language);
      CREATE INDEX IF NOT EXISTS idx_files_relative_path ON files(relative_path);
    `);

    // Full-text search table
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts USING fts5(
        name,
        fully_qualified_name,
        signature,
        content='symbols',
        content_rowid='rowid'
      )
    `);

    // Triggers to keep FTS in sync
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS symbols_ai AFTER INSERT ON symbols BEGIN
        INSERT INTO symbols_fts(rowid, name, fully_qualified_name, signature)
        VALUES (NEW.rowid, NEW.name, NEW.fully_qualified_name, NEW.signature);
      END;

      CREATE TRIGGER IF NOT EXISTS symbols_ad AFTER DELETE ON symbols BEGIN
        INSERT INTO symbols_fts(symbols_fts, rowid, name, fully_qualified_name, signature)
        VALUES('delete', OLD.rowid, OLD.name, OLD.fully_qualified_name, OLD.signature);
      END;

      CREATE TRIGGER IF NOT EXISTS symbols_au AFTER UPDATE ON symbols BEGIN
        INSERT INTO symbols_fts(symbols_fts, rowid, name, fully_qualified_name, signature)
        VALUES('delete', OLD.rowid, OLD.name, OLD.fully_qualified_name, OLD.signature);
        INSERT INTO symbols_fts(rowid, name, fully_qualified_name, signature)
        VALUES (NEW.rowid, NEW.name, NEW.fully_qualified_name, NEW.signature);
      END;
    `);

    // Symbol references table - where symbols are used
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS symbol_references (
        id TEXT PRIMARY KEY,
        symbol_id TEXT NOT NULL,
        symbol_name TEXT NOT NULL,
        referencing_file TEXT NOT NULL,
        referencing_symbol_id TEXT,
        referencing_symbol_name TEXT,
        line_number INTEGER NOT NULL,
        column_number INTEGER,
        context TEXT,
        reference_kind TEXT NOT NULL,
        FOREIGN KEY (referencing_file) REFERENCES files(file_path) ON DELETE CASCADE
      )
    `);

    // Call graph table - function call relationships
    // Note: No foreign key on caller_symbol_id - it may reference symbols not in our index (external/built-in)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS call_graph (
        id TEXT PRIMARY KEY,
        caller_symbol_id TEXT NOT NULL,
        caller_name TEXT NOT NULL,
        callee_name TEXT NOT NULL,
        callee_symbol_id TEXT,
        call_count INTEGER DEFAULT 1,
        is_async INTEGER DEFAULT 0,
        is_conditional INTEGER DEFAULT 0
      )
    `);

    // Type relationships table - inheritance and implementation
    // Note: No foreign key on source_symbol_id - it may reference symbols not in our index (external/built-in)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS type_relationships (
        id TEXT PRIMARY KEY,
        source_symbol_id TEXT NOT NULL,
        source_name TEXT NOT NULL,
        target_name TEXT NOT NULL,
        target_name_base TEXT,
        target_symbol_id TEXT,
        relationship_kind TEXT NOT NULL
      )
    `);

    // Migration: Add target_name_base column if it doesn't exist
    this.migrateTypeRelationshipsTable();

    // Create indexes for the new tables
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_refs_symbol_id ON symbol_references(symbol_id);
      CREATE INDEX IF NOT EXISTS idx_refs_symbol_name ON symbol_references(symbol_name);
      CREATE INDEX IF NOT EXISTS idx_refs_referencing_file ON symbol_references(referencing_file);
      CREATE INDEX IF NOT EXISTS idx_calls_caller ON call_graph(caller_symbol_id);
      CREATE INDEX IF NOT EXISTS idx_calls_callee ON call_graph(callee_name);
      CREATE INDEX IF NOT EXISTS idx_calls_callee_resolved ON call_graph(callee_symbol_id);
      CREATE INDEX IF NOT EXISTS idx_types_source ON type_relationships(source_symbol_id);
      CREATE INDEX IF NOT EXISTS idx_types_target ON type_relationships(target_name);
      CREATE INDEX IF NOT EXISTS idx_types_target_base ON type_relationships(target_name_base);
      CREATE INDEX IF NOT EXISTS idx_types_target_resolved ON type_relationships(target_symbol_id);
    `);

    // Symbol type information table (for type-based search)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS symbol_types (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol_id TEXT NOT NULL UNIQUE,
        symbol_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        language TEXT NOT NULL,
        return_type_raw TEXT,
        return_type_normalized TEXT,
        return_type_base TEXT,
        return_type_inner TEXT,
        return_type_is_async INTEGER DEFAULT 0,
        return_type_is_nullable INTEGER DEFAULT 0,
        return_type_is_array INTEGER DEFAULT 0,
        return_type_is_generic INTEGER DEFAULT 0,
        param_count INTEGER DEFAULT 0,
        is_method INTEGER DEFAULT 0,
        parent_class TEXT,
        FOREIGN KEY (file_path) REFERENCES files(file_path) ON DELETE CASCADE
      )
    `);

    // Parameter types table for each function
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS symbol_type_params (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol_id TEXT NOT NULL,
        param_index INTEGER NOT NULL,
        param_name TEXT NOT NULL,
        param_type_raw TEXT,
        param_type_normalized TEXT,
        param_type_base TEXT,
        param_type_inner TEXT,
        param_type_is_optional INTEGER DEFAULT 0,
        param_type_is_nullable INTEGER DEFAULT 0,
        param_type_is_array INTEGER DEFAULT 0,
        param_type_is_generic INTEGER DEFAULT 0,
        param_type_has_default INTEGER DEFAULT 0,
        FOREIGN KEY (symbol_id) REFERENCES symbol_types(symbol_id) ON DELETE CASCADE,
        UNIQUE(symbol_id, param_index)
      )
    `);

    // Indexes for fast type lookups
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_st_return_type_base ON symbol_types(return_type_base);
      CREATE INDEX IF NOT EXISTS idx_st_return_type_inner ON symbol_types(return_type_inner);
      CREATE INDEX IF NOT EXISTS idx_st_language ON symbol_types(language);
      CREATE INDEX IF NOT EXISTS idx_st_composite ON symbol_types(language, return_type_base, return_type_inner);
      CREATE INDEX IF NOT EXISTS idx_st_file_path ON symbol_types(file_path);
      CREATE INDEX IF NOT EXISTS idx_stp_param_type_base ON symbol_type_params(param_type_base);
      CREATE INDEX IF NOT EXISTS idx_stp_symbol_id ON symbol_type_params(symbol_id);
    `);

    // Markov chain metadata table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS markov_chains (
        id TEXT PRIMARY KEY,
        chain_type TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        total_states INTEGER DEFAULT 0,
        total_transitions INTEGER DEFAULT 0,
        config TEXT
      )
    `);

    // Markov transition matrix (sparse representation)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS markov_transitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chain_id TEXT NOT NULL,
        from_state_id TEXT NOT NULL,
        from_state_name TEXT NOT NULL,
        to_state_id TEXT NOT NULL,
        to_state_name TEXT NOT NULL,
        raw_count REAL DEFAULT 0,
        probability REAL DEFAULT 0,
        metadata TEXT,
        FOREIGN KEY (chain_id) REFERENCES markov_chains(id) ON DELETE CASCADE
      )
    `);

    // State normalization sums for incremental updates
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS markov_state_sums (
        chain_id TEXT NOT NULL,
        state_id TEXT NOT NULL,
        raw_sum REAL DEFAULT 0,
        transition_count INTEGER DEFAULT 0,
        PRIMARY KEY (chain_id, state_id)
      )
    `);

    // File dependencies for incremental updates
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS markov_file_deps (
        file_path TEXT NOT NULL,
        chain_id TEXT NOT NULL,
        PRIMARY KEY (file_path, chain_id)
      )
    `);

    // Indexes for Markov queries
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_mt_chain_from ON markov_transitions(chain_id, from_state_id);
      CREATE INDEX IF NOT EXISTS idx_mt_chain_to ON markov_transitions(chain_id, to_state_id);
      CREATE INDEX IF NOT EXISTS idx_mt_chain_prob ON markov_transitions(chain_id, probability DESC);
      CREATE INDEX IF NOT EXISTS idx_mc_type ON markov_chains(chain_type);
      CREATE INDEX IF NOT EXISTS idx_mfd_chain ON markov_file_deps(chain_id);
    `);

    // Configuration entries table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS config_entries (
        id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        value_type TEXT NOT NULL,
        value TEXT NOT NULL,
        raw_value TEXT,
        depth INTEGER NOT NULL,
        parent_path TEXT,
        format TEXT NOT NULL,
        config_type TEXT NOT NULL,
        description TEXT,
        line_number INTEGER DEFAULT 1,
        FOREIGN KEY (file_path) REFERENCES files(file_path) ON DELETE CASCADE
      )
    `);

    // Indexes for config queries
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_config_path ON config_entries(path);
      CREATE INDEX IF NOT EXISTS idx_config_name ON config_entries(name);
      CREATE INDEX IF NOT EXISTS idx_config_file ON config_entries(file_path);
      CREATE INDEX IF NOT EXISTS idx_config_type ON config_entries(config_type);
      CREATE INDEX IF NOT EXISTS idx_config_value_type ON config_entries(value_type);
    `);

    // FTS5 for full-text search on config entries
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS config_fts USING fts5(
        path,
        name,
        value,
        description,
        content='config_entries',
        content_rowid='rowid'
      )
    `);

    // Triggers to keep config FTS in sync
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS config_ai AFTER INSERT ON config_entries BEGIN
        INSERT INTO config_fts(rowid, path, name, value, description)
        VALUES (NEW.rowid, NEW.path, NEW.name, NEW.value, COALESCE(NEW.description, ''));
      END;

      CREATE TRIGGER IF NOT EXISTS config_ad AFTER DELETE ON config_entries BEGIN
        INSERT INTO config_fts(config_fts, rowid, path, name, value, description)
        VALUES('delete', OLD.rowid, OLD.path, OLD.name, OLD.value, COALESCE(OLD.description, ''));
      END;

      CREATE TRIGGER IF NOT EXISTS config_au AFTER UPDATE ON config_entries BEGIN
        INSERT INTO config_fts(config_fts, rowid, path, name, value, description)
        VALUES('delete', OLD.rowid, OLD.path, OLD.name, OLD.value, COALESCE(OLD.description, ''));
        INSERT INTO config_fts(rowid, path, name, value, description)
        VALUES (NEW.rowid, NEW.path, NEW.name, NEW.value, COALESCE(NEW.description, ''));
      END;
    `);

    // File imports table for dependency tracking
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS file_imports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        import_source TEXT NOT NULL,
        resolved_path TEXT,
        is_external INTEGER DEFAULT 0,
        is_type_only INTEGER DEFAULT 0,
        is_re_export INTEGER DEFAULT 0,
        specifiers_json TEXT NOT NULL,
        FOREIGN KEY (file_path) REFERENCES files(file_path) ON DELETE CASCADE
      )
    `);

    // Indexes for import queries
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_imports_file ON file_imports(file_path);
      CREATE INDEX IF NOT EXISTS idx_imports_resolved ON file_imports(resolved_path);
      CREATE INDEX IF NOT EXISTS idx_imports_external ON file_imports(is_external);
      CREATE INDEX IF NOT EXISTS idx_imports_source ON file_imports(import_source);
    `);

    // File exports table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS file_exports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        export_name TEXT NOT NULL,
        is_default INTEGER DEFAULT 0,
        is_re_export INTEGER DEFAULT 0,
        re_export_source TEXT,
        resolved_re_export_path TEXT,
        FOREIGN KEY (file_path) REFERENCES files(file_path) ON DELETE CASCADE
      )
    `);

    // Indexes for export queries
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_exports_file ON file_exports(file_path);
      CREATE INDEX IF NOT EXISTS idx_exports_name ON file_exports(export_name);
      CREATE INDEX IF NOT EXISTS idx_exports_re_export ON file_exports(resolved_re_export_path);
    `);
  }

  /**
   * Migrate symbols table to add new columns for nested function support
   */
  private migrateSymbolsTable(): void {
    if (!this.db) return;

    // Check if columns exist
    const tableInfo = this.db.pragma('table_info(symbols)') as Array<{ name: string }>;
    const columns = new Set(tableInfo.map(col => col.name));

    // Add missing columns
    if (!columns.has('local_name')) {
      this.db.exec('ALTER TABLE symbols ADD COLUMN local_name TEXT');
    }
    if (!columns.has('parent_function')) {
      this.db.exec('ALTER TABLE symbols ADD COLUMN parent_function TEXT');
    }
    if (!columns.has('nesting_depth')) {
      this.db.exec('ALTER TABLE symbols ADD COLUMN nesting_depth INTEGER DEFAULT 0');
    }
  }

  /**
   * Migrate files table to add parse status columns
   */
  private migrateFilesTable(): void {
    if (!this.db) return;

    const tableInfo = this.db.pragma('table_info(files)') as Array<{ name: string }>;
    const columns = new Set(tableInfo.map(col => col.name));

    if (!columns.has('parse_status')) {
      this.db.exec("ALTER TABLE files ADD COLUMN parse_status TEXT DEFAULT 'complete'");
    }
    if (!columns.has('parse_warnings')) {
      this.db.exec('ALTER TABLE files ADD COLUMN parse_warnings TEXT');
    }
    if (!columns.has('file_size')) {
      this.db.exec('ALTER TABLE files ADD COLUMN file_size INTEGER');
    }
  }

  /**
   * Migrate type_relationships table to add target_name_base column
   */
  private migrateTypeRelationshipsTable(): void {
    if (!this.db) return;

    const tableInfo = this.db.pragma('table_info(type_relationships)') as Array<{ name: string }>;
    const columns = new Set(tableInfo.map(col => col.name));

    if (!columns.has('target_name_base')) {
      this.db.exec('ALTER TABLE type_relationships ADD COLUMN target_name_base TEXT');
      // Populate existing rows: extract base name (before '<')
      this.db.exec(`
        UPDATE type_relationships
        SET target_name_base = CASE
          WHEN INSTR(target_name, '<') > 0 THEN SUBSTR(target_name, 1, INSTR(target_name, '<') - 1)
          ELSE target_name
        END
        WHERE target_name_base IS NULL
      `);
    }
  }

  async saveFile(index: FileIndex): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const transaction = this.db.transaction(() => {
      // Delete existing file and its symbols
      this.db!.prepare('DELETE FROM files WHERE file_path = ?').run(index.filePath);

      // Insert file
      const fileStmt = this.db!.prepare(`
        INSERT INTO files (file_path, relative_path, language, checksum, last_modified, summary, line_count, data, parse_status, parse_warnings, file_size)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      fileStmt.run(
        index.filePath,
        index.relativePath,
        index.language,
        index.checksum,
        index.lastModified,
        index.summary,
        index.lineCount,
        JSON.stringify(index),
        index.parseStatus ?? 'complete',
        index.parseWarnings ? JSON.stringify(index.parseWarnings) : null,
        index.fileSize ?? null
      );

      // Insert symbols
      const symbolStmt = this.db!.prepare(`
        INSERT INTO symbols (id, file_path, name, fully_qualified_name, kind, signature, language, line_start, line_end, data, local_name, parent_function, nesting_depth)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // Functions
      for (const func of index.functions) {
        symbolStmt.run(
          func.id,
          index.filePath,
          func.name,
          func.fullyQualifiedName,
          func.kind,
          func.signature,
          index.language,
          func.location.startLine,
          func.location.endLine,
          JSON.stringify(func),
          func.localName ?? func.name,
          func.parentFunction ?? null,
          func.nestingDepth ?? 0
        );
      }

      // Classes (and their methods)
      for (const cls of index.classes) {
        symbolStmt.run(
          cls.id,
          index.filePath,
          cls.name,
          cls.fullyQualifiedName,
          'class',
          cls.signature,
          index.language,
          cls.location.startLine,
          cls.location.endLine,
          JSON.stringify(cls),
          cls.name, // local_name for classes is just the name
          null,     // parent_function
          0         // nesting_depth
        );

        // Methods are stored within the class, but also indexed separately for search
        for (const method of cls.methods) {
          symbolStmt.run(
            method.id,
            index.filePath,
            method.name,
            method.fullyQualifiedName,
            method.kind,
            method.signature,
            index.language,
            method.location.startLine,
            method.location.endLine,
            JSON.stringify(method),
            method.localName ?? method.name,
            method.parentFunction ?? null,
            method.nestingDepth ?? 0
          );
        }
      }

      // Interfaces
      for (const iface of index.interfaces) {
        symbolStmt.run(
          iface.id,
          index.filePath,
          iface.name,
          iface.fullyQualifiedName,
          'interface',
          iface.signature,
          index.language,
          iface.location.startLine,
          iface.location.endLine,
          JSON.stringify(iface),
          iface.name, // local_name
          null,       // parent_function
          0           // nesting_depth
        );
      }

      // Type aliases
      for (const typeAlias of index.typeAliases) {
        symbolStmt.run(
          typeAlias.id,
          index.filePath,
          typeAlias.name,
          typeAlias.fullyQualifiedName,
          'type',
          typeAlias.signature,
          index.language,
          typeAlias.location.startLine,
          typeAlias.location.endLine,
          JSON.stringify(typeAlias),
          typeAlias.name, // local_name
          null,           // parent_function
          0               // nesting_depth
        );
      }

      // Variables
      for (const variable of index.variables) {
        symbolStmt.run(
          variable.id,
          index.filePath,
          variable.name,
          variable.fullyQualifiedName,
          'variable',
          `${variable.kind} ${variable.name}: ${variable.type ?? 'unknown'}`,
          index.language,
          variable.location.startLine,
          variable.location.endLine,
          JSON.stringify(variable),
          variable.name, // local_name
          null,          // parent_function
          0              // nesting_depth
        );
      }

      // Delete existing references, calls, type relationships, and symbol types for this file
      this.db!.prepare('DELETE FROM symbol_references WHERE referencing_file = ?').run(index.filePath);
      this.db!.prepare('DELETE FROM call_graph WHERE caller_symbol_id IN (SELECT id FROM symbols WHERE file_path = ?)').run(index.filePath);
      this.db!.prepare('DELETE FROM type_relationships WHERE source_symbol_id IN (SELECT id FROM symbols WHERE file_path = ?)').run(index.filePath);
      this.db!.prepare('DELETE FROM symbol_type_params WHERE symbol_id IN (SELECT symbol_id FROM symbol_types WHERE file_path = ?)').run(index.filePath);
      this.db!.prepare('DELETE FROM symbol_types WHERE file_path = ?').run(index.filePath);

      // Extract and save type information for functions
      const typeStmt = this.db!.prepare(`
        INSERT INTO symbol_types (
          symbol_id, symbol_name, file_path, language,
          return_type_raw, return_type_normalized, return_type_base, return_type_inner,
          return_type_is_async, return_type_is_nullable, return_type_is_array, return_type_is_generic,
          param_count, is_method, parent_class
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const paramTypeStmt = this.db!.prepare(`
        INSERT INTO symbol_type_params (
          symbol_id, param_index, param_name,
          param_type_raw, param_type_normalized, param_type_base, param_type_inner,
          param_type_is_optional, param_type_is_nullable, param_type_is_array, param_type_is_generic, param_type_has_default
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // Extract types from standalone functions
      for (const func of index.functions) {
        const typeInfo = extractFunctionTypeInfo(func, index.filePath, index.language);
        this.saveTypeInfoInternal(typeStmt, paramTypeStmt, typeInfo);
      }

      // Extract types from class methods
      for (const cls of index.classes) {
        for (const method of cls.methods) {
          const typeInfo = extractFunctionTypeInfo(
            { ...method, parentClass: cls.name },
            index.filePath,
            index.language
          );
          this.saveTypeInfoInternal(typeStmt, paramTypeStmt, typeInfo);
        }
      }

      // Insert references
      if (index.references && index.references.length > 0) {
        const refStmt = this.db!.prepare(`
          INSERT INTO symbol_references (id, symbol_id, symbol_name, referencing_file, referencing_symbol_id, referencing_symbol_name, line_number, column_number, context, reference_kind)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const ref of index.references) {
          refStmt.run(
            ref.id,
            ref.symbolId,
            ref.symbolName,
            ref.referencingFile,
            ref.referencingSymbolId ?? null,
            ref.referencingSymbolName ?? null,
            ref.lineNumber,
            ref.columnNumber ?? null,
            ref.context,
            ref.referenceKind
          );
        }
      }

      // Insert call graph edges
      if (index.calls && index.calls.length > 0) {
        const callStmt = this.db!.prepare(`
          INSERT OR REPLACE INTO call_graph (id, caller_symbol_id, caller_name, callee_name, callee_symbol_id, call_count, is_async, is_conditional)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const call of index.calls) {
          callStmt.run(
            call.id,
            call.callerSymbolId,
            call.callerName,
            call.calleeName,
            call.calleeSymbolId ?? null,
            call.callCount,
            call.isAsync ? 1 : 0,
            call.isConditional ? 1 : 0
          );
        }
      }

      // Insert type relationships
      if (index.typeRelationships && index.typeRelationships.length > 0) {
        const typeRelStmt = this.db!.prepare(`
          INSERT INTO type_relationships (id, source_symbol_id, source_name, target_name, target_name_base, target_symbol_id, relationship_kind)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        for (const rel of index.typeRelationships) {
          // Extract base type name (before generic '<')
          const targetNameBase = rel.targetName.includes('<')
            ? rel.targetName.substring(0, rel.targetName.indexOf('<'))
            : rel.targetName;

          typeRelStmt.run(
            rel.id,
            rel.sourceSymbolId,
            rel.sourceName,
            rel.targetName,
            targetNameBase,
            rel.targetSymbolId ?? null,
            rel.relationshipKind
          );
        }
      }
    });

    transaction();
    this.cacheValid = false;
  }

  async getFile(filePath: string): Promise<FileIndex | null> {
    if (!this.db) throw new Error('Database not initialized');

    const row = this.db.prepare('SELECT data FROM files WHERE file_path = ?').get(filePath) as { data: string } | undefined;

    if (!row) return null;

    return JSON.parse(row.data) as FileIndex;
  }

  async deleteFile(filePath: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    // Manually clean up call_graph and type_relationships since they no longer have FK constraints
    this.db.prepare('DELETE FROM call_graph WHERE caller_symbol_id IN (SELECT id FROM symbols WHERE file_path = ?)').run(filePath);
    this.db.prepare('DELETE FROM type_relationships WHERE source_symbol_id IN (SELECT id FROM symbols WHERE file_path = ?)').run(filePath);

    this.db.prepare('DELETE FROM files WHERE file_path = ?').run(filePath);
    this.cacheValid = false;
  }

  async getFileByChecksum(checksum: string): Promise<FileIndex | null> {
    if (!this.db) throw new Error('Database not initialized');

    const row = this.db.prepare('SELECT data FROM files WHERE checksum = ?').get(checksum) as { data: string } | undefined;

    if (!row) return null;

    return JSON.parse(row.data) as FileIndex;
  }

  async listFiles(options?: { directory?: string; language?: Language }): Promise<FileIndex[]> {
    if (!this.db) throw new Error('Database not initialized');

    let query = 'SELECT data FROM files WHERE 1=1';
    const params: (string | number)[] = [];

    if (options?.directory) {
      query += ' AND relative_path LIKE ?';
      params.push(`${options.directory}%`);
    }

    if (options?.language) {
      query += ' AND language = ?';
      params.push(options.language);
    }

    query += ' ORDER BY file_path';

    const rows = this.db.prepare(query).all(...params) as { data: string }[];

    return rows.map(row => JSON.parse(row.data) as FileIndex);
  }

  async getAllFilePaths(): Promise<Array<{ filePath: string; relativePath: string }>> {
    if (!this.db) throw new Error('Database not initialized');

    const rows = this.db.prepare('SELECT file_path, relative_path FROM files').all() as Array<{
      file_path: string;
      relative_path: string;
    }>;

    return rows.map(row => ({
      filePath: row.file_path,
      relativePath: row.relative_path,
    }));
  }

  async getFunction(filePath: string, name: string): Promise<FunctionSignature | null> {
    if (!this.db) throw new Error('Database not initialized');

    // Strategy 1: Exact match on qualified name
    let row = this.db.prepare(`
      SELECT data FROM symbols
      WHERE file_path = ? AND name = ? AND kind IN ('function', 'method', 'constructor', 'callback')
    `).get(filePath, name) as { data: string } | undefined;

    if (row) {
      return JSON.parse(row.data) as FunctionSignature;
    }

    // Strategy 2: Match on local_name if unique within file
    const localNameRows = this.db.prepare(`
      SELECT data FROM symbols
      WHERE file_path = ? AND local_name = ? AND kind IN ('function', 'method', 'constructor', 'callback')
    `).all(filePath, name) as { data: string }[];

    if (localNameRows.length === 1) {
      return JSON.parse(localNameRows[0]!.data) as FunctionSignature;
    }

    // Strategy 3: Suffix match for partial qualification (e.g., "parent.child" matches "grandparent.parent.child")
    if (name.includes('.')) {
      const suffixRows = this.db.prepare(`
        SELECT data FROM symbols
        WHERE file_path = ? AND name LIKE ? AND kind IN ('function', 'method', 'constructor', 'callback')
      `).all(filePath, `%.${name}`) as { data: string }[];

      if (suffixRows.length === 1) {
        return JSON.parse(suffixRows[0]!.data) as FunctionSignature;
      }
    }

    return null;
  }

  /**
   * Get a function with more detailed error information for ambiguous matches
   * Returns either the function or an error with suggestions
   */
  async getFunctionWithDetails(
    filePath: string,
    name: string
  ): Promise<{ success: true; function: FunctionSignature } | { success: false; error: string; suggestions?: string[] }> {
    if (!this.db) throw new Error('Database not initialized');

    // Strategy 1: Exact match on qualified name
    let row = this.db.prepare(`
      SELECT data FROM symbols
      WHERE file_path = ? AND name = ? AND kind IN ('function', 'method', 'constructor', 'callback')
    `).get(filePath, name) as { data: string } | undefined;

    if (row) {
      return { success: true, function: JSON.parse(row.data) as FunctionSignature };
    }

    // Strategy 2: Match on local_name
    const localNameRows = this.db.prepare(`
      SELECT data, name FROM symbols
      WHERE file_path = ? AND local_name = ? AND kind IN ('function', 'method', 'constructor', 'callback')
    `).all(filePath, name) as { data: string; name: string }[];

    if (localNameRows.length === 1) {
      return { success: true, function: JSON.parse(localNameRows[0]!.data) as FunctionSignature };
    }

    if (localNameRows.length > 1) {
      // Multiple matches - return suggestions
      const suggestions = localNameRows.map(r => r.name);
      return {
        success: false,
        error: `Multiple functions named "${name}" found. Please use the qualified name.`,
        suggestions,
      };
    }

    // Strategy 3: Suffix match for partial qualification
    if (name.includes('.')) {
      const suffixRows = this.db.prepare(`
        SELECT data, name FROM symbols
        WHERE file_path = ? AND name LIKE ? AND kind IN ('function', 'method', 'constructor', 'callback')
      `).all(filePath, `%.${name}`) as { data: string; name: string }[];

      if (suffixRows.length === 1) {
        return { success: true, function: JSON.parse(suffixRows[0]!.data) as FunctionSignature };
      }

      if (suffixRows.length > 1) {
        const suggestions = suffixRows.map(r => r.name);
        return {
          success: false,
          error: `Multiple functions match "${name}". Please use the full qualified name.`,
          suggestions,
        };
      }
    }

    return { success: false, error: `Function "${name}" not found` };
  }

  async getClass(filePath: string, name: string): Promise<ClassSignature | null> {
    if (!this.db) throw new Error('Database not initialized');

    const row = this.db.prepare(`
      SELECT data FROM symbols
      WHERE file_path = ? AND name = ? AND kind = 'class'
    `).get(filePath, name) as { data: string } | undefined;

    if (!row) return null;

    return JSON.parse(row.data) as ClassSignature;
  }

  async getInterface(filePath: string, name: string): Promise<InterfaceSignature | null> {
    if (!this.db) throw new Error('Database not initialized');

    const row = this.db.prepare(`
      SELECT data FROM symbols
      WHERE file_path = ? AND name = ? AND kind = 'interface'
    `).get(filePath, name) as { data: string } | undefined;

    if (!row) return null;

    return JSON.parse(row.data) as InterfaceSignature;
  }

  /**
   * Try to get a class first, falling back to interface if not found.
   * Returns a discriminated union indicating which type was found.
   */
  async getClassOrInterface(
    filePath: string,
    name: string
  ): Promise<{ type: 'class'; data: ClassSignature } | { type: 'interface'; data: InterfaceSignature } | null> {
    if (!this.db) throw new Error('Database not initialized');

    // Try class first
    const classRow = this.db.prepare(`
      SELECT data FROM symbols
      WHERE file_path = ? AND name = ? AND kind = 'class'
    `).get(filePath, name) as { data: string } | undefined;

    if (classRow) {
      return { type: 'class', data: JSON.parse(classRow.data) as ClassSignature };
    }

    // Fallback to interface
    const ifaceRow = this.db.prepare(`
      SELECT data FROM symbols
      WHERE file_path = ? AND name = ? AND kind = 'interface'
    `).get(filePath, name) as { data: string } | undefined;

    if (ifaceRow) {
      return { type: 'interface', data: JSON.parse(ifaceRow.data) as InterfaceSignature };
    }

    return null;
  }

  async getTypeAlias(filePath: string, name: string): Promise<TypeAliasSignature | null> {
    if (!this.db) throw new Error('Database not initialized');

    const row = this.db.prepare(`
      SELECT data FROM symbols
      WHERE file_path = ? AND name = ? AND kind = 'type'
    `).get(filePath, name) as { data: string } | undefined;

    if (!row) return null;

    return JSON.parse(row.data) as TypeAliasSignature;
  }

  async getVariable(filePath: string, name: string): Promise<VariableSignature | null> {
    if (!this.db) throw new Error('Database not initialized');

    const row = this.db.prepare(`
      SELECT data FROM symbols
      WHERE file_path = ? AND name = ? AND kind = 'variable'
    `).get(filePath, name) as { data: string } | undefined;

    if (!row) return null;

    return JSON.parse(row.data) as VariableSignature;
  }

  async searchSymbols(query: string, options?: QueryOptions): Promise<SearchResult[]> {
    if (!this.db) throw new Error('Database not initialized');

    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    // First try FTS search
    let ftsQuery = `
      SELECT s.id, s.name, s.kind, s.signature, s.file_path, s.line_start, bm25(symbols_fts) as score
      FROM symbols_fts fts
      JOIN symbols s ON s.rowid = fts.rowid
      WHERE symbols_fts MATCH ?
    `;

    // Check if query already has FTS operators (OR, *, etc.) - if so, use as-is
    const hasFtsOperators = /\s+OR\s+/i.test(query) || query.includes('*') || query.includes('"');
    const ftsSearchQuery = hasFtsOperators ? query : query + '*';
    const ftsParams: (string | number)[] = [ftsSearchQuery];

    if (options?.type && options.type !== 'all') {
      if (options.type === 'function') {
        ftsQuery += ` AND s.kind IN ('function', 'method', 'constructor', 'callback')`;
      } else {
        ftsQuery += ` AND s.kind = ?`;
        ftsParams.push(options.type);
      }
    }

    if (options?.language) {
      ftsQuery += ` AND s.language = ?`;
      ftsParams.push(options.language);
    }

    ftsQuery += ` ORDER BY score LIMIT ? OFFSET ?`;
    ftsParams.push(limit, offset);

    try {
      const rows = this.db.prepare(ftsQuery).all(...ftsParams) as Array<{
        id: string;
        name: string;
        kind: string;
        signature: string;
        file_path: string;
        line_start: number;
        score: number;
      }>;

      if (rows.length > 0) {
        return rows.map(row => ({
          symbol: {
            id: row.id,
            name: row.name,
            kind: row.kind,
            signature: row.signature,
            filePath: row.file_path,
            line: row.line_start,
          },
          score: Math.abs(row.score),
          matches: [],
        }));
      }
    } catch {
      // FTS query failed, fall back to fuzzy search
    }

    // Fall back to Fuse.js fuzzy search
    return this.fuzzySearch(query, options);
  }

  private async fuzzySearch(query: string, options?: QueryOptions): Promise<SearchResult[]> {
    if (!this.db) throw new Error('Database not initialized');

    // Rebuild cache if needed
    if (!this.cacheValid || this.symbolCache.length === 0) {
      let sql = 'SELECT * FROM symbols WHERE 1=1';
      const params: (string | number)[] = [];

      if (options?.type && options.type !== 'all') {
        if (options.type === 'function') {
          sql += ` AND kind IN ('function', 'method', 'constructor', 'callback')`;
        } else {
          sql += ` AND kind = ?`;
          params.push(options.type);
        }
      }

      if (options?.language) {
        sql += ` AND language = ?`;
        params.push(options.language);
      }

      this.symbolCache = this.db.prepare(sql).all(...params) as SymbolRow[];
      this.fuse = new Fuse(this.symbolCache, {
        keys: ['name', 'fully_qualified_name', 'signature'],
        threshold: 0.4,
        includeScore: true,
        includeMatches: true,
      });
      this.cacheValid = true;
    }

    if (!this.fuse) return [];

    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const results = this.fuse.search(query, { limit: limit + offset });

    return results.slice(offset, offset + limit).map(result => ({
      symbol: {
        id: result.item.id,
        name: result.item.name,
        kind: result.item.kind,
        signature: result.item.signature,
        filePath: result.item.file_path,
        line: result.item.line_start,
      },
      score: 1 - (result.score ?? 0),
      matches: (result.matches ?? []).map(m => ({
        field: m.key ?? '',
        indices: m.indices as Array<[number, number]>,
      })),
    }));
  }

  async getStats(): Promise<IndexStats> {
    if (!this.db) throw new Error('Database not initialized');

    const totalFiles = this.db.prepare('SELECT COUNT(*) as count FROM files').get() as { count: number };
    const totalSymbols = this.db.prepare('SELECT COUNT(*) as count FROM symbols').get() as { count: number };

    const byLanguage: Record<Language, LanguageStats> = {
      typescript: { files: 0, functions: 0, classes: 0, interfaces: 0, typeAliases: 0, variables: 0 },
      javascript: { files: 0, functions: 0, classes: 0, interfaces: 0, typeAliases: 0, variables: 0 },
      python: { files: 0, functions: 0, classes: 0, interfaces: 0, typeAliases: 0, variables: 0 },
      config: { files: 0, functions: 0, classes: 0, interfaces: 0, typeAliases: 0, variables: 0 },
    };

    // Get file counts by language
    const fileCounts = this.db.prepare(`
      SELECT language, COUNT(*) as count FROM files GROUP BY language
    `).all() as Array<{ language: Language; count: number }>;

    for (const row of fileCounts) {
      if (byLanguage[row.language]) {
        byLanguage[row.language].files = row.count;
      }
    }

    // Get symbol counts by language and kind
    const symbolCounts = this.db.prepare(`
      SELECT language, kind, COUNT(*) as count FROM symbols GROUP BY language, kind
    `).all() as Array<{ language: Language; kind: string; count: number }>;

    for (const row of symbolCounts) {
      if (!byLanguage[row.language]) continue;

      switch (row.kind) {
        case 'function':
        case 'method':
        case 'constructor':
        case 'callback':
          byLanguage[row.language].functions += row.count;
          break;
        case 'class':
          byLanguage[row.language].classes = row.count;
          break;
        case 'interface':
          byLanguage[row.language].interfaces = row.count;
          break;
        case 'type':
          byLanguage[row.language].typeAliases = row.count;
          break;
        case 'variable':
          byLanguage[row.language].variables = row.count;
          break;
      }
    }

    return {
      totalFiles: totalFiles.count,
      totalSymbols: totalSymbols.count,
      byLanguage,
      indexingDurationMs: 0, // Updated during indexing
    };
  }

  // Reference tracking methods
  async getReferences(symbolId: string): Promise<SymbolReference[]> {
    if (!this.db) throw new Error('Database not initialized');

    const rows = this.db.prepare(`
      SELECT * FROM symbol_references WHERE symbol_id = ?
      ORDER BY referencing_file, line_number
    `).all(symbolId) as Array<{
      id: string;
      symbol_id: string;
      symbol_name: string;
      referencing_file: string;
      referencing_symbol_id: string | null;
      referencing_symbol_name: string | null;
      line_number: number;
      column_number: number | null;
      context: string;
      reference_kind: ReferenceKind;
    }>;

    return rows.map(row => ({
      id: row.id,
      symbolId: row.symbol_id,
      symbolName: row.symbol_name,
      referencingFile: row.referencing_file,
      referencingSymbolId: row.referencing_symbol_id ?? undefined,
      referencingSymbolName: row.referencing_symbol_name ?? undefined,
      lineNumber: row.line_number,
      columnNumber: row.column_number ?? undefined,
      context: row.context,
      referenceKind: row.reference_kind,
    }));
  }

  async getReferencesByName(symbolName: string): Promise<SymbolReference[]> {
    if (!this.db) throw new Error('Database not initialized');

    const rows = this.db.prepare(`
      SELECT * FROM symbol_references WHERE symbol_name = ?
      ORDER BY referencing_file, line_number
    `).all(symbolName) as Array<{
      id: string;
      symbol_id: string;
      symbol_name: string;
      referencing_file: string;
      referencing_symbol_id: string | null;
      referencing_symbol_name: string | null;
      line_number: number;
      column_number: number | null;
      context: string;
      reference_kind: ReferenceKind;
    }>;

    return rows.map(row => ({
      id: row.id,
      symbolId: row.symbol_id,
      symbolName: row.symbol_name,
      referencingFile: row.referencing_file,
      referencingSymbolId: row.referencing_symbol_id ?? undefined,
      referencingSymbolName: row.referencing_symbol_name ?? undefined,
      lineNumber: row.line_number,
      columnNumber: row.column_number ?? undefined,
      context: row.context,
      referenceKind: row.reference_kind,
    }));
  }

  async getReferencesInFile(filePath: string): Promise<SymbolReference[]> {
    if (!this.db) throw new Error('Database not initialized');

    const rows = this.db.prepare(`
      SELECT * FROM symbol_references WHERE referencing_file = ?
      ORDER BY line_number
    `).all(filePath) as Array<{
      id: string;
      symbol_id: string;
      symbol_name: string;
      referencing_file: string;
      referencing_symbol_id: string | null;
      referencing_symbol_name: string | null;
      line_number: number;
      column_number: number | null;
      context: string;
      reference_kind: ReferenceKind;
    }>;

    return rows.map(row => ({
      id: row.id,
      symbolId: row.symbol_id,
      symbolName: row.symbol_name,
      referencingFile: row.referencing_file,
      referencingSymbolId: row.referencing_symbol_id ?? undefined,
      referencingSymbolName: row.referencing_symbol_name ?? undefined,
      lineNumber: row.line_number,
      columnNumber: row.column_number ?? undefined,
      context: row.context,
      referenceKind: row.reference_kind,
    }));
  }

  // Call graph methods
  async getCallers(symbolId: string): Promise<CallGraphEdge[]> {
    if (!this.db) throw new Error('Database not initialized');

    const rows = this.db.prepare(`
      SELECT * FROM call_graph WHERE callee_symbol_id = ?
      ORDER BY caller_name
    `).all(symbolId) as Array<{
      id: string;
      caller_symbol_id: string;
      caller_name: string;
      callee_name: string;
      callee_symbol_id: string | null;
      call_count: number;
      is_async: number;
      is_conditional: number;
    }>;

    return rows.map(row => ({
      id: row.id,
      callerSymbolId: row.caller_symbol_id,
      callerName: row.caller_name,
      calleeName: row.callee_name,
      calleeSymbolId: row.callee_symbol_id ?? undefined,
      callCount: row.call_count,
      isAsync: row.is_async === 1,
      isConditional: row.is_conditional === 1,
    }));
  }

  async getCallersByName(calleeName: string): Promise<CallGraphEdge[]> {
    if (!this.db) throw new Error('Database not initialized');

    const rows = this.db.prepare(`
      SELECT * FROM call_graph WHERE callee_name = ?
      ORDER BY caller_name
    `).all(calleeName) as Array<{
      id: string;
      caller_symbol_id: string;
      caller_name: string;
      callee_name: string;
      callee_symbol_id: string | null;
      call_count: number;
      is_async: number;
      is_conditional: number;
    }>;

    return rows.map(row => ({
      id: row.id,
      callerSymbolId: row.caller_symbol_id,
      callerName: row.caller_name,
      calleeName: row.callee_name,
      calleeSymbolId: row.callee_symbol_id ?? undefined,
      callCount: row.call_count,
      isAsync: row.is_async === 1,
      isConditional: row.is_conditional === 1,
    }));
  }

  async getCallees(symbolId: string): Promise<CallGraphEdge[]> {
    if (!this.db) throw new Error('Database not initialized');

    const rows = this.db.prepare(`
      SELECT * FROM call_graph WHERE caller_symbol_id = ?
      ORDER BY callee_name
    `).all(symbolId) as Array<{
      id: string;
      caller_symbol_id: string;
      caller_name: string;
      callee_name: string;
      callee_symbol_id: string | null;
      call_count: number;
      is_async: number;
      is_conditional: number;
    }>;

    return rows.map(row => ({
      id: row.id,
      callerSymbolId: row.caller_symbol_id,
      callerName: row.caller_name,
      calleeName: row.callee_name,
      calleeSymbolId: row.callee_symbol_id ?? undefined,
      callCount: row.call_count,
      isAsync: row.is_async === 1,
      isConditional: row.is_conditional === 1,
    }));
  }

  async getCalleesByName(callerName: string): Promise<CallGraphEdge[]> {
    if (!this.db) throw new Error('Database not initialized');

    const rows = this.db.prepare(`
      SELECT * FROM call_graph WHERE caller_name = ?
      ORDER BY callee_name
    `).all(callerName) as Array<{
      id: string;
      caller_symbol_id: string;
      caller_name: string;
      callee_name: string;
      callee_symbol_id: string | null;
      call_count: number;
      is_async: number;
      is_conditional: number;
    }>;

    return rows.map(row => ({
      id: row.id,
      callerSymbolId: row.caller_symbol_id,
      callerName: row.caller_name,
      calleeName: row.callee_name,
      calleeSymbolId: row.callee_symbol_id ?? undefined,
      callCount: row.call_count,
      isAsync: row.is_async === 1,
      isConditional: row.is_conditional === 1,
    }));
  }

  // Type hierarchy methods
  async getTypeHierarchy(symbolId: string): Promise<TypeRelationship[]> {
    if (!this.db) throw new Error('Database not initialized');

    const rows = this.db.prepare(`
      SELECT * FROM type_relationships WHERE source_symbol_id = ?
      ORDER BY target_name
    `).all(symbolId) as Array<{
      id: string;
      source_symbol_id: string;
      source_name: string;
      target_name: string;
      target_symbol_id: string | null;
      relationship_kind: RelationshipKind;
    }>;

    return rows.map(row => ({
      id: row.id,
      sourceSymbolId: row.source_symbol_id,
      sourceName: row.source_name,
      targetName: row.target_name,
      targetSymbolId: row.target_symbol_id ?? undefined,
      relationshipKind: row.relationship_kind,
    }));
  }

  async getTypeHierarchyByName(className: string): Promise<TypeRelationship[]> {
    if (!this.db) throw new Error('Database not initialized');

    const rows = this.db.prepare(`
      SELECT * FROM type_relationships WHERE source_name = ?
      ORDER BY target_name
    `).all(className) as Array<{
      id: string;
      source_symbol_id: string;
      source_name: string;
      target_name: string;
      target_symbol_id: string | null;
      relationship_kind: RelationshipKind;
    }>;

    return rows.map(row => ({
      id: row.id,
      sourceSymbolId: row.source_symbol_id,
      sourceName: row.source_name,
      targetName: row.target_name,
      targetSymbolId: row.target_symbol_id ?? undefined,
      relationshipKind: row.relationship_kind,
    }));
  }

  async findImplementations(interfaceName: string): Promise<TypeRelationship[]> {
    if (!this.db) throw new Error('Database not initialized');

    // Search by both full target_name and base name (for generic types like Repository<User>)
    const rows = this.db.prepare(`
      SELECT * FROM type_relationships
      WHERE (target_name = ? OR target_name_base = ?)
        AND relationship_kind IN ('implements', 'extends')
      ORDER BY source_name
    `).all(interfaceName, interfaceName) as Array<{
      id: string;
      source_symbol_id: string;
      source_name: string;
      target_name: string;
      target_symbol_id: string | null;
      relationship_kind: RelationshipKind;
    }>;

    return rows.map(row => ({
      id: row.id,
      sourceSymbolId: row.source_symbol_id,
      sourceName: row.source_name,
      targetName: row.target_name,
      targetSymbolId: row.target_symbol_id ?? undefined,
      relationshipKind: row.relationship_kind,
    }));
  }

  async getSubtypes(className: string): Promise<TypeRelationship[]> {
    if (!this.db) throw new Error('Database not initialized');

    const rows = this.db.prepare(`
      SELECT * FROM type_relationships
      WHERE target_name = ?
      ORDER BY source_name
    `).all(className) as Array<{
      id: string;
      source_symbol_id: string;
      source_name: string;
      target_name: string;
      target_symbol_id: string | null;
      relationship_kind: RelationshipKind;
    }>;

    return rows.map(row => ({
      id: row.id,
      sourceSymbolId: row.source_symbol_id,
      sourceName: row.source_name,
      targetName: row.target_name,
      targetSymbolId: row.target_symbol_id ?? undefined,
      relationshipKind: row.relationship_kind,
    }));
  }

  // Resolution method: Link names to symbol IDs across files
  async resolveSymbolReferences(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    // Resolve callee_symbol_id in call_graph based on callee_name matching symbol name
    this.db.exec(`
      UPDATE call_graph
      SET callee_symbol_id = (
        SELECT id FROM symbols WHERE name = call_graph.callee_name LIMIT 1
      )
      WHERE callee_symbol_id IS NULL
    `);

    // Resolve target_symbol_id in type_relationships based on target_name matching symbol name
    this.db.exec(`
      UPDATE type_relationships
      SET target_symbol_id = (
        SELECT id FROM symbols WHERE name = type_relationships.target_name AND kind IN ('class', 'interface') LIMIT 1
      )
      WHERE target_symbol_id IS NULL
    `);

    // Resolve symbol_id in symbol_references based on symbol_name matching symbol name
    this.db.exec(`
      UPDATE symbol_references
      SET symbol_id = (
        SELECT id FROM symbols WHERE name = symbol_references.symbol_name LIMIT 1
      )
      WHERE (symbol_id = '' OR symbol_id IS NULL)
      AND EXISTS (
        SELECT 1 FROM symbols WHERE name = symbol_references.symbol_name
      )
    `);
  }

  // Helper method to save type info
  private saveTypeInfoInternal(
    typeStmt: Database.Statement,
    paramTypeStmt: Database.Statement,
    typeInfo: SymbolTypeInfo
  ): void {
    const rt = typeInfo.returnType;
    typeStmt.run(
      typeInfo.symbolId,
      typeInfo.symbolName,
      typeInfo.filePath,
      typeInfo.language,
      rt?.raw ?? null,
      rt?.normalized ?? null,
      rt?.base?.toLowerCase() ?? null,
      rt?.inner?.join(',').toLowerCase() ?? null,
      rt?.isAsync ? 1 : 0,
      rt?.isNullable ? 1 : 0,
      rt?.isArray ? 1 : 0,
      rt?.isGeneric ? 1 : 0,
      typeInfo.paramCount,
      typeInfo.isMethod ? 1 : 0,
      typeInfo.parentClass
    );

    for (const param of typeInfo.parameters) {
      const pt = param.type;
      paramTypeStmt.run(
        typeInfo.symbolId,
        param.index,
        param.name,
        pt?.raw ?? null,
        pt?.normalized ?? null,
        pt?.base?.toLowerCase() ?? null,
        pt?.inner?.join(',').toLowerCase() ?? null,
        pt?.isOptional ? 1 : 0,
        pt?.isNullable ? 1 : 0,
        pt?.isArray ? 1 : 0,
        pt?.isGeneric ? 1 : 0,
        pt?.hasDefault ? 1 : 0
      );
    }
  }

  // Type-based search methods
  async searchByReturnType(
    returnType: string,
    options?: {
      matchMode?: 'exact' | 'base' | 'inner' | 'partial';
      includeAsyncVariants?: boolean;
      includeNullableVariants?: boolean;
      language?: Language;
      limit?: number;
    }
  ): Promise<Array<{
    symbolId: string;
    symbolName: string;
    filePath: string;
    language: Language;
    returnType: string;
    paramCount: number;
    isMethod: boolean;
    parentClass: string | null;
  }>> {
    if (!this.db) throw new Error('Database not initialized');

    const matchMode = options?.matchMode ?? 'base';
    const limit = options?.limit ?? 50;
    const searchBase = returnType.toLowerCase().replace(/[<>\[\]]/g, ' ').trim().split(/\s+/)[0] ?? returnType.toLowerCase();

    let query = 'SELECT * FROM symbol_types WHERE 1=1';
    const params: (string | number)[] = [];

    if (options?.language) {
      query += ' AND language = ?';
      params.push(options.language);
    }

    if (matchMode === 'exact') {
      query += ' AND return_type_normalized = ?';
      params.push(returnType);
    } else if (matchMode === 'base') {
      query += ' AND return_type_base = ?';
      params.push(searchBase);
      // Include async variants: T matches Promise<T>
      if (options?.includeAsyncVariants) {
        query = query.replace(
          'AND return_type_base = ?',
          'AND (return_type_base = ? OR (return_type_is_async = 1 AND return_type_inner LIKE ?))'
        );
        params.push(`%${searchBase}%`);
      }
    } else if (matchMode === 'inner') {
      query += ' AND return_type_inner LIKE ?';
      params.push(`%${searchBase}%`);
    } else {
      // partial
      query += ' AND (return_type_base LIKE ? OR return_type_inner LIKE ? OR return_type_normalized LIKE ?)';
      params.push(`%${searchBase}%`, `%${searchBase}%`, `%${searchBase}%`);
    }

    query += ' ORDER BY symbol_name LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(query).all(...params) as Array<{
      symbol_id: string;
      symbol_name: string;
      file_path: string;
      language: Language;
      return_type_normalized: string;
      param_count: number;
      is_method: number;
      parent_class: string | null;
    }>;

    return rows.map(row => ({
      symbolId: row.symbol_id,
      symbolName: row.symbol_name,
      filePath: row.file_path,
      language: row.language,
      returnType: row.return_type_normalized ?? 'void',
      paramCount: row.param_count,
      isMethod: row.is_method === 1,
      parentClass: row.parent_class,
    }));
  }

  async searchByParamType(
    paramType: string,
    options?: {
      paramName?: string;
      matchMode?: 'exact' | 'base' | 'inner' | 'partial';
      language?: Language;
      limit?: number;
    }
  ): Promise<Array<{
    symbolId: string;
    symbolName: string;
    filePath: string;
    language: Language;
    paramName: string;
    paramType: string;
    paramIndex: number;
  }>> {
    if (!this.db) throw new Error('Database not initialized');

    const matchMode = options?.matchMode ?? 'base';
    const limit = options?.limit ?? 50;
    const searchBase = paramType.toLowerCase().replace(/[<>\[\]]/g, ' ').trim().split(/\s+/)[0] ?? paramType.toLowerCase();

    let query = `
      SELECT stp.*, st.symbol_name, st.file_path, st.language
      FROM symbol_type_params stp
      JOIN symbol_types st ON st.symbol_id = stp.symbol_id
      WHERE 1=1
    `;
    const params: (string | number)[] = [];

    if (options?.language) {
      query += ' AND st.language = ?';
      params.push(options.language);
    }

    if (options?.paramName) {
      query += ' AND stp.param_name = ?';
      params.push(options.paramName);
    }

    if (matchMode === 'exact') {
      query += ' AND stp.param_type_normalized = ?';
      params.push(paramType);
    } else if (matchMode === 'base') {
      query += ' AND stp.param_type_base = ?';
      params.push(searchBase);
    } else if (matchMode === 'inner') {
      query += ' AND stp.param_type_inner LIKE ?';
      params.push(`%${searchBase}%`);
    } else {
      // partial
      query += ' AND (stp.param_type_base LIKE ? OR stp.param_type_inner LIKE ? OR stp.param_type_normalized LIKE ?)';
      params.push(`%${searchBase}%`, `%${searchBase}%`, `%${searchBase}%`);
    }

    query += ' ORDER BY st.symbol_name LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(query).all(...params) as Array<{
      symbol_id: string;
      symbol_name: string;
      file_path: string;
      language: Language;
      param_name: string;
      param_type_normalized: string;
      param_index: number;
    }>;

    return rows.map(row => ({
      symbolId: row.symbol_id,
      symbolName: row.symbol_name,
      filePath: row.file_path,
      language: row.language,
      paramName: row.param_name,
      paramType: row.param_type_normalized ?? 'any',
      paramIndex: row.param_index,
    }));
  }

  async searchByType(options: TypeSearchOptions): Promise<Array<{
    symbolId: string;
    symbolName: string;
    filePath: string;
    language: Language;
    returnType: string | null;
    paramCount: number;
    isMethod: boolean;
    parentClass: string | null;
    matchedParams?: Array<{ name: string; type: string; index: number }>;
  }>> {
    if (!this.db) throw new Error('Database not initialized');

    const limit = options.limit ?? 50;
    const matchMode = options.matchMode ?? 'base';
    const results: Map<string, {
      symbolId: string;
      symbolName: string;
      filePath: string;
      language: Language;
      returnType: string | null;
      paramCount: number;
      isMethod: boolean;
      parentClass: string | null;
      matchedParams: Array<{ name: string; type: string; index: number }>;
    }> = new Map();

    // Search by return type if specified
    if (options.returnType) {
      const returnMatches = await this.searchByReturnType(options.returnType, {
        matchMode,
        includeAsyncVariants: options.includeAsyncVariants,
        includeNullableVariants: options.includeNullableVariants,
        language: options.language,
        limit: limit * 2, // Get more to allow filtering
      });

      for (const match of returnMatches) {
        results.set(match.symbolId, {
          ...match,
          returnType: match.returnType,
          matchedParams: [],
        });
      }
    }

    // Search by param type if specified
    if (options.paramType) {
      const paramMatches = await this.searchByParamType(options.paramType, {
        matchMode,
        language: options.language,
        limit: limit * 2,
      });

      for (const match of paramMatches) {
        const existing = results.get(match.symbolId);
        if (existing) {
          existing.matchedParams.push({
            name: match.paramName,
            type: match.paramType,
            index: match.paramIndex,
          });
        } else if (!options.returnType) {
          // If no return type filter, add this result
          // Get full symbol info
          const symbolInfo = await this.getSymbolTypeInfo(match.symbolId);
          if (symbolInfo) {
            results.set(match.symbolId, {
              symbolId: match.symbolId,
              symbolName: match.symbolName,
              filePath: match.filePath,
              language: match.language,
              returnType: symbolInfo.returnType,
              paramCount: symbolInfo.paramCount,
              isMethod: symbolInfo.isMethod,
              parentClass: symbolInfo.parentClass,
              matchedParams: [{
                name: match.paramName,
                type: match.paramType,
                index: match.paramIndex,
              }],
            });
          }
        }
      }
    }

    // If both filters specified, keep only results that matched both
    if (options.returnType && options.paramType) {
      for (const [id, result] of results) {
        if (result.matchedParams.length === 0) {
          results.delete(id);
        }
      }
    }

    const finalResults = Array.from(results.values()).slice(0, limit);
    return finalResults;
  }

  async getSymbolTypeInfo(symbolId: string): Promise<{
    returnType: string | null;
    paramCount: number;
    isMethod: boolean;
    parentClass: string | null;
  } | null> {
    if (!this.db) throw new Error('Database not initialized');

    const row = this.db.prepare(`
      SELECT return_type_normalized, param_count, is_method, parent_class
      FROM symbol_types WHERE symbol_id = ?
    `).get(symbolId) as {
      return_type_normalized: string | null;
      param_count: number;
      is_method: number;
      parent_class: string | null;
    } | undefined;

    if (!row) return null;

    return {
      returnType: row.return_type_normalized,
      paramCount: row.param_count,
      isMethod: row.is_method === 1,
      parentClass: row.parent_class,
    };
  }

  // =============================================
  // Markov Chain Methods
  // =============================================

  async getOrCreateChain(chainType: string): Promise<string> {
    if (!this.db) throw new Error('Database not initialized');

    const chainId = `chain_${chainType}`;
    const existing = this.db.prepare('SELECT id FROM markov_chains WHERE id = ?').get(chainId);

    if (!existing) {
      this.db.prepare(`
        INSERT INTO markov_chains (id, chain_type, created_at, updated_at, total_states, total_transitions, config)
        VALUES (?, ?, ?, ?, 0, 0, '{}')
      `).run(chainId, chainType, Date.now(), Date.now());
    }

    return chainId;
  }

  async getChainId(chainType: string): Promise<string | null> {
    if (!this.db) throw new Error('Database not initialized');

    const chainId = `chain_${chainType}`;
    const row = this.db.prepare('SELECT id FROM markov_chains WHERE id = ?').get(chainId) as { id: string } | undefined;
    return row?.id ?? null;
  }

  async getAllChainIds(): Promise<string[]> {
    if (!this.db) throw new Error('Database not initialized');

    const rows = this.db.prepare('SELECT id FROM markov_chains').all() as Array<{ id: string }>;
    return rows.map(r => r.id);
  }

  async saveTransitions(
    chainId: string,
    transitions: Array<{
      fromStateId: string;
      fromStateName: string;
      toStateId: string;
      toStateName: string;
      rawCount: number;
      probability: number;
      metadata?: Record<string, unknown>;
    }>
  ): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      INSERT INTO markov_transitions (chain_id, from_state_id, from_state_name, to_state_id, to_state_name, raw_count, probability, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction(() => {
      for (const t of transitions) {
        stmt.run(
          chainId,
          t.fromStateId,
          t.fromStateName,
          t.toStateId,
          t.toStateName,
          t.rawCount,
          t.probability,
          t.metadata ? JSON.stringify(t.metadata) : null
        );
      }
    });

    transaction();

    // Update chain stats
    const stats = this.db.prepare(`
      SELECT COUNT(DISTINCT from_state_id) as states, COUNT(*) as transitions
      FROM markov_transitions WHERE chain_id = ?
    `).get(chainId) as { states: number; transitions: number };

    this.db.prepare(`
      UPDATE markov_chains SET total_states = ?, total_transitions = ?, updated_at = ? WHERE id = ?
    `).run(stats.states, stats.transitions, Date.now(), chainId);
  }

  async getTransitionsFrom(chainId: string, stateId: string, limit = 50): Promise<Array<{
    toStateId: string;
    toStateName: string;
    probability: number;
    metadata?: Record<string, unknown>;
  }>> {
    if (!this.db) throw new Error('Database not initialized');

    const rows = this.db.prepare(`
      SELECT to_state_id, to_state_name, probability, metadata
      FROM markov_transitions
      WHERE chain_id = ? AND from_state_id = ?
      ORDER BY probability DESC
      LIMIT ?
    `).all(chainId, stateId, limit) as Array<{
      to_state_id: string;
      to_state_name: string;
      probability: number;
      metadata: string | null;
    }>;

    return rows.map(r => ({
      toStateId: r.to_state_id,
      toStateName: r.to_state_name,
      probability: r.probability,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    }));
  }

  async clearChain(chainId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db.prepare('DELETE FROM markov_transitions WHERE chain_id = ?').run(chainId);
    this.db.prepare('DELETE FROM markov_state_sums WHERE chain_id = ?').run(chainId);
    this.db.prepare('DELETE FROM markov_file_deps WHERE chain_id = ?').run(chainId);
    this.db.prepare('UPDATE markov_chains SET total_states = 0, total_transitions = 0, updated_at = ? WHERE id = ?').run(Date.now(), chainId);
  }

  async deleteChain(chainId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db.prepare('DELETE FROM markov_chains WHERE id = ?').run(chainId);
  }

  async getChainStats(chainId: string): Promise<{
    chainType: string;
    totalStates: number;
    totalTransitions: number;
    createdAt: number;
    updatedAt: number;
    avgTransitionsPerState: number;
    maxTransitionsPerState: number;
  } | null> {
    if (!this.db) throw new Error('Database not initialized');

    const chain = this.db.prepare(`
      SELECT chain_type, total_states, total_transitions, created_at, updated_at
      FROM markov_chains WHERE id = ?
    `).get(chainId) as {
      chain_type: string;
      total_states: number;
      total_transitions: number;
      created_at: number;
      updated_at: number;
    } | undefined;

    if (!chain) return null;

    const maxRow = this.db.prepare(`
      SELECT COUNT(*) as cnt FROM markov_transitions
      WHERE chain_id = ? GROUP BY from_state_id ORDER BY cnt DESC LIMIT 1
    `).get(chainId) as { cnt: number } | undefined;

    return {
      chainType: chain.chain_type,
      totalStates: chain.total_states,
      totalTransitions: chain.total_transitions,
      createdAt: chain.created_at,
      updatedAt: chain.updated_at,
      avgTransitionsPerState: chain.total_states > 0 ? chain.total_transitions / chain.total_states : 0,
      maxTransitionsPerState: maxRow?.cnt ?? 0,
    };
  }

  async getAllChainStats(): Promise<Array<{
    chainId: string;
    chainType: string;
    totalStates: number;
    totalTransitions: number;
    createdAt: number;
    updatedAt: number;
  }>> {
    if (!this.db) throw new Error('Database not initialized');

    const rows = this.db.prepare(`
      SELECT id, chain_type, total_states, total_transitions, created_at, updated_at
      FROM markov_chains ORDER BY chain_type
    `).all() as Array<{
      id: string;
      chain_type: string;
      total_states: number;
      total_transitions: number;
      created_at: number;
      updated_at: number;
    }>;

    return rows.map(r => ({
      chainId: r.id,
      chainType: r.chain_type,
      totalStates: r.total_states,
      totalTransitions: r.total_transitions,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async getAllCallGraphEdges(): Promise<CallGraphEdge[]> {
    if (!this.db) throw new Error('Database not initialized');

    const rows = this.db.prepare('SELECT * FROM call_graph').all() as Array<{
      id: string;
      caller_symbol_id: string;
      caller_name: string;
      callee_name: string;
      callee_symbol_id: string | null;
      call_count: number;
      is_async: number;
      is_conditional: number;
    }>;

    return rows.map(r => ({
      id: r.id,
      callerSymbolId: r.caller_symbol_id,
      callerName: r.caller_name,
      calleeName: r.callee_name,
      calleeSymbolId: r.callee_symbol_id ?? undefined,
      callCount: r.call_count,
      isAsync: r.is_async === 1,
      isConditional: r.is_conditional === 1,
    }));
  }

  async getAllTypeRelationships(): Promise<TypeRelationship[]> {
    if (!this.db) throw new Error('Database not initialized');

    const rows = this.db.prepare('SELECT * FROM type_relationships').all() as Array<{
      id: string;
      source_symbol_id: string;
      source_name: string;
      target_name: string;
      target_symbol_id: string | null;
      relationship_kind: string;
    }>;

    return rows.map(r => ({
      id: r.id,
      sourceSymbolId: r.source_symbol_id,
      sourceName: r.source_name,
      targetName: r.target_name,
      targetSymbolId: r.target_symbol_id ?? undefined,
      relationshipKind: r.relationship_kind as 'extends' | 'implements' | 'mixin',
    }));
  }

  async getSymbolById(symbolId: string): Promise<{
    id: string;
    name: string;
    filePath: string;
    kind: string;
  } | null> {
    if (!this.db) throw new Error('Database not initialized');

    const row = this.db.prepare(`
      SELECT id, name, file_path, kind FROM symbols WHERE id = ?
    `).get(symbolId) as { id: string; name: string; file_path: string; kind: string } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      filePath: row.file_path,
      kind: row.kind,
    };
  }

  async getSymbolByName(name: string): Promise<{
    id: string;
    name: string;
    filePath: string;
    kind: string;
  } | null> {
    if (!this.db) throw new Error('Database not initialized');

    const row = this.db.prepare(`
      SELECT id, name, file_path, kind FROM symbols WHERE name = ? LIMIT 1
    `).get(name) as { id: string; name: string; file_path: string; kind: string } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      filePath: row.file_path,
      kind: row.kind,
    };
  }

  async hasChainSupport(chainId: string, stateId: string): Promise<boolean> {
    if (!this.db) throw new Error('Database not initialized');

    const row = this.db.prepare(`
      SELECT 1 FROM markov_transitions WHERE chain_id = ? AND from_state_id = ? LIMIT 1
    `).get(chainId, stateId);

    return !!row;
  }

  // ============ Configuration Entry Methods ============

  async saveConfigEntries(filePath: string, entries: Array<{
    id: string;
    name: string;
    path: string;
    valueType: string;
    value: string;
    rawValue: unknown;
    depth: number;
    parentPath: string | null;
    format: string;
    configType: string;
    description?: string;
    lineNumber?: number;
  }>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const transaction = this.db.transaction(() => {
      // Delete existing entries for this file
      this.db!.prepare('DELETE FROM config_entries WHERE file_path = ?').run(filePath);

      const stmt = this.db!.prepare(`
        INSERT INTO config_entries (id, file_path, name, path, value_type, value, raw_value, depth, parent_path, format, config_type, description, line_number)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const entry of entries) {
        stmt.run(
          entry.id,
          filePath,
          entry.name,
          entry.path,
          entry.valueType,
          entry.value,
          JSON.stringify(entry.rawValue),
          entry.depth,
          entry.parentPath,
          entry.format,
          entry.configType,
          entry.description ?? null,
          entry.lineNumber ?? 1
        );
      }
    });

    transaction();
  }

  async getConfigValue(path: string, filePath?: string): Promise<Array<{
    path: string;
    value: string;
    rawValue: unknown;
    valueType: string;
    filePath: string;
    format: string;
    configType: string;
    description: string | null;
    lineNumber: number;
  }>> {
    if (!this.db) throw new Error('Database not initialized');

    // Try exact match first
    let query = `
      SELECT path, value, raw_value, value_type, file_path, format, config_type, description, line_number
      FROM config_entries
      WHERE path = ?
    `;
    const params: (string)[] = [path];

    if (filePath) {
      query += ' AND file_path = ?';
      params.push(filePath);
    }

    let rows = this.db.prepare(query).all(...params) as Array<{
      path: string;
      value: string;
      raw_value: string;
      value_type: string;
      file_path: string;
      format: string;
      config_type: string;
      description: string | null;
      line_number: number;
    }>;

    // If no exact match, try prefix match for nested children
    // This handles cases like "scripts" returning "scripts.build", "scripts.test", etc.
    if (rows.length === 0) {
      let prefixQuery = `
        SELECT path, value, raw_value, value_type, file_path, format, config_type, description, line_number
        FROM config_entries
        WHERE path LIKE ? || '.%' OR path = ?
      `;
      const prefixParams: string[] = [path, path];

      if (filePath) {
        prefixQuery += ' AND file_path = ?';
        prefixParams.push(filePath);
      }

      prefixQuery += ' ORDER BY path';

      rows = this.db.prepare(prefixQuery).all(...prefixParams) as Array<{
        path: string;
        value: string;
        raw_value: string;
        value_type: string;
        file_path: string;
        format: string;
        config_type: string;
        description: string | null;
        line_number: number;
      }>;
    }

    return rows.map(r => ({
      path: r.path,
      value: r.value,
      rawValue: JSON.parse(r.raw_value),
      valueType: r.value_type,
      filePath: r.file_path,
      format: r.format,
      configType: r.config_type,
      description: r.description,
      lineNumber: r.line_number,
    }));
  }

  async getConfigChildren(path: string, filePath?: string): Promise<Array<{
    path: string;
    value: string;
    rawValue: unknown;
    valueType: string;
    filePath: string;
    format: string;
    configType: string;
    description: string | null;
    lineNumber: number;
  }>> {
    if (!this.db) throw new Error('Database not initialized');

    let query = `
      SELECT path, value, raw_value, value_type, file_path, format, config_type, description, line_number
      FROM config_entries
      WHERE parent_path = ?
    `;
    const params: (string)[] = [path];

    if (filePath) {
      query += ' AND file_path = ?';
      params.push(filePath);
    }

    query += ' ORDER BY path';

    const rows = this.db.prepare(query).all(...params) as Array<{
      path: string;
      value: string;
      raw_value: string;
      value_type: string;
      file_path: string;
      format: string;
      config_type: string;
      description: string | null;
      line_number: number;
    }>;

    return rows.map(r => ({
      path: r.path,
      value: r.value,
      rawValue: JSON.parse(r.raw_value),
      valueType: r.value_type,
      filePath: r.file_path,
      format: r.format,
      configType: r.config_type,
      description: r.description,
      lineNumber: r.line_number,
    }));
  }

  async searchConfig(query: string, options?: {
    configType?: string;
    searchIn?: 'keys' | 'values' | 'both';
    limit?: number;
  }): Promise<Array<{
    path: string;
    name: string;
    value: string;
    rawValue: unknown;
    valueType: string;
    filePath: string;
    format: string;
    configType: string;
    description: string | null;
    lineNumber: number;
    matchScore: number;
  }>> {
    if (!this.db) throw new Error('Database not initialized');

    const limit = options?.limit ?? 50;
    const searchIn = options?.searchIn ?? 'both';

    // Use FTS5 for search
    let ftsQuery = '';
    if (searchIn === 'keys') {
      ftsQuery = `path:${query}* OR name:${query}*`;
    } else if (searchIn === 'values') {
      ftsQuery = `value:${query}*`;
    } else {
      ftsQuery = `${query}*`;
    }

    let sql = `
      SELECT
        ce.path, ce.name, ce.value, ce.raw_value, ce.value_type,
        ce.file_path, ce.format, ce.config_type, ce.description, ce.line_number,
        bm25(config_fts) as score
      FROM config_fts
      JOIN config_entries ce ON config_fts.rowid = ce.rowid
      WHERE config_fts MATCH ?
    `;
    const params: (string | number)[] = [ftsQuery];

    if (options?.configType) {
      sql += ' AND ce.config_type = ?';
      params.push(options.configType);
    }

    sql += ` ORDER BY score LIMIT ?`;
    params.push(limit);

    try {
      const rows = this.db.prepare(sql).all(...params) as Array<{
        path: string;
        name: string;
        value: string;
        raw_value: string;
        value_type: string;
        file_path: string;
        format: string;
        config_type: string;
        description: string | null;
        line_number: number;
        score: number;
      }>;

      return rows.map(r => ({
        path: r.path,
        name: r.name,
        value: r.value,
        rawValue: JSON.parse(r.raw_value),
        valueType: r.value_type,
        filePath: r.file_path,
        format: r.format,
        configType: r.config_type,
        description: r.description,
        lineNumber: r.line_number,
        matchScore: Math.abs(r.score),
      }));
    } catch {
      // Fallback to LIKE search if FTS query fails
      let fallbackSql = `
        SELECT path, name, value, raw_value, value_type, file_path, format, config_type, description, line_number
        FROM config_entries
        WHERE (path LIKE ? OR name LIKE ? OR value LIKE ?)
      `;
      const fallbackParams: (string | number)[] = [`%${query}%`, `%${query}%`, `%${query}%`];

      if (options?.configType) {
        fallbackSql += ' AND config_type = ?';
        fallbackParams.push(options.configType);
      }

      fallbackSql += ' ORDER BY path LIMIT ?';
      fallbackParams.push(limit);

      const rows = this.db.prepare(fallbackSql).all(...fallbackParams) as Array<{
        path: string;
        name: string;
        value: string;
        raw_value: string;
        value_type: string;
        file_path: string;
        format: string;
        config_type: string;
        description: string | null;
        line_number: number;
      }>;

      return rows.map(r => ({
        path: r.path,
        name: r.name,
        value: r.value,
        rawValue: JSON.parse(r.raw_value),
        valueType: r.value_type,
        filePath: r.file_path,
        format: r.format,
        configType: r.config_type,
        description: r.description,
        lineNumber: r.line_number,
        matchScore: 1,
      }));
    }
  }

  async listConfigFiles(options?: {
    configType?: string;
    directory?: string;
  }): Promise<Array<{
    filePath: string;
    relativePath: string;
    format: string;
    configType: string;
    entryCount: number;
  }>> {
    if (!this.db) throw new Error('Database not initialized');

    let sql = `
      SELECT
        ce.file_path, f.relative_path, ce.format, ce.config_type,
        COUNT(DISTINCT ce.id) as entry_count
      FROM config_entries ce
      JOIN files f ON ce.file_path = f.file_path
      WHERE 1=1
    `;
    const params: (string)[] = [];

    if (options?.configType) {
      sql += ' AND ce.config_type = ?';
      params.push(options.configType);
    }

    if (options?.directory) {
      sql += ' AND f.relative_path LIKE ?';
      params.push(`${options.directory}%`);
    }

    sql += ' GROUP BY ce.file_path, f.relative_path, ce.format, ce.config_type ORDER BY ce.file_path';

    const rows = this.db.prepare(sql).all(...params) as Array<{
      file_path: string;
      relative_path: string;
      format: string;
      config_type: string;
      entry_count: number;
    }>;

    return rows.map(r => ({
      filePath: r.file_path,
      relativePath: r.relative_path,
      format: r.format,
      configType: r.config_type,
      entryCount: r.entry_count,
    }));
  }

  // ============ Import/Export Tracking Methods ============

  async saveFileImports(filePath: string, imports: Array<{
    source: string;
    resolvedPath: string | null;
    isExternal: boolean;
    isTypeOnly: boolean;
    isReExport: boolean;
    specifiers: Array<{ name: string; alias?: string; isDefault: boolean; isNamespace: boolean }>;
  }>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const transaction = this.db.transaction(() => {
      this.db!.prepare('DELETE FROM file_imports WHERE file_path = ?').run(filePath);

      const stmt = this.db!.prepare(`
        INSERT INTO file_imports (file_path, import_source, resolved_path, is_external, is_type_only, is_re_export, specifiers_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const imp of imports) {
        stmt.run(
          filePath,
          imp.source,
          imp.resolvedPath,
          imp.isExternal ? 1 : 0,
          imp.isTypeOnly ? 1 : 0,
          imp.isReExport ? 1 : 0,
          JSON.stringify(imp.specifiers)
        );
      }
    });

    transaction();
  }

  async getFileImports(filePath: string): Promise<Array<{
    source: string;
    resolvedPath: string | null;
    isExternal: boolean;
    isTypeOnly: boolean;
    isReExport: boolean;
    specifiers: Array<{ name: string; alias?: string; isDefault: boolean; isNamespace: boolean }>;
  }>> {
    if (!this.db) throw new Error('Database not initialized');

    const rows = this.db.prepare(`
      SELECT import_source, resolved_path, is_external, is_type_only, is_re_export, specifiers_json
      FROM file_imports
      WHERE file_path = ?
    `).all(filePath) as Array<{
      import_source: string;
      resolved_path: string | null;
      is_external: number;
      is_type_only: number;
      is_re_export: number;
      specifiers_json: string;
    }>;

    return rows.map(r => ({
      source: r.import_source,
      resolvedPath: r.resolved_path,
      isExternal: r.is_external === 1,
      isTypeOnly: r.is_type_only === 1,
      isReExport: r.is_re_export === 1,
      specifiers: JSON.parse(r.specifiers_json),
    }));
  }

  async getReverseDependencies(filePath: string): Promise<Array<{
    filePath: string;
    relativePath: string;
    source: string;
    isTypeOnly: boolean;
    specifiers: Array<{ name: string; alias?: string; isDefault: boolean; isNamespace: boolean }>;
  }>> {
    if (!this.db) throw new Error('Database not initialized');

    const rows = this.db.prepare(`
      SELECT fi.file_path, f.relative_path, fi.import_source, fi.is_type_only, fi.specifiers_json
      FROM file_imports fi
      JOIN files f ON fi.file_path = f.file_path
      WHERE fi.resolved_path = ?
    `).all(filePath) as Array<{
      file_path: string;
      relative_path: string;
      import_source: string;
      is_type_only: number;
      specifiers_json: string;
    }>;

    return rows.map(r => ({
      filePath: r.file_path,
      relativePath: r.relative_path,
      source: r.import_source,
      isTypeOnly: r.is_type_only === 1,
      specifiers: JSON.parse(r.specifiers_json),
    }));
  }

  async getTransitiveDependencies(filePath: string, maxDepth: number = 3): Promise<Map<string, {
    depth: number;
    imports: Array<{ source: string; isExternal: boolean; isTypeOnly: boolean }>;
  }>> {
    if (!this.db) throw new Error('Database not initialized');

    const result = new Map<string, { depth: number; imports: Array<{ source: string; isExternal: boolean; isTypeOnly: boolean }> }>();
    const visited = new Set<string>();
    const queue: Array<{ path: string; depth: number }> = [{ path: filePath, depth: 0 }];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current.path) || current.depth > maxDepth) continue;
      visited.add(current.path);

      const imports = await this.getFileImports(current.path);
      const internalImports = imports.filter(i => !i.isExternal && i.resolvedPath);

      result.set(current.path, {
        depth: current.depth,
        imports: imports.map(i => ({ source: i.source, isExternal: i.isExternal, isTypeOnly: i.isTypeOnly })),
      });

      for (const imp of internalImports) {
        if (imp.resolvedPath && !visited.has(imp.resolvedPath)) {
          queue.push({ path: imp.resolvedPath, depth: current.depth + 1 });
        }
      }
    }

    return result;
  }

  async detectCircularDependencies(filePath: string): Promise<string[][] | null> {
    if (!this.db) throw new Error('Database not initialized');

    const cycles: string[][] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const path: string[] = [];

    const dfs = async (current: string): Promise<void> => {
      if (visited.has(current)) return;

      if (visiting.has(current)) {
        // Found a cycle
        const cycleStart = path.indexOf(current);
        if (cycleStart !== -1) {
          cycles.push([...path.slice(cycleStart), current]);
        }
        return;
      }

      visiting.add(current);
      path.push(current);

      const imports = await this.getFileImports(current);
      for (const imp of imports) {
        if (imp.resolvedPath && !imp.isExternal) {
          await dfs(imp.resolvedPath);
        }
      }

      path.pop();
      visiting.delete(current);
      visited.add(current);
    };

    await dfs(filePath);

    return cycles.length > 0 ? cycles : null;
  }

  async saveFileExports(filePath: string, exports: Array<{
    name: string;
    isDefault: boolean;
    isReExport: boolean;
    reExportSource?: string;
    resolvedReExportPath?: string;
  }>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const transaction = this.db.transaction(() => {
      this.db!.prepare('DELETE FROM file_exports WHERE file_path = ?').run(filePath);

      const stmt = this.db!.prepare(`
        INSERT INTO file_exports (file_path, export_name, is_default, is_re_export, re_export_source, resolved_re_export_path)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const exp of exports) {
        stmt.run(
          filePath,
          exp.name,
          exp.isDefault ? 1 : 0,
          exp.isReExport ? 1 : 0,
          exp.reExportSource ?? null,
          exp.resolvedReExportPath ?? null
        );
      }
    });

    transaction();
  }

  async getFileExports(filePath: string): Promise<Array<{
    name: string;
    isDefault: boolean;
    isReExport: boolean;
    reExportSource: string | null;
    resolvedReExportPath: string | null;
  }>> {
    if (!this.db) throw new Error('Database not initialized');

    const rows = this.db.prepare(`
      SELECT export_name, is_default, is_re_export, re_export_source, resolved_re_export_path
      FROM file_exports
      WHERE file_path = ?
    `).all(filePath) as Array<{
      export_name: string;
      is_default: number;
      is_re_export: number;
      re_export_source: string | null;
      resolved_re_export_path: string | null;
    }>;

    return rows.map(r => ({
      name: r.export_name,
      isDefault: r.is_default === 1,
      isReExport: r.is_re_export === 1,
      reExportSource: r.re_export_source,
      resolvedReExportPath: r.resolved_re_export_path,
    }));
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  async clear(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db.exec('DELETE FROM files');
    this.db.exec('DELETE FROM symbol_references');
    this.db.exec('DELETE FROM call_graph');
    this.db.exec('DELETE FROM type_relationships');
    this.db.exec('DELETE FROM symbol_type_params');
    this.db.exec('DELETE FROM symbol_types');
    this.db.exec('DELETE FROM markov_transitions');
    this.db.exec('DELETE FROM markov_state_sums');
    this.db.exec('DELETE FROM markov_file_deps');
    this.db.exec('DELETE FROM markov_chains');
    this.db.exec('DELETE FROM config_entries');
    this.db.exec('DELETE FROM file_imports');
    this.db.exec('DELETE FROM file_exports');
    this.cacheValid = false;
  }
}
