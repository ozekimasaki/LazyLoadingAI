import { describe, it, expect } from 'vitest';
import {
  configSchema,
  typeScriptConfigSchema,
  pythonConfigSchema,
  outputConfigSchema,
  languagesConfigSchema,
} from '../../../src/config/schema.js';

describe('Config Schema', () => {
  describe('configSchema', () => {
    it('should apply default values for empty object', () => {
      const result = configSchema.parse({});

      expect(result.directories).toEqual(['.']);
      expect(result.output.database).toBe('.lazyload/index.db');
      expect(result.include).toContain('**/*.ts');
      expect(result.include).toContain('**/*.py');
      expect(result.exclude).toContain('**/node_modules/**');
      expect(result.languages).toEqual({});
    });

    it('should validate directories as array of strings', () => {
      const valid = configSchema.safeParse({ directories: ['src', 'lib'] });
      expect(valid.success).toBe(true);

      const invalid = configSchema.safeParse({ directories: 'not-an-array' });
      expect(invalid.success).toBe(false);
    });

    it('should validate include patterns', () => {
      const valid = configSchema.safeParse({ include: ['**/*.ts', '**/*.js'] });
      expect(valid.success).toBe(true);
      expect(valid.data?.include).toEqual(['**/*.ts', '**/*.js']);
    });

    it('should validate exclude patterns', () => {
      const valid = configSchema.safeParse({ exclude: ['**/node_modules/**'] });
      expect(valid.success).toBe(true);
      expect(valid.data?.exclude).toEqual(['**/node_modules/**']);
    });

    it('should validate nested output schema', () => {
      const valid = configSchema.safeParse({
        output: { database: 'custom/path.db' }
      });
      expect(valid.success).toBe(true);
      expect(valid.data?.output.database).toBe('custom/path.db');
    });

    it('should validate nested languages schema', () => {
      const valid = configSchema.safeParse({
        languages: {
          typescript: { includePrivate: true },
          python: { docstringFormat: 'numpy' }
        }
      });
      expect(valid.success).toBe(true);
      expect(valid.data?.languages.typescript?.includePrivate).toBe(true);
      expect(valid.data?.languages.python?.docstringFormat).toBe('numpy');
    });
  });

  describe('outputConfigSchema', () => {
    it('should apply default database path', () => {
      const result = outputConfigSchema.parse({});
      expect(result.database).toBe('.lazyload/index.db');
    });

    it('should accept custom database path', () => {
      const result = outputConfigSchema.parse({ database: 'custom.db' });
      expect(result.database).toBe('custom.db');
    });

    it('should reject non-string database', () => {
      const result = outputConfigSchema.safeParse({ database: 123 });
      expect(result.success).toBe(false);
    });
  });

  describe('typeScriptConfigSchema', () => {
    it('should apply default values', () => {
      const result = typeScriptConfigSchema.parse({});
      expect(result.extractDocumentation).toBe(true);
      expect(result.includePrivate).toBe(false);
      expect(result.tsConfigPath).toBeUndefined();
    });

    it('should validate extractDocumentation as boolean', () => {
      const valid = typeScriptConfigSchema.safeParse({ extractDocumentation: false });
      expect(valid.success).toBe(true);
      expect(valid.data?.extractDocumentation).toBe(false);
    });

    it('should validate includePrivate as boolean', () => {
      const valid = typeScriptConfigSchema.safeParse({ includePrivate: true });
      expect(valid.success).toBe(true);
      expect(valid.data?.includePrivate).toBe(true);
    });

    it('should accept optional tsConfigPath', () => {
      const result = typeScriptConfigSchema.parse({ tsConfigPath: './tsconfig.json' });
      expect(result.tsConfigPath).toBe('./tsconfig.json');
    });
  });

  describe('pythonConfigSchema', () => {
    it('should apply default values', () => {
      const result = pythonConfigSchema.parse({});
      expect(result.extractDocumentation).toBe(true);
      expect(result.includePrivate).toBe(false);
      expect(result.docstringFormat).toBe('auto');
    });

    it('should validate docstringFormat enum', () => {
      const formats = ['google', 'numpy', 'sphinx', 'auto'] as const;

      for (const format of formats) {
        const result = pythonConfigSchema.safeParse({ docstringFormat: format });
        expect(result.success).toBe(true);
        expect(result.data?.docstringFormat).toBe(format);
      }
    });

    it('should reject invalid docstringFormat', () => {
      const result = pythonConfigSchema.safeParse({ docstringFormat: 'invalid' });
      expect(result.success).toBe(false);
    });
  });

  describe('languagesConfigSchema', () => {
    it('should accept empty object', () => {
      const result = languagesConfigSchema.parse({});
      expect(result).toEqual({});
    });

    it('should accept typescript config', () => {
      const result = languagesConfigSchema.parse({
        typescript: { includePrivate: true }
      });
      expect(result.typescript?.includePrivate).toBe(true);
    });

    it('should accept javascript config', () => {
      const result = languagesConfigSchema.parse({
        javascript: { extractDocumentation: false }
      });
      expect(result.javascript?.extractDocumentation).toBe(false);
    });

    it('should accept python config', () => {
      const result = languagesConfigSchema.parse({
        python: { docstringFormat: 'google' }
      });
      expect(result.python?.docstringFormat).toBe('google');
    });

    it('should accept all language configs together', () => {
      const result = languagesConfigSchema.parse({
        typescript: { includePrivate: true },
        javascript: { extractDocumentation: false },
        python: { docstringFormat: 'numpy' }
      });

      expect(result.typescript?.includePrivate).toBe(true);
      expect(result.javascript?.extractDocumentation).toBe(false);
      expect(result.python?.docstringFormat).toBe('numpy');
    });
  });
});
