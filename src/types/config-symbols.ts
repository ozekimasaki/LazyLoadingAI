/**
 * Type definitions for configuration file indexing
 */

import type { Location } from './symbols.js';

export type ConfigFormat = 'json' | 'yaml' | 'toml';
export type ConfigValueType = 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object';

export type KnownConfigType =
  | 'package.json'
  | 'tsconfig'
  | 'pyproject'
  | 'eslint'
  | 'prettier'
  | 'vite'
  | 'vitest'
  | 'jest'
  | 'babel'
  | 'webpack'
  | 'docker-compose'
  | 'github-actions'
  | 'unknown';

export interface ConfigEntrySignature {
  id: string;
  name: string;                    // Key name (e.g., "strict")
  path: string;                    // Full path (e.g., "compilerOptions.strict")
  fullyQualifiedName: string;
  valueType: ConfigValueType;
  value: string;                   // String representation
  rawValue: unknown;               // Actual value
  depth: number;                   // Nesting level
  parentPath: string | null;
  location: Location;
  format: ConfigFormat;
  configType: KnownConfigType;
  description?: string;            // Semantic description for known configs
}

export interface ConfigFileIndex {
  filePath: string;
  relativePath: string;
  format: ConfigFormat;
  configType: KnownConfigType;
  checksum: string;
  lastModified: number;
  entries: ConfigEntrySignature[];
  summary: string;
  lineCount: number;
}

/**
 * Known configuration schema descriptions for common config files
 */
export interface KnownConfigSchema {
  type: KnownConfigType;
  paths: Record<string, string>;  // path -> description mapping
}

/**
 * Configuration search result
 */
export interface ConfigSearchResult {
  entry: ConfigEntrySignature;
  filePath: string;
  matchScore: number;
}

/**
 * Configuration value with context
 */
export interface ConfigValueResult {
  path: string;
  value: unknown;
  valueType: ConfigValueType;
  filePath: string;
  format: ConfigFormat;
  configType: KnownConfigType;
  description?: string;
  children?: ConfigValueResult[];
}
