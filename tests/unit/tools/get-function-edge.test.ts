import { describe, it, expect } from 'vitest';
import { getFunctionTool } from '../../../src/server/tools/get-function.js';

const FILE = '/tmp/sample.ts';

// Helper to create a successful resolve result
const successResolve = (filePath: string) => ({
  success: true as const,
  result: { resolvedPath: filePath, relativePath: filePath.replace('/tmp/', '') },
});


async function runGetFunction(indexer: any, input: Record<string, unknown> = {}) {
  return getFunctionTool(indexer, { format: 'markdown', ...input } as any);
}

describe('get_function tool - edge cases', () => {
  it('reports not found when function is missing', async () => {
    const indexer = {
      resolvePath: async () => successResolve(FILE),
      getFunction: async () => null,
      getFunctionWithDetails: async () => ({ success: false, error: 'Function "missing" not found' }),
      getFile: async () => ({ classes: [], language: 'typescript' }),
    } as any;

    const result = await runGetFunction(indexer, { filePath: FILE, functionName: 'missing' });
    expect(result.content[0]?.text.toLowerCase()).toContain('not found');
  });

  it('retrieves class method with context when requested', async () => {
    const method = {
      name: 'findById',
      kind: 'method',
      signature: 'async function findById(id: string): Promise<User | null>',
      location: { filePath: FILE, startLine: 10, endLine: 20 },
      modifiers: { isAsync: true, isExported: false, isStatic: false, isPrivate: false, isProtected: false, isAbstract: false, isGenerator: false },
      parentClass: 'UserService',
      localName: 'findById',
      documentation: null,
      parameters: [],
      returnType: 'Promise<User | null>',
    };

    const indexer = {
      resolvePath: async () => successResolve(FILE),
      getFunction: async () => null,
      getFunctionWithDetails: async () => ({ success: false, error: 'Function "findById" not found' }),
      getFile: async () => ({
        language: 'typescript',
        classes: [{ name: 'UserService', methods: [method] }],
      }),
      getSourceWithContext: async (_fp: string, _s: number, _e: number, _c: number) => ({
        source: 'class UserService {\n  async findById(id: string) {\n    return null;\n  }\n}',
        actualStartLine: 8,
        actualEndLine: 22,
      }),
    } as any;

    const result = await runGetFunction(indexer, {
      filePath: FILE,
      functionName: 'findById',
      includeContext: true,
      contextLines: 2,
    });

    const text = result.content[0]?.text ?? '';
    expect(text).toContain('Source Code');
    expect(text).toContain('```typescript');
    expect(text).toContain('findById');
  });

  it('reports file read failure gracefully', async () => {
    const func = {
      name: 'greet',
      kind: 'function',
      signature: 'function greet(): string',
      location: { filePath: FILE, startLine: 1, endLine: 3 },
      modifiers: { isAsync: false, isExported: true, isStatic: false, isPrivate: false, isProtected: false, isAbstract: false, isGenerator: false },
      parentClass: null,
      documentation: null,
      parameters: [],
      returnType: 'string',
    };

    const indexer = {
      resolvePath: async () => successResolve(FILE),
      getFunction: async () => func,
      getFunctionWithDetails: async () => ({ success: true, function: func }),
      getFunctionSource: async () => null, // simulate read failure
      getFile: async () => ({ language: 'typescript' }),
    } as any;

    const result = await runGetFunction(indexer, { filePath: FILE, functionName: 'greet' });
    expect(result.content[0]?.text).toMatch(/Could not read source/i);
  });

  it('supports compact output format', async () => {
    const func = {
      name: 'greet',
      kind: 'function',
      signature: 'function greet(name: string): string',
      location: { filePath: FILE, startLine: 1, endLine: 3 },
      modifiers: { isAsync: false, isExported: true, isStatic: false, isPrivate: false, isProtected: false, isAbstract: false, isGenerator: false },
      parentClass: null,
      documentation: null,
      parameters: [],
      returnType: 'string',
    };

    const indexer = {
      resolvePath: async () => successResolve(FILE),
      getFunctionWithDetails: async () => ({ success: true, function: func }),
      getFunctionSource: async () => 'export function greet(name: string): string {\n  return `hi ${name}`;\n}',
      getFile: async () => ({ language: 'typescript', relativePath: 'sample.ts' }),
    } as any;

    const result = await runGetFunction(indexer, {
      filePath: FILE,
      functionName: 'greet',
      format: 'compact',
    });

    const text = result.content[0]?.text ?? '';
    expect(text).toContain('[FUNCTION]');
    expect(text).toContain('name\tkind\tfile\tline\tclass\tasync\texported\tsignature');
    expect(text).toContain('===SOURCE===');
    expect(text).not.toContain('# greet');
  });
});
