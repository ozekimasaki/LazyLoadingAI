/**
 * Import path resolution for TypeScript/JavaScript files
 */

import path from 'node:path';
import fs from 'node:fs';
import type { ImportInfo } from '../types/symbols.js';

export interface ResolvedImport {
  source: string;
  resolvedPath: string | null;
  isExternal: boolean;
  isBuiltIn: boolean;
  isTypeOnly: boolean;
  isReExport: boolean;
  specifiers: Array<{
    name: string;
    alias?: string;
    isDefault: boolean;
    isNamespace: boolean;
  }>;
}

export interface ImportResolverOptions {
  rootDir: string;
  tsConfigPath?: string;
  nodeModulesPath?: string;
}

/**
 * Node.js built-in modules
 */
const NODE_BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
  'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain',
  'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net',
  'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring', 'readline',
  'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls', 'trace_events',
  'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
]);

/**
 * TypeScript path aliases from tsconfig
 */
interface PathAliases {
  [pattern: string]: string[];
}

export class ImportResolver {
  private rootDir: string;
  private pathAliases: PathAliases = {};
  private baseUrl: string | null = null;

  constructor(options: ImportResolverOptions) {
    this.rootDir = options.rootDir;

    // Try to load tsconfig for path aliases
    const tsConfigPath = options.tsConfigPath ?? path.join(options.rootDir, 'tsconfig.json');
    this.loadTsConfig(tsConfigPath);
  }

  private loadTsConfig(tsConfigPath: string): void {
    try {
      if (!fs.existsSync(tsConfigPath)) return;

      const content = fs.readFileSync(tsConfigPath, 'utf-8');
      const config = JSON.parse(content);

      if (config.compilerOptions?.baseUrl) {
        this.baseUrl = path.resolve(path.dirname(tsConfigPath), config.compilerOptions.baseUrl);
      }

      if (config.compilerOptions?.paths) {
        this.pathAliases = config.compilerOptions.paths;
      }
    } catch {
      // Ignore tsconfig parse errors
    }
  }

  /**
   * Resolve an import from a file
   */
  resolveImport(importInfo: ImportInfo, fromFile: string): ResolvedImport {
    const source = importInfo.source;

    // Check for built-in modules
    if (this.isBuiltIn(source)) {
      return {
        source,
        resolvedPath: null,
        isExternal: false,
        isBuiltIn: true,
        isTypeOnly: importInfo.isTypeOnly,
        isReExport: false,
        specifiers: importInfo.specifiers.map(s => ({
          name: s.name,
          alias: s.alias,
          isDefault: s.isDefault,
          isNamespace: s.isNamespace,
        })),
      };
    }

    // Try to resolve the path
    const resolved = this.resolvePath(source, fromFile);

    return {
      source,
      resolvedPath: resolved.path,
      isExternal: resolved.isExternal,
      isBuiltIn: false,
      isTypeOnly: importInfo.isTypeOnly,
      isReExport: false,
      specifiers: importInfo.specifiers.map(s => ({
        name: s.name,
        alias: s.alias,
        isDefault: s.isDefault,
        isNamespace: s.isNamespace,
      })),
    };
  }

  /**
   * Resolve all imports from a file
   */
  resolveImports(imports: ImportInfo[], fromFile: string): ResolvedImport[] {
    return imports.map(imp => this.resolveImport(imp, fromFile));
  }

  /**
   * Check if a module is a Node.js built-in
   */
  private isBuiltIn(source: string): boolean {
    // Handle node: prefix
    if (source.startsWith('node:')) {
      return true;
    }
    return NODE_BUILTINS.has(source);
  }

  /**
   * Resolve an import path
   */
  private resolvePath(source: string, fromFile: string): { path: string | null; isExternal: boolean } {
    // Relative imports
    if (source.startsWith('.') || source.startsWith('/')) {
      const resolved = this.resolveRelative(source, fromFile);
      return { path: resolved, isExternal: false };
    }

    // Path aliases from tsconfig
    const aliasResolved = this.resolveAlias(source, fromFile);
    if (aliasResolved) {
      return { path: aliasResolved, isExternal: false };
    }

    // Absolute imports with baseUrl
    if (this.baseUrl) {
      const baseResolved = this.resolveFromBaseUrl(source);
      if (baseResolved) {
        return { path: baseResolved, isExternal: false };
      }
    }

    // External package
    return { path: null, isExternal: true };
  }

  /**
   * Resolve a relative import
   */
  private resolveRelative(source: string, fromFile: string): string | null {
    const dir = path.dirname(fromFile);
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', ''];

    for (const ext of extensions) {
      // Try direct file
      const direct = path.resolve(dir, source + ext);
      if (this.fileExists(direct)) {
        return direct;
      }

      // Try index file in directory
      const indexPath = path.resolve(dir, source, 'index' + ext);
      if (this.fileExists(indexPath)) {
        return indexPath;
      }
    }

    // If no extension and source already has one, try as-is
    const direct = path.resolve(dir, source);
    if (this.fileExists(direct)) {
      return direct;
    }

    return null;
  }

  /**
   * Resolve using tsconfig path aliases
   */
  private resolveAlias(source: string, fromFile: string): string | null {
    for (const [pattern, paths] of Object.entries(this.pathAliases)) {
      const regex = this.patternToRegex(pattern);
      const match = source.match(regex);

      if (match) {
        const captured = match[1] ?? '';

        for (const targetPath of paths) {
          const resolved = targetPath.replace('*', captured);
          const baseDir = this.baseUrl ?? this.rootDir;
          const fullPath = path.resolve(baseDir, resolved);

          // Try with extensions
          const extensions = ['.ts', '.tsx', '.js', '.jsx', ''];
          for (const ext of extensions) {
            const withExt = fullPath + ext;
            if (this.fileExists(withExt)) {
              return withExt;
            }

            // Try index
            const indexPath = path.join(fullPath, 'index' + ext);
            if (this.fileExists(indexPath)) {
              return indexPath;
            }
          }
        }
      }
    }

    return null;
  }

  /**
   * Resolve from baseUrl
   */
  private resolveFromBaseUrl(source: string): string | null {
    if (!this.baseUrl) return null;

    const extensions = ['.ts', '.tsx', '.js', '.jsx', ''];
    for (const ext of extensions) {
      const fullPath = path.resolve(this.baseUrl, source + ext);
      if (this.fileExists(fullPath)) {
        return fullPath;
      }

      // Try index
      const indexPath = path.resolve(this.baseUrl, source, 'index' + ext);
      if (this.fileExists(indexPath)) {
        return indexPath;
      }
    }

    return null;
  }

  /**
   * Convert a tsconfig path pattern to regex
   */
  private patternToRegex(pattern: string): RegExp {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const withWildcard = escaped.replace('\\*', '(.*)');
    return new RegExp(`^${withWildcard}$`);
  }

  /**
   * Check if a file exists (with caching)
   */
  private existsCache = new Map<string, boolean>();
  private fileExists(filePath: string): boolean {
    if (!this.existsCache.has(filePath)) {
      try {
        const stat = fs.statSync(filePath);
        this.existsCache.set(filePath, stat.isFile());
      } catch {
        this.existsCache.set(filePath, false);
      }
    }
    return this.existsCache.get(filePath) ?? false;
  }

  /**
   * Clear the file exists cache
   */
  clearCache(): void {
    this.existsCache.clear();
  }
}

/**
 * Extract package name from an import source
 */
export function extractPackageName(source: string): string {
  // Handle scoped packages (@org/package)
  if (source.startsWith('@')) {
    const parts = source.split('/');
    return parts.slice(0, 2).join('/');
  }
  // Handle regular packages
  return source.split('/')[0]!;
}

/**
 * Check if an import is to a type definition file
 */
export function isTypeDefinitionImport(source: string): boolean {
  return source.startsWith('@types/');
}
