/**
 * Parser registry for managing language parsers
 */

import type { Language } from '../../types/index.js';
import { LanguageParser, type ParserOptions } from './base.js';

export class ParserRegistry {
  private parsers: Map<Language, LanguageParser> = new Map();
  private extensionMap: Map<string, LanguageParser> = new Map();

  /**
   * Register a parser for a language
   */
  register(parser: LanguageParser): void {
    this.parsers.set(parser.language, parser);

    for (const ext of parser.extensions) {
      this.extensionMap.set(ext.toLowerCase(), parser);
    }
  }

  /**
   * Get a parser by language
   */
  getByLanguage(language: Language): LanguageParser | undefined {
    return this.parsers.get(language);
  }

  /**
   * Get a parser for a file path based on extension
   */
  getByFilePath(filePath: string): LanguageParser | undefined {
    const ext = this.getExtension(filePath);
    return this.extensionMap.get(ext);
  }

  /**
   * Check if a file can be parsed
   */
  canParse(filePath: string): boolean {
    const parser = this.getByFilePath(filePath);
    return parser?.canParse(filePath) ?? false;
  }

  /**
   * Get all registered languages
   */
  getLanguages(): Language[] {
    return Array.from(this.parsers.keys());
  }

  /**
   * Get all supported extensions
   */
  getExtensions(): string[] {
    return Array.from(this.extensionMap.keys());
  }

  /**
   * Get file extension (lowercase, without dot)
   */
  private getExtension(filePath: string): string {
    const match = filePath.match(/\.([^.]+)$/);
    return match ? match[1]!.toLowerCase() : '';
  }
}

/**
 * Create a parser registry with default parsers
 */
export async function createDefaultRegistry(
  options: ParserOptions = {}
): Promise<ParserRegistry> {
  const registry = new ParserRegistry();

  // Dynamically import parsers to avoid loading unused dependencies
  const [{ TypeScriptParser }, { PythonParser }, { ConfigurationParser }] = await Promise.all([
    import('./typescript.js'),
    import('./python.js'),
    import('./configuration.js'),
  ]);

  registry.register(new TypeScriptParser(options));
  registry.register(new PythonParser(options));
  registry.register(new ConfigurationParser(options));

  return registry;
}

// Singleton registry instance
let defaultRegistry: ParserRegistry | null = null;

export async function getDefaultRegistry(
  options: ParserOptions = {}
): Promise<ParserRegistry> {
  if (!defaultRegistry) {
    defaultRegistry = await createDefaultRegistry(options);
  }
  return defaultRegistry;
}

export function resetRegistry(): void {
  defaultRegistry = null;
}
