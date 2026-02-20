/**
 * Config module exports
 */

export {
  configSchema,
  typeScriptConfigSchema,
  javaScriptConfigSchema,
  pythonConfigSchema,
  languagesConfigSchema,
  outputConfigSchema,
  type Config,
  type TypeScriptConfig,
  type JavaScriptConfig,
  type PythonConfig,
  type LanguagesConfig,
  type OutputConfig,
} from './schema.js';

export {
  loadConfig,
  getDefaultConfig,
  findConfig,
  loadConfigOrDefault,
} from './loader.js';
