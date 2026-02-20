/**
 * Configuration file parser for JSON, YAML, and TOML files
 */

import * as YAML from 'yaml';
import * as TOML from '@iarna/toml';
import path from 'node:path';
import type { Language } from '../../types/index.js';
import type {
  ConfigFormat,
  ConfigValueType,
  ConfigEntrySignature,
  KnownConfigType,
} from '../../types/config-symbols.js';
import { LanguageParser, type ParseResult, type ParseError } from './base.js';

/**
 * Known configuration file patterns and their descriptions
 */
const KNOWN_CONFIG_PATTERNS: Record<string, KnownConfigType> = {
  'package.json': 'package.json',
  'tsconfig.json': 'tsconfig',
  'tsconfig.*.json': 'tsconfig',
  'jsconfig.json': 'tsconfig',
  'pyproject.toml': 'pyproject',
  '.eslintrc': 'eslint',
  '.eslintrc.json': 'eslint',
  '.eslintrc.yaml': 'eslint',
  '.eslintrc.yml': 'eslint',
  'eslint.config.js': 'eslint',
  'eslint.config.mjs': 'eslint',
  '.prettierrc': 'prettier',
  '.prettierrc.json': 'prettier',
  '.prettierrc.yaml': 'prettier',
  '.prettierrc.yml': 'prettier',
  'prettier.config.js': 'prettier',
  'vite.config.ts': 'vite',
  'vite.config.js': 'vite',
  'vitest.config.ts': 'vitest',
  'vitest.config.js': 'vitest',
  'jest.config.js': 'jest',
  'jest.config.ts': 'jest',
  'jest.config.json': 'jest',
  '.babelrc': 'babel',
  '.babelrc.json': 'babel',
  'babel.config.js': 'babel',
  'babel.config.json': 'babel',
  'webpack.config.js': 'webpack',
  'webpack.config.ts': 'webpack',
  'docker-compose.yml': 'docker-compose',
  'docker-compose.yaml': 'docker-compose',
  'compose.yml': 'docker-compose',
  'compose.yaml': 'docker-compose',
};

/**
 * Descriptions for common config paths
 */
const CONFIG_DESCRIPTIONS: Partial<Record<KnownConfigType, Record<string, string>>> = {
  'package.json': {
    'name': 'Package name',
    'version': 'Package version',
    'description': 'Package description',
    'main': 'Main entry point',
    'type': 'Module type (commonjs or module)',
    'scripts': 'NPM scripts',
    'dependencies': 'Production dependencies',
    'devDependencies': 'Development dependencies',
    'peerDependencies': 'Peer dependencies',
    'engines': 'Node.js version requirements',
    'repository': 'Repository information',
    'keywords': 'Package keywords for npm search',
    'license': 'Package license',
    'bin': 'Executable commands',
    'files': 'Files to include in package',
    'exports': 'Package exports map',
  },
  'tsconfig': {
    'compilerOptions': 'TypeScript compiler options',
    'compilerOptions.target': 'ECMAScript target version',
    'compilerOptions.module': 'Module system',
    'compilerOptions.moduleResolution': 'Module resolution strategy',
    'compilerOptions.strict': 'Enable all strict type checking',
    'compilerOptions.esModuleInterop': 'ES module interoperability',
    'compilerOptions.skipLibCheck': 'Skip type checking of declaration files',
    'compilerOptions.forceConsistentCasingInFileNames': 'Ensure consistent casing in imports',
    'compilerOptions.outDir': 'Output directory for compiled files',
    'compilerOptions.rootDir': 'Root directory of source files',
    'compilerOptions.baseUrl': 'Base URL for module resolution',
    'compilerOptions.paths': 'Path aliases for module imports',
    'compilerOptions.lib': 'Library files to include',
    'compilerOptions.jsx': 'JSX transformation mode',
    'include': 'Files to include in compilation',
    'exclude': 'Files to exclude from compilation',
    'extends': 'Parent configuration to extend',
    'references': 'Project references',
  },
  'pyproject': {
    'project': 'Project metadata',
    'project.name': 'Package name',
    'project.version': 'Package version',
    'project.description': 'Package description',
    'project.dependencies': 'Runtime dependencies',
    'project.optional-dependencies': 'Optional dependencies',
    'build-system': 'Build system configuration',
    'tool': 'Tool-specific configurations',
    'tool.poetry': 'Poetry configuration',
    'tool.pytest': 'Pytest configuration',
    'tool.black': 'Black formatter configuration',
    'tool.ruff': 'Ruff linter configuration',
    'tool.mypy': 'Mypy type checker configuration',
  },
  'eslint': {
    'env': 'Environment settings',
    'extends': 'Configurations to extend',
    'parser': 'Parser to use',
    'parserOptions': 'Parser options',
    'plugins': 'ESLint plugins',
    'rules': 'Linting rules',
    'overrides': 'Rule overrides for specific files',
    'ignorePatterns': 'Patterns to ignore',
  },
  'prettier': {
    'printWidth': 'Maximum line width',
    'tabWidth': 'Spaces per indentation level',
    'useTabs': 'Use tabs instead of spaces',
    'semi': 'Add semicolons',
    'singleQuote': 'Use single quotes',
    'trailingComma': 'Trailing comma style',
    'bracketSpacing': 'Spaces in object literals',
    'arrowParens': 'Arrow function parentheses',
  },
};

export class ConfigurationParser extends LanguageParser {
  get language(): Language {
    return 'config';
  }

  get extensions(): string[] {
    return ['json', 'yaml', 'yml', 'toml'];
  }

  canParse(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase().slice(1);
    if (!this.extensions.includes(ext)) {
      return false;
    }
    // Skip non-config JSON files that are likely data
    const basename = path.basename(filePath).toLowerCase();
    if (ext === 'json') {
      // Allow known config files and common config patterns
      return this.isLikelyConfigFile(filePath);
    }
    return true;
  }

  /**
   * Check if a file is likely a configuration file
   */
  private isLikelyConfigFile(filePath: string): boolean {
    const basename = path.basename(filePath).toLowerCase();
    const dir = path.dirname(filePath);
    const dirBasename = path.basename(dir).toLowerCase();

    // Known config file names
    const knownConfigNames = [
      'package.json', 'package-lock.json', 'tsconfig.json', 'jsconfig.json',
      '.eslintrc.json', '.prettierrc.json', 'jest.config.json', '.babelrc.json',
      'babel.config.json', 'turbo.json', 'lerna.json', 'rush.json',
      'renovate.json', '.releaserc.json', 'vercel.json', 'netlify.json',
      'firebase.json', '.swcrc', 'deno.json', 'deno.jsonc',
    ];

    if (knownConfigNames.includes(basename)) {
      return true;
    }

    // Patterns like tsconfig.*.json
    if (basename.startsWith('tsconfig.') && basename.endsWith('.json')) {
      return true;
    }

    // .github/workflows YAML files
    if (dirBasename === 'workflows' && dir.includes('.github')) {
      return true;
    }

    // Common YAML config file patterns
    const yamlConfigPatterns = [
      /^docker-compose.*\.ya?ml$/,
      /^compose.*\.ya?ml$/,
      /^\.?github.*\.ya?ml$/,
      /^\.?gitlab-ci\.ya?ml$/,
      /^\.?travis\.ya?ml$/,
      /^cloudbuild\.ya?ml$/,
      /^app\.ya?ml$/,
      /^serverless\.ya?ml$/,
      /^netlify\.ya?ml$/,
      /^vercel\.ya?ml$/,
    ];

    for (const pattern of yamlConfigPatterns) {
      if (pattern.test(basename)) {
        return true;
      }
    }

    // TOML config files
    if (basename.endsWith('.toml')) {
      return true;
    }

    // Files starting with . are usually configs
    if (basename.startsWith('.') && basename.endsWith('.json')) {
      return true;
    }

    // JSON files in root that look like configs
    const configSuffixes = ['config.json', 'rc.json', 'settings.json'];
    for (const suffix of configSuffixes) {
      if (basename.endsWith(suffix)) {
        return true;
      }
    }

    return false;
  }

  async parseFile(filePath: string, content: string): Promise<ParseResult> {
    const errors: ParseError[] = [];

    if (this.isFileTooLarge(content)) {
      return this.emptyResult([{
        message: 'File too large to parse',
        severity: 'warning',
      }]);
    }

    const format = this.detectFormat(filePath);
    const configType = this.detectConfigType(filePath);

    let parsed: unknown;
    try {
      parsed = this.parseContent(content, format);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown parse error';
      return this.emptyResult([{
        message: `Failed to parse ${format.toUpperCase()}: ${message}`,
        severity: 'error',
      }]);
    }

    if (parsed === null || typeof parsed !== 'object') {
      return this.emptyResult([{
        message: 'Configuration file does not contain an object',
        severity: 'warning',
      }]);
    }

    const entries = this.extractEntries(
      parsed,
      filePath,
      format,
      configType,
      content
    );

    // Convert entries to variables for compatibility with the existing system
    const variables = entries.map(entry => this.entryToVariable(entry));

    return {
      functions: [],
      classes: [],
      interfaces: [],
      typeAliases: [],
      variables,
      imports: [],
      exports: [],
      references: [],
      calls: [],
      typeRelationships: [],
      errors,
    };
  }

  private detectFormat(filePath: string): ConfigFormat {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case '.yaml':
      case '.yml':
        return 'yaml';
      case '.toml':
        return 'toml';
      case '.json':
      default:
        return 'json';
    }
  }

  private detectConfigType(filePath: string): KnownConfigType {
    const basename = path.basename(filePath).toLowerCase();

    // Direct match
    if (basename in KNOWN_CONFIG_PATTERNS) {
      return KNOWN_CONFIG_PATTERNS[basename]!;
    }

    // Pattern matching for tsconfig variants
    if (basename.startsWith('tsconfig.') && basename.endsWith('.json')) {
      return 'tsconfig';
    }

    // Check directory for GitHub Actions
    const dir = path.dirname(filePath);
    if (dir.includes('.github') && dir.includes('workflows')) {
      return 'github-actions';
    }

    return 'unknown';
  }

  private parseContent(content: string, format: ConfigFormat): unknown {
    switch (format) {
      case 'yaml':
        return YAML.parse(content);
      case 'toml':
        return TOML.parse(content);
      case 'json':
      default:
        return JSON.parse(content);
    }
  }

  private extractEntries(
    obj: unknown,
    filePath: string,
    format: ConfigFormat,
    configType: KnownConfigType,
    content: string,
    currentPath = '',
    depth = 0,
    parentPath: string | null = null
  ): ConfigEntrySignature[] {
    const entries: ConfigEntrySignature[] = [];

    if (obj === null || typeof obj !== 'object') {
      return entries;
    }

    const isArray = Array.isArray(obj);
    const items = isArray ? obj : Object.entries(obj as Record<string, unknown>);

    for (let i = 0; i < items.length; i++) {
      const [key, value] = isArray ? [String(i), items[i]] : items[i] as [string, unknown];
      const entryPath = currentPath ? `${currentPath}.${key}` : key;
      const valueType = this.getValueType(value);
      const lineNumber = this.findLineNumber(content, key, format, depth);

      const entry: ConfigEntrySignature = {
        id: this.generateId(filePath, entryPath, 'config', lineNumber),
        name: key,
        path: entryPath,
        fullyQualifiedName: this.generateFullyQualifiedName(filePath, entryPath),
        valueType,
        value: this.stringifyValue(value),
        rawValue: value,
        depth,
        parentPath,
        location: {
          filePath,
          startLine: lineNumber,
          endLine: lineNumber,
        },
        format,
        configType,
        description: this.getDescription(configType, entryPath),
      };

      entries.push(entry);

      // Recursively extract nested entries (but limit depth for performance)
      if (depth < 5 && (valueType === 'object' || valueType === 'array')) {
        const nestedEntries = this.extractEntries(
          value,
          filePath,
          format,
          configType,
          content,
          entryPath,
          depth + 1,
          entryPath
        );
        entries.push(...nestedEntries);
      }
    }

    return entries;
  }

  private getValueType(value: unknown): ConfigValueType {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    switch (typeof value) {
      case 'string': return 'string';
      case 'number': return 'number';
      case 'boolean': return 'boolean';
      case 'object': return 'object';
      default: return 'string';
    }
  }

  private stringifyValue(value: unknown): string {
    if (value === null) return 'null';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (Array.isArray(value)) {
      if (value.length <= 5 && value.every(v => typeof v === 'string' || typeof v === 'number')) {
        return JSON.stringify(value);
      }
      return `Array(${value.length})`;
    }
    if (typeof value === 'object') {
      const keys = Object.keys(value as object);
      if (keys.length <= 3) {
        return `{ ${keys.join(', ')} }`;
      }
      return `Object(${keys.length} keys)`;
    }
    return String(value);
  }

  private findLineNumber(
    content: string,
    key: string,
    format: ConfigFormat,
    depth: number
  ): number {
    // Simple heuristic: search for the key in content
    // This is imprecise but gives a reasonable approximation
    const lines = content.split('\n');
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    let pattern: RegExp;
    switch (format) {
      case 'yaml':
        pattern = new RegExp(`^\\s*${escapedKey}\\s*:`);
        break;
      case 'toml':
        pattern = new RegExp(`^\\s*${escapedKey}\\s*=|^\\s*\\[${escapedKey}\\]`);
        break;
      case 'json':
      default:
        pattern = new RegExp(`"${escapedKey}"\\s*:`);
        break;
    }

    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i]!)) {
        return i + 1;
      }
    }

    return 1;
  }

  private getDescription(configType: KnownConfigType, path: string): string | undefined {
    const descriptions = CONFIG_DESCRIPTIONS[configType];
    if (!descriptions) return undefined;
    return descriptions[path];
  }

  private entryToVariable(entry: ConfigEntrySignature) {
    return {
      id: entry.id,
      name: entry.path, // Use full path as name for searchability
      fullyQualifiedName: entry.fullyQualifiedName,
      type: `${entry.configType}:${entry.valueType}`,
      kind: 'const' as const,
      isExported: true,
      documentation: entry.description ? {
        description: entry.description,
        params: [],
        tags: [{ tag: 'config', text: entry.format }],
      } : null,
      location: entry.location,
    };
  }

  private emptyResult(errors: ParseError[] = []): ParseResult {
    return {
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
      errors,
    };
  }

  /**
   * Get the raw config entries (for config-specific tools)
   */
  async parseConfigFile(
    filePath: string,
    content: string
  ): Promise<{ entries: ConfigEntrySignature[]; errors: ParseError[] }> {
    const errors: ParseError[] = [];

    if (this.isFileTooLarge(content)) {
      return {
        entries: [],
        errors: [{ message: 'File too large to parse', severity: 'warning' }],
      };
    }

    const format = this.detectFormat(filePath);
    const configType = this.detectConfigType(filePath);

    let parsed: unknown;
    try {
      parsed = this.parseContent(content, format);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown parse error';
      return {
        entries: [],
        errors: [{ message: `Failed to parse ${format.toUpperCase()}: ${message}`, severity: 'error' }],
      };
    }

    if (parsed === null || typeof parsed !== 'object') {
      return {
        entries: [],
        errors: [{ message: 'Configuration file does not contain an object', severity: 'warning' }],
      };
    }

    const entries = this.extractEntries(parsed, filePath, format, configType, content);

    return { entries, errors };
  }

  /**
   * Get a specific value by path from a config file
   */
  getValueByPath(parsed: unknown, pathStr: string): unknown {
    const parts = pathStr.split('.');
    let current: unknown = parsed;

    for (const part of parts) {
      if (current === null || typeof current !== 'object') {
        return undefined;
      }
      if (Array.isArray(current)) {
        const index = parseInt(part, 10);
        if (isNaN(index)) return undefined;
        current = current[index];
      } else {
        current = (current as Record<string, unknown>)[part];
      }
    }

    return current;
  }
}
