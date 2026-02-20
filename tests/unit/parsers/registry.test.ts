import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ParserRegistry,
  createDefaultRegistry,
  getDefaultRegistry,
  resetRegistry,
} from '../../../src/indexer/parsers/registry.js';
import { TypeScriptParser } from '../../../src/indexer/parsers/typescript.js';
import { PythonParser } from '../../../src/indexer/parsers/python.js';

describe('ParserRegistry', () => {
  let registry: ParserRegistry;

  beforeEach(() => {
    registry = new ParserRegistry();
  });

  describe('register', () => {
    it('should register a parser by language', () => {
      const tsParser = new TypeScriptParser();
      registry.register(tsParser);

      const retrieved = registry.getByLanguage('typescript');
      expect(retrieved).toBe(tsParser);
    });

    it('should register parser extensions', () => {
      const tsParser = new TypeScriptParser();
      registry.register(tsParser);

      expect(registry.getByFilePath('/test/file.ts')).toBe(tsParser);
      expect(registry.getByFilePath('/test/file.tsx')).toBe(tsParser);
      expect(registry.getByFilePath('/test/file.js')).toBe(tsParser);
      expect(registry.getByFilePath('/test/file.jsx')).toBe(tsParser);
    });

    it('should register multiple parsers', () => {
      const tsParser = new TypeScriptParser();
      const pyParser = new PythonParser();

      registry.register(tsParser);
      registry.register(pyParser);

      expect(registry.getByLanguage('typescript')).toBe(tsParser);
      expect(registry.getByLanguage('python')).toBe(pyParser);
    });
  });

  describe('getByLanguage', () => {
    beforeEach(() => {
      registry.register(new TypeScriptParser());
      registry.register(new PythonParser());
    });

    it('should return parser for registered language', () => {
      const parser = registry.getByLanguage('typescript');
      expect(parser).toBeDefined();
      expect(parser?.language).toBe('typescript');
    });

    it('should return undefined for unregistered language', () => {
      const parser = registry.getByLanguage('javascript');
      expect(parser).toBeUndefined();
    });
  });

  describe('getByFilePath', () => {
    beforeEach(() => {
      registry.register(new TypeScriptParser());
      registry.register(new PythonParser());
    });

    it('should return parser for .ts files', () => {
      const parser = registry.getByFilePath('/project/src/file.ts');
      expect(parser).toBeDefined();
      expect(parser?.language).toBe('typescript');
    });

    it('should return parser for .tsx files', () => {
      const parser = registry.getByFilePath('/project/src/component.tsx');
      expect(parser).toBeDefined();
      expect(parser?.language).toBe('typescript');
    });

    it('should return parser for .js files', () => {
      const parser = registry.getByFilePath('/project/src/file.js');
      expect(parser).toBeDefined();
      expect(parser?.language).toBe('typescript'); // JS handled by TS parser
    });

    it('should return parser for .py files', () => {
      const parser = registry.getByFilePath('/project/src/module.py');
      expect(parser).toBeDefined();
      expect(parser?.language).toBe('python');
    });

    it('should be case-insensitive for extensions', () => {
      const parserLower = registry.getByFilePath('/project/file.TS');
      const parserUpper = registry.getByFilePath('/project/file.ts');

      expect(parserLower).toBeDefined();
      expect(parserUpper).toBeDefined();
      expect(parserLower).toBe(parserUpper);
    });

    it('should return undefined for unsupported extensions', () => {
      const parser = registry.getByFilePath('/project/file.rb');
      expect(parser).toBeUndefined();
    });

    it('should handle files without extensions', () => {
      const parser = registry.getByFilePath('/project/Makefile');
      expect(parser).toBeUndefined();
    });
  });

  describe('canParse', () => {
    beforeEach(() => {
      registry.register(new TypeScriptParser());
      registry.register(new PythonParser());
    });

    it('should return true for parseable files', () => {
      expect(registry.canParse('/project/file.ts')).toBe(true);
      expect(registry.canParse('/project/file.py')).toBe(true);
    });

    it('should return false for non-parseable files', () => {
      expect(registry.canParse('/project/file.rb')).toBe(false);
      expect(registry.canParse('/project/file.go')).toBe(false);
    });

    it('should delegate to parser canParse method', () => {
      // TypeScript parser should accept .ts but not some edge cases
      expect(registry.canParse('/project/file.ts')).toBe(true);
    });
  });

  describe('getLanguages', () => {
    it('should return empty array for empty registry', () => {
      const languages = registry.getLanguages();
      expect(languages).toEqual([]);
    });

    it('should return all registered languages', () => {
      registry.register(new TypeScriptParser());
      registry.register(new PythonParser());

      const languages = registry.getLanguages();

      expect(languages).toContain('typescript');
      expect(languages).toContain('python');
      expect(languages.length).toBe(2);
    });
  });

  describe('getExtensions', () => {
    it('should return empty array for empty registry', () => {
      const extensions = registry.getExtensions();
      expect(extensions).toEqual([]);
    });

    it('should return all supported extensions', () => {
      registry.register(new TypeScriptParser());
      registry.register(new PythonParser());

      const extensions = registry.getExtensions();

      expect(extensions).toContain('ts');
      expect(extensions).toContain('tsx');
      expect(extensions).toContain('js');
      expect(extensions).toContain('jsx');
      expect(extensions).toContain('py');
    });
  });
});

describe('createDefaultRegistry', () => {
  it('should create registry with TypeScript parser', async () => {
    const registry = await createDefaultRegistry();
    const parser = registry.getByLanguage('typescript');

    expect(parser).toBeDefined();
    expect(parser?.language).toBe('typescript');
  });

  it('should create registry with Python parser', async () => {
    const registry = await createDefaultRegistry();
    const parser = registry.getByLanguage('python');

    expect(parser).toBeDefined();
    expect(parser?.language).toBe('python');
  });

  it('should pass options to parsers', async () => {
    const registry = await createDefaultRegistry({ includePrivate: true });

    // Verify parsers are created (options are internal)
    expect(registry.getByLanguage('typescript')).toBeDefined();
    expect(registry.getByLanguage('python')).toBeDefined();
  });

  it('should support all expected extensions', async () => {
    const registry = await createDefaultRegistry();

    // TypeScript extensions
    expect(registry.canParse('file.ts')).toBe(true);
    expect(registry.canParse('file.tsx')).toBe(true);
    expect(registry.canParse('file.js')).toBe(true);
    expect(registry.canParse('file.jsx')).toBe(true);
    expect(registry.canParse('file.mts')).toBe(true);
    expect(registry.canParse('file.mjs')).toBe(true);

    // Python extensions
    expect(registry.canParse('file.py')).toBe(true);
  });
});

describe('getDefaultRegistry', () => {
  afterEach(() => {
    resetRegistry();
  });

  it('should return a singleton instance', async () => {
    const registry1 = await getDefaultRegistry();
    const registry2 = await getDefaultRegistry();

    expect(registry1).toBe(registry2);
  });

  it('should create registry with default parsers', async () => {
    const registry = await getDefaultRegistry();

    expect(registry.getByLanguage('typescript')).toBeDefined();
    expect(registry.getByLanguage('python')).toBeDefined();
  });
});

describe('resetRegistry', () => {
  it('should reset the singleton registry', async () => {
    const registry1 = await getDefaultRegistry();
    resetRegistry();
    const registry2 = await getDefaultRegistry();

    expect(registry1).not.toBe(registry2);
  });
});
