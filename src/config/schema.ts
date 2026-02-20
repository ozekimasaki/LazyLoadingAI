/**
 * Configuration schema using Zod
 */

import { z } from 'zod';

export const parserConfigSchema = z.object({
  maxFileSize: z.number().default(1024 * 1024), // 1MB default, 0 = unlimited
});

export const typeScriptConfigSchema = z.object({
  extractDocumentation: z.boolean().default(true),
  includePrivate: z.boolean().default(false),
  tsConfigPath: z.string().optional(),
});

export const javaScriptConfigSchema = z.object({
  extractDocumentation: z.boolean().default(true),
  includePrivate: z.boolean().default(false),
});

export const pythonConfigSchema = z.object({
  extractDocumentation: z.boolean().default(true),
  includePrivate: z.boolean().default(false),
  docstringFormat: z.enum(['google', 'numpy', 'sphinx', 'auto']).default('auto'),
});

export const languagesConfigSchema = z.object({
  typescript: typeScriptConfigSchema.optional(),
  javascript: javaScriptConfigSchema.optional(),
  python: pythonConfigSchema.optional(),
});

export const outputConfigSchema = z.object({
  database: z.string().default('.lazyload/index.db'),
});

// Synonym configuration schema
export const synonymSchema = z.object({
  term: z.string(),
  relation: z.enum(['exact', 'abbreviation', 'conceptual', 'implementation']).default('conceptual'),
  weight: z.number().min(0).max(1).default(0.8),
  bidirectional: z.boolean().default(true),
  languageHint: z.enum(['typescript', 'python']).optional(),
});

export const synonymEntrySchema = z.object({
  canonical: z.string(),
  category: z.enum(['crud', 'data', 'patterns', 'async', 'errors', 'domain', 'http', 'auth', 'common']).default('common'),
  synonyms: z.array(synonymSchema),
});

export const synonymsConfigSchema = z.object({
  enabled: z.boolean().default(true),
  useBuiltinSynonyms: z.boolean().default(true),
  customSynonyms: z.array(synonymEntrySchema).default([]),
  overrides: z.record(z.string(), z.array(synonymSchema)).default({}),
  disabled: z.array(z.string()).default([]),
  minWeightThreshold: z.number().min(0).max(1).default(0.3),
  maxExpansions: z.number().min(1).max(50).default(15),
});

// Markov chain configuration schema
export const markovConfigSchema = z.object({
  enabled: z.boolean().default(true),
  autoRebuild: z.boolean().default(true),
  chainTypes: z.array(z.enum(['call_flow', 'cooccurrence', 'type_affinity', 'import_cluster'])).default(['call_flow', 'cooccurrence']),
  defaultDepth: z.number().min(1).max(5).default(2),
  defaultDecayFactor: z.number().min(0).max(1).default(0.7),
  minProbability: z.number().min(0).max(1).default(0.05),
  chainWeights: z.object({
    call_flow: z.number().default(0.4),
    cooccurrence: z.number().default(0.25),
    type_affinity: z.number().default(0.2),
    import_cluster: z.number().default(0.15),
  }).default({}),
});

export const configSchema = z.object({
  directories: z.array(z.string()).default(['.']),
  output: outputConfigSchema.default({}),
  include: z.array(z.string()).default([
    '**/*.ts',
    '**/*.tsx',
    '**/*.js',
    '**/*.jsx',
    '**/*.py',
  ]),
  exclude: z.array(z.string()).default([
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.git/**',
    '**/venv/**',
    '**/__pycache__/**',
    '**/coverage/**',
    '**/.next/**',
    '**/.nuxt/**',
  ]),
  languages: languagesConfigSchema.default({}),
  synonyms: synonymsConfigSchema.default({}),
  markov: markovConfigSchema.default({}),
  parser: parserConfigSchema.default({}),
});

export type Config = z.infer<typeof configSchema>;
export type TypeScriptConfig = z.infer<typeof typeScriptConfigSchema>;
export type JavaScriptConfig = z.infer<typeof javaScriptConfigSchema>;
export type PythonConfig = z.infer<typeof pythonConfigSchema>;
export type LanguagesConfig = z.infer<typeof languagesConfigSchema>;
export type OutputConfig = z.infer<typeof outputConfigSchema>;
export type SynonymsConfig = z.infer<typeof synonymsConfigSchema>;
export type MarkovConfig = z.infer<typeof markovConfigSchema>;
export type ParserConfig = z.infer<typeof parserConfigSchema>;
