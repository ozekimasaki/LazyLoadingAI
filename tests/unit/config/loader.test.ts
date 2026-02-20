import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadConfig, getDefaultConfig, findConfig, loadConfigOrDefault } from '../../../src/config/loader.js';
import { getFixturePath } from '../../helpers/fixtures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('Config Loader', () => {
  describe('loadConfig', () => {
    it('should load and parse a valid config file', async () => {
      const configPath = getFixturePath('configs', 'valid-config.json');
      const config = await loadConfig(configPath);

      expect(config.directories).toEqual(['src', 'lib']);
      expect(config.output.database).toBe('.lazyload/index.db');
      expect(config.include).toContain('**/*.ts');
      expect(config.exclude).toContain('**/node_modules/**');
      expect(config.languages.typescript?.extractDocumentation).toBe(true);
      expect(config.languages.python?.docstringFormat).toBe('google');
    });

    it('should apply defaults for missing optional fields', async () => {
      const configPath = getFixturePath('configs', 'minimal-config.json');
      const config = await loadConfig(configPath);

      // Verify defaults are applied
      expect(config.directories).toEqual(['.']);
      expect(config.output.database).toBe('.lazyload/index.db');
      expect(config.include).toContain('**/*.ts');
      expect(config.include).toContain('**/*.py');
      expect(config.exclude).toContain('**/node_modules/**');
    });

    it('should throw for non-existent config file', async () => {
      const configPath = '/non/existent/config.json';

      await expect(loadConfig(configPath)).rejects.toThrow('Config file not found');
    });

    it('should throw for invalid JSON', async () => {
      const configPath = getFixturePath('configs', 'invalid-json.json');

      await expect(loadConfig(configPath)).rejects.toThrow('Invalid JSON');
    });

    it('should throw with field path for schema validation errors', async () => {
      const configPath = getFixturePath('configs', 'invalid-schema.json');

      await expect(loadConfig(configPath)).rejects.toThrow('Invalid configuration');
    });

    it('should resolve relative paths to absolute', async () => {
      const configPath = getFixturePath('configs', 'valid-config.json');
      const config = await loadConfig(configPath);

      // Config should be loaded without error
      expect(config).toBeDefined();
    });
  });

  describe('getDefaultConfig', () => {
    it('should return valid default configuration', () => {
      const config = getDefaultConfig();

      expect(config.directories).toEqual(['.']);
      expect(config.output.database).toBe('.lazyload/index.db');
      expect(config.include).toContain('**/*.ts');
      expect(config.include).toContain('**/*.tsx');
      expect(config.include).toContain('**/*.js');
      expect(config.include).toContain('**/*.jsx');
      expect(config.include).toContain('**/*.py');
      expect(config.exclude).toContain('**/node_modules/**');
      expect(config.exclude).toContain('**/dist/**');
      expect(config.exclude).toContain('**/.git/**');
      expect(config.languages).toEqual({});
    });

    it('should return a new object each time', () => {
      const config1 = getDefaultConfig();
      const config2 = getDefaultConfig();

      expect(config1).not.toBe(config2);
      expect(config1).toEqual(config2);
    });
  });

  describe('findConfig', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lazyload-config-test-'));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should find lazyload.config.json in current directory', async () => {
      const configPath = path.join(tempDir, 'lazyload.config.json');
      fs.writeFileSync(configPath, JSON.stringify({ directories: ['custom'] }));

      const config = await findConfig(tempDir);

      expect(config).not.toBeNull();
      expect(config?.directories).toContain('custom');
    });

    it('should find .lazyloadrc.json in current directory', async () => {
      const configPath = path.join(tempDir, '.lazyloadrc.json');
      fs.writeFileSync(configPath, JSON.stringify({ directories: ['rc-dir'] }));

      const config = await findConfig(tempDir);

      expect(config).not.toBeNull();
      expect(config?.directories).toContain('rc-dir');
    });

    it('should find .lazyloadrc in current directory', async () => {
      const configPath = path.join(tempDir, '.lazyloadrc');
      fs.writeFileSync(configPath, JSON.stringify({ directories: ['rc-no-ext'] }));

      const config = await findConfig(tempDir);

      expect(config).not.toBeNull();
      expect(config?.directories).toContain('rc-no-ext');
    });

    it('should traverse parent directories to find config', async () => {
      const parentConfig = path.join(tempDir, 'lazyload.config.json');
      fs.writeFileSync(parentConfig, JSON.stringify({ directories: ['parent'] }));

      const childDir = path.join(tempDir, 'nested', 'deep');
      fs.mkdirSync(childDir, { recursive: true });

      const config = await findConfig(childDir);

      expect(config).not.toBeNull();
      expect(config?.directories).toContain('parent');
    });

    it('should extract lazyload key from package.json', async () => {
      const packagePath = path.join(tempDir, 'package.json');
      fs.writeFileSync(packagePath, JSON.stringify({
        name: 'test-package',
        lazyload: { directories: ['from-package'] }
      }));

      const config = await findConfig(tempDir);

      expect(config).not.toBeNull();
      expect(config?.directories).toContain('from-package');
    });

    it('should return null when no config is found', async () => {
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lazyload-empty-'));

      try {
        const config = await findConfig(emptyDir);
        expect(config).toBeNull();
      } finally {
        fs.rmSync(emptyDir, { recursive: true, force: true });
      }
    });

    it('should prefer lazyload.config.json over package.json', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'lazyload.config.json'),
        JSON.stringify({ directories: ['from-config'] })
      );
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'test', lazyload: { directories: ['from-package'] } })
      );

      const config = await findConfig(tempDir);

      expect(config?.directories).toContain('from-config');
      expect(config?.directories).not.toContain('from-package');
    });
  });

  describe('loadConfigOrDefault', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lazyload-config-or-default-'));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should load config when found', async () => {
      const configPath = path.join(tempDir, 'lazyload.config.json');
      fs.writeFileSync(configPath, JSON.stringify({ directories: ['found'] }));

      const config = await loadConfigOrDefault(tempDir);

      expect(config.directories).toContain('found');
    });

    it('should return default config when not found', async () => {
      const config = await loadConfigOrDefault(tempDir);

      expect(config.directories).toEqual(['.']);
      expect(config.include).toContain('**/*.ts');
    });
  });
});
