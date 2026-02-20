/**
 * Index manifest types for the LazyLoadingAI indexer
 */

import type { Language } from './symbols.js';

export interface IndexManifest {
  version: string;
  createdAt: number;
  updatedAt: number;
  rootDirectory: string;
  config: IndexConfig;
  stats: IndexStats;
}

export interface IndexConfig {
  directories: string[];
  include: string[];
  exclude: string[];
  languages: LanguageConfig;
}

export interface LanguageConfig {
  typescript?: TypeScriptConfig;
  javascript?: JavaScriptConfig;
  python?: PythonConfig;
}

export interface TypeScriptConfig {
  extractDocumentation: boolean;
  includePrivate: boolean;
  tsConfigPath?: string;
}

export interface JavaScriptConfig {
  extractDocumentation: boolean;
  includePrivate: boolean;
}

export interface PythonConfig {
  extractDocumentation: boolean;
  includePrivate: boolean;
  docstringFormat: 'google' | 'numpy' | 'sphinx' | 'auto';
}

export interface IndexStats {
  totalFiles: number;
  totalSymbols: number;
  byLanguage: Record<Language, LanguageStats>;
  indexingDurationMs: number;
}

export interface LanguageStats {
  files: number;
  functions: number;
  classes: number;
  interfaces: number;
  typeAliases: number;
  variables: number;
}

export interface SearchResult {
  symbol: {
    id: string;
    name: string;
    kind: string;
    signature: string;
    filePath: string;
    line: number;
  };
  score: number;
  matches: Array<{
    field: string;
    indices: Array<[number, number]>;
  }>;
}

export interface QueryOptions {
  type?: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'all';
  language?: Language;
  includePrivate?: boolean;
  limit?: number;
  offset?: number;
}

export interface FileListOptions {
  directory?: string;
  recursive?: boolean;
  language?: Language;
  pattern?: string;
}

export interface FunctionListOptions {
  filePath: string;
  includePrivate?: boolean;
  includeSource?: boolean;
  includeInherited?: boolean;
}

export interface GetSymbolOptions {
  filePath: string;
  name: string;
  includeContext?: boolean;
  contextLines?: number;
}
