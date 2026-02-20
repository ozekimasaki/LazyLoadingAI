/**
 * Configuration file loader
 */

import fs from 'node:fs';
import path from 'node:path';
import { configSchema, type Config } from './schema.js';

export async function loadConfig(configPath: string): Promise<Config> {
  const absolutePath = path.resolve(configPath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Config file not found: ${absolutePath}`);
  }

  const content = await fs.promises.readFile(absolutePath, 'utf-8');

  let rawConfig: unknown;
  try {
    rawConfig = JSON.parse(content);
  } catch (error) {
    throw new Error(`Invalid JSON in config file: ${absolutePath}`);
  }

  const result = configSchema.safeParse(rawConfig);

  if (!result.success) {
    const errors = result.error.errors.map(e => `  - ${e.path.join('.')}: ${e.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${errors}`);
  }

  return result.data;
}

export function getDefaultConfig(): Config {
  return configSchema.parse({});
}

export async function findConfig(startDir: string): Promise<Config | null> {
  const configNames = [
    'lazyload.config.json',
    '.lazyloadrc.json',
    '.lazyloadrc',
  ];

  let currentDir = path.resolve(startDir);
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    for (const configName of configNames) {
      const configPath = path.join(currentDir, configName);
      if (fs.existsSync(configPath)) {
        return loadConfig(configPath);
      }
    }

    // Check package.json for lazyload key
    const packagePath = path.join(currentDir, 'package.json');
    if (fs.existsSync(packagePath)) {
      try {
        const packageContent = JSON.parse(await fs.promises.readFile(packagePath, 'utf-8'));
        if (packageContent.lazyload) {
          const result = configSchema.safeParse(packageContent.lazyload);
          if (result.success) {
            return result.data;
          }
        }
      } catch {
        // Ignore parse errors
      }
    }

    currentDir = path.dirname(currentDir);
  }

  return null;
}

export async function loadConfigOrDefault(startDir: string): Promise<Config> {
  const config = await findConfig(startDir);
  return config ?? getDefaultConfig();
}

export { configSchema, type Config } from './schema.js';
