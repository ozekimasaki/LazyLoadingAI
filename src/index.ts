/**
 * LazyLoadingAI - MCP server for lazy-loading code context
 *
 * This library provides tools for indexing source code and exposing
 * function/class signatures through the Model Context Protocol (MCP).
 */

// Types
export * from './types/index.js';

// Indexer
export { Indexer, Watcher, type IndexerConfig, type IndexResult } from './indexer/index.js';

// Parsers
export {
  LanguageParser,
  ParserRegistry,
  TypeScriptParser,
  PythonParser,
  createDefaultRegistry,
  getDefaultRegistry,
  type ParseResult,
  type ParseError,
  type ParserOptions,
} from './indexer/parsers/index.js';

// Storage
export { SqliteStorage, type StorageInterface } from './indexer/storage/index.js';

// Server
export { createServer, startStdioServer, registerTools, type ServerOptions } from './server/index.js';

// Config
export {
  configSchema,
  loadConfig,
  getDefaultConfig,
  findConfig,
  loadConfigOrDefault,
  type Config,
} from './config/index.js';
