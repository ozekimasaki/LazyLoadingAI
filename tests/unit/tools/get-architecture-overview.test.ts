/**
 * Unit tests for get-architecture-overview tool
 */

import { describe, it, expect } from 'vitest';
import { getArchitectureOverviewTool } from '../../../src/server/tools/get-architecture-overview.js';
import {
  createTestFileIndex,
  createTestFunctionSignature,
  createTestClassSignature,
} from '../../helpers/database.js';
import type { FileIndex } from '../../../src/types/index.js';

interface MockOptions {
  files: FileIndex[];
  fileImports?: Record<string, any[]>;
  fileExports?: Record<string, any[]>;
  configFiles?: any[];
  configValues?: Record<string, any[]>;
}

function createMockIndexer(options: MockOptions) {
  const {
    files,
    fileImports = {},
    fileExports = {},
    configFiles = [],
    configValues = {},
  } = options;

  return {
    getStorage() {
      return {
        async listFiles() {
          return files;
        },
        async getFileImports(filePath: string) {
          return fileImports[filePath] ?? [];
        },
        async getFileExports(filePath: string) {
          return fileExports[filePath] ?? [];
        },
        async getFile(filePath: string) {
          return files.find(file => file.filePath === filePath) ?? null;
        },
        async listConfigFiles() {
          return configFiles;
        },
        async getConfigValue(configPath: string, filePath?: string) {
          const key = `${filePath ?? 'all'}::${configPath}`;
          return configValues[key] ?? [];
        },
      };
    },
  };
}

function buildSampleProject(): {
  files: FileIndex[];
  fileImports: Record<string, any[]>;
  fileExports: Record<string, any[]>;
  configFiles: any[];
  configValues: Record<string, any[]>;
} {
  const indexerFile = createTestFileIndex({
    filePath: '/project/src/indexer/index.ts',
    relativePath: 'src/indexer/index.ts',
    lineCount: 280,
    classes: [
      createTestClassSignature({
        name: 'Indexer',
        signature: 'export class Indexer',
        isExported: true,
        methods: Array.from({ length: 8 }, (_unused, index) =>
          createTestFunctionSignature({ name: `method${index}` })
        ),
        properties: [],
      }),
    ],
    functions: [
      createTestFunctionSignature({
        name: 'createIndex',
        signature: 'export function createIndex(rootDir: string): Indexer',
        modifiers: {
          isExported: true,
          isAsync: false,
          isGenerator: false,
          isStatic: false,
          isAbstract: false,
          visibility: 'public',
        } as any,
      }),
    ],
  });

  const serverFile = createTestFileIndex({
    filePath: '/project/src/server/index.ts',
    relativePath: 'src/server/index.ts',
    lineCount: 220,
    functions: [
      createTestFunctionSignature({
        name: 'createServer',
        signature: 'export function createServer(indexer: Indexer): object',
        modifiers: {
          isExported: true,
          isAsync: false,
          isGenerator: false,
          isStatic: false,
          isAbstract: false,
          visibility: 'public',
        } as any,
      }),
    ],
  });

  const entryFile = createTestFileIndex({
    filePath: '/project/src/index.ts',
    relativePath: 'src/index.ts',
    lineCount: 40,
    functions: [
      createTestFunctionSignature({
        name: 'bootstrap',
        signature: 'export function bootstrap(): void',
        modifiers: {
          isExported: true,
          isAsync: false,
          isGenerator: false,
          isStatic: false,
          isAbstract: false,
          visibility: 'public',
        } as any,
      }),
    ],
  });

  const tinyModule = createTestFileIndex({
    filePath: '/project/src/legacy/singleton.ts',
    relativePath: 'src/legacy/singleton.ts',
    lineCount: 24,
    functions: [
      createTestFunctionSignature({
        name: 'run',
        signature: 'export function run(): void',
        modifiers: {
          isExported: true,
          isAsync: false,
          isGenerator: false,
          isStatic: false,
          isAbstract: false,
          visibility: 'public',
        } as any,
      }),
    ],
  });

  const files = [entryFile, indexerFile, serverFile, tinyModule];

  const fileImports: Record<string, any[]> = {
    '/project/src/server/index.ts': [
      {
        source: '../indexer/index.js',
        resolvedPath: '/project/src/indexer/index.ts',
        isExternal: false,
        isTypeOnly: false,
        isReExport: false,
        specifiers: [{ name: 'Indexer', isDefault: false, isNamespace: false }],
      },
    ],
    '/project/src/index.ts': [
      {
        source: './indexer/index.js',
        resolvedPath: '/project/src/indexer/index.ts',
        isExternal: false,
        isTypeOnly: true,
        isReExport: false,
        specifiers: [{ name: 'Indexer', isDefault: false, isNamespace: false }],
      },
      {
        source: './server/index.js',
        resolvedPath: '/project/src/server/index.ts',
        isExternal: false,
        isTypeOnly: false,
        isReExport: true,
        specifiers: [{ name: 'createServer', isDefault: false, isNamespace: false }],
      },
    ],
  };

  const fileExports: Record<string, any[]> = {
    '/project/src/index.ts': [
      {
        name: 'Indexer',
        isDefault: false,
        isReExport: true,
        reExportSource: './indexer/index.js',
        resolvedReExportPath: '/project/src/indexer/index.ts',
      },
      {
        name: 'createServer',
        isDefault: false,
        isReExport: true,
        reExportSource: './server/index.js',
        resolvedReExportPath: '/project/src/server/index.ts',
      },
    ],
  };

  const configFiles = [
    {
      filePath: '/project/package.json',
      relativePath: 'package.json',
      format: 'json',
      configType: 'package.json',
      entryCount: 4,
    },
  ];

  const configValues: Record<string, any[]> = {
    '/project/package.json::exports': [
      {
        path: 'exports',
        value: '{"." : "./dist/index.js"}',
        rawValue: { '.': './dist/index.js' },
        valueType: 'object',
        filePath: '/project/package.json',
        format: 'json',
        configType: 'package.json',
        description: null,
        lineNumber: 1,
      },
    ],
  };

  return {
    files,
    fileImports,
    fileExports,
    configFiles,
    configValues,
  };
}

describe('getArchitectureOverviewTool', () => {
  it('returns helpful message when index is empty', async () => {
    const indexer = createMockIndexer({ files: [] });

    const result = await getArchitectureOverviewTool(indexer as any, {});
    const text = result.content[0]?.text ?? '';

    expect(text).toContain('No indexed files found');
    expect(text).toContain('lazy-load index');
  });

  it('renders modules, dependencies, entry points, public API, and patterns', async () => {
    const sample = buildSampleProject();
    const indexer = createMockIndexer(sample);

    const result = await getArchitectureOverviewTool(indexer as any, {
      focus: 'full',
      format: 'markdown',
    });
    const text = result.content[0]?.text ?? '';

    expect(text).toContain('## Modules');
    expect(text).toContain('## Module Dependencies');
    expect(text).toContain('## Entry Points');
    expect(text).toContain('## Public API');
    expect(text).toContain('## Key Patterns');
    expect(text).toContain('src/server/');
    expect(text).toContain('src/indexer/');
    expect(text).toContain('createServer');
    expect(text).toContain('class Indexer');
  });

  it('supports compact output format', async () => {
    const sample = buildSampleProject();
    const indexer = createMockIndexer(sample);

    const result = await getArchitectureOverviewTool(indexer as any, {
      focus: 'full',
      format: 'compact',
    });
    const text = result.content[0]?.text ?? '';

    expect(text).toContain('[MODULES]');
    expect(text).toContain('name\tfiles\tlines\ttop_exports');
    expect(text).toContain('(src/indexer/index.ts:');
    expect(text).toContain('[DEPS]');
    expect(text).toContain('from\tto\tsymbols');
    expect(text).toContain('[PUBLIC_API]');
    expect(text).toContain('name\tkind\tfile\tline\tsignature');
  });

  it('defaults to compact output format when format is omitted', async () => {
    const sample = buildSampleProject();
    const indexer = createMockIndexer(sample);

    const result = await getArchitectureOverviewTool(indexer as any, {
      focus: 'full',
    });
    const text = result.content[0]?.text ?? '';

    expect(text).toContain('[MODULES]');
    expect(text).toContain('[DEPS]');
    expect(text).not.toContain('## Modules');
  });

  it('omits unknown line anchors when startLine is zero', async () => {
    const zeroLineFile = createTestFileIndex({
      filePath: '/project/src/zero.ts',
      relativePath: 'src/zero.ts',
      lineCount: 20,
      functions: [
        createTestFunctionSignature({
          name: 'zeroLine',
          signature: 'export function zeroLine(): void',
          location: {
            filePath: '/project/src/zero.ts',
            startLine: 0,
            endLine: 2,
          },
          modifiers: {
            isExported: true,
            isAsync: false,
            isGenerator: false,
            isStatic: false,
            isAbstract: false,
            visibility: 'public',
          } as any,
        }),
      ],
    });
    const indexer = createMockIndexer({ files: [zeroLineFile] });

    const result = await getArchitectureOverviewTool(indexer as any, {
      focus: 'full',
      format: 'compact',
    });
    const text = result.content[0]?.text ?? '';

    expect(text).toContain('zeroLine (src/zero.ts)');
    expect(text).not.toContain('zeroLine (src/zero.ts:0)');
    expect(text).toContain('zeroLine\tfunction\tsrc/zero.ts\t\t');
  });

  it('falls back to structured export listings when module narrative confidence is low', async () => {
    const sample = buildSampleProject();
    const indexer = createMockIndexer(sample);

    const result = await getArchitectureOverviewTool(indexer as any, {
      focus: 'modules',
      format: 'markdown',
    });
    const text = result.content[0]?.text ?? '';

    expect(text).toContain('Structured export listing (fallback)');
    expect(text).toContain('src/legacy/');
  });

  it('supports public_api focus and file grouping', async () => {
    const sample = buildSampleProject();
    const indexer = createMockIndexer(sample);

    const result = await getArchitectureOverviewTool(indexer as any, {
      focus: 'public_api',
      group_by: 'file',
      format: 'markdown',
    });
    const text = result.content[0]?.text ?? '';

    expect(text).toContain('## Public API');
    expect(text).toContain('`src/indexer/index.ts`');
    expect(text).toContain('`src/server/index.ts`');
    expect(text).not.toContain('## Modules');
  });

  it('respects entry_file override for public API extraction scope', async () => {
    const sample = buildSampleProject();
    const indexer = createMockIndexer(sample);

    const result = await getArchitectureOverviewTool(indexer as any, {
      focus: 'public_api',
      entry_file: 'src/server/index.ts',
      format: 'markdown',
    });
    const text = result.content[0]?.text ?? '';

    expect(text).toContain('createServer');
    expect(text).not.toContain('class Indexer');
  });

  it('annotates type-only dependency edges', async () => {
    const sample = buildSampleProject();
    const indexer = createMockIndexer(sample);

    const result = await getArchitectureOverviewTool(indexer as any, {
      focus: 'dependencies',
      format: 'markdown',
    });
    const text = result.content[0]?.text ?? '';

    expect(text).toContain('[type-only]');
  });

  it('deduplicates repeated export names within the same module rendering', async () => {
    const templatesA = createTestFileIndex({
      filePath: '/project/src/templates/agents-md.ts',
      relativePath: 'src/templates/agents-md.ts',
      lineCount: 20,
      functions: [
        createTestFunctionSignature({
          name: 'hasLazyLoadingSection',
          signature: 'export function hasLazyLoadingSection(content: string): boolean',
          modifiers: {
            isExported: true,
            isAsync: false,
            isGenerator: false,
            isStatic: false,
            isAbstract: false,
            visibility: 'public',
          } as any,
        }),
      ],
    });

    const templatesB = createTestFileIndex({
      filePath: '/project/src/templates/claude-md.ts',
      relativePath: 'src/templates/claude-md.ts',
      lineCount: 20,
      functions: [
        createTestFunctionSignature({
          name: 'hasLazyLoadingSection',
          signature: 'export function hasLazyLoadingSection(content: string): boolean',
          modifiers: {
            isExported: true,
            isAsync: false,
            isGenerator: false,
            isStatic: false,
            isAbstract: false,
            visibility: 'public',
          } as any,
        }),
      ],
    });

    const indexer = createMockIndexer({ files: [templatesA, templatesB] });
    const result = await getArchitectureOverviewTool(indexer as any, {
      focus: 'modules',
      format: 'markdown',
    });
    const text = result.content[0]?.text ?? '';

    const occurrences = (text.match(/function hasLazyLoadingSection\(\)/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it('excludes test/examples/build modules even when they export symbols', async () => {
    const testHelper = createTestFileIndex({
      filePath: '/project/test/test-helper.ts',
      relativePath: 'test/test-helper.ts',
      lineCount: 18,
      functions: [
        createTestFunctionSignature({
          name: 'testOnlyExport',
          signature: 'export function testOnlyExport(): void',
          modifiers: {
            isExported: true,
            isAsync: false,
            isGenerator: false,
            isStatic: false,
            isAbstract: false,
            visibility: 'public',
          } as any,
        }),
      ],
    });

    const exampleFeature = createTestFileIndex({
      filePath: '/project/examples/example-feature.ts',
      relativePath: 'examples/example-feature.ts',
      lineCount: 16,
      functions: [
        createTestFunctionSignature({
          name: 'exampleOnlyExport',
          signature: 'export function exampleOnlyExport(): void',
          modifiers: {
            isExported: true,
            isAsync: false,
            isGenerator: false,
            isStatic: false,
            isAbstract: false,
            visibility: 'public',
          } as any,
        }),
      ],
    });

    const buildOutput = createTestFileIndex({
      filePath: '/project/build/generated.ts',
      relativePath: 'build/generated.ts',
      lineCount: 14,
      functions: [
        createTestFunctionSignature({
          name: 'buildOnlyExport',
          signature: 'export function buildOnlyExport(): void',
          modifiers: {
            isExported: true,
            isAsync: false,
            isGenerator: false,
            isStatic: false,
            isAbstract: false,
            visibility: 'public',
          } as any,
        }),
      ],
    });

    const includedModule = createTestFileIndex({
      filePath: '/project/src/core/feature.ts',
      relativePath: 'src/core/feature.ts',
      lineCount: 26,
      functions: [
        createTestFunctionSignature({
          name: 'productionExport',
          signature: 'export function productionExport(): void',
          modifiers: {
            isExported: true,
            isAsync: false,
            isGenerator: false,
            isStatic: false,
            isAbstract: false,
            visibility: 'public',
          } as any,
        }),
      ],
    });

    const indexer = createMockIndexer({
      files: [testHelper, exampleFeature, buildOutput, includedModule],
    });
    const result = await getArchitectureOverviewTool(indexer as any, {
      focus: 'modules',
      format: 'markdown',
    });
    const text = result.content[0]?.text ?? '';

    expect(text).toContain('productionExport');
    expect(text).toContain('src/core/');
    expect(text).not.toContain('testOnlyExport');
    expect(text).not.toContain('exampleOnlyExport');
    expect(text).not.toContain('buildOnlyExport');
    expect(text).not.toContain('test/');
    expect(text).not.toContain('examples/');
    expect(text).not.toContain('build/');
  });
});
