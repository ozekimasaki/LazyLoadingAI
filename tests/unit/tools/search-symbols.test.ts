/**
 * Unit tests for search-symbols tool
 */

import { describe, it, expect, vi } from 'vitest';
import { searchSymbolsTool } from '../../../src/server/tools/search-symbols.js';

function createMockIndexer(options?: {
  symbolResults?: Array<{
    symbol: {
      id: string;
      name: string;
      kind: string;
      signature: string;
      filePath: string;
      line: number;
    };
    score: number;
    matches: Array<{ field: string; indices: Array<[number, number]> }>;
  }>;
  typeResults?: Array<{
    symbolId: string;
    symbolName: string;
    filePath: string;
    language: 'typescript' | 'javascript' | 'python';
    returnType: string | null;
    paramCount: number;
    isMethod: boolean;
    parentClass: string | null;
    matchedParams?: Array<{ name: string; type: string; index: number }>;
  }>;
}) {
  const searchSymbols = vi.fn().mockResolvedValue(options?.symbolResults ?? []);
  const searchByType = vi.fn().mockResolvedValue(options?.typeResults ?? []);

  return {
    searchSymbols,
    getStorage() {
      return {
        searchByType,
      };
    },
    _searchByType: searchByType,
  };
}


async function runSearchSymbols(indexer: any, input: Record<string, unknown> = {}) {
  return searchSymbolsTool(indexer, { format: 'markdown', ...input } as any);
}

describe('searchSymbolsTool', () => {
  it('requires at least one search criteria', async () => {
    const mockIndexer = createMockIndexer();

    const result = await runSearchSymbols(mockIndexer as any, {});

    expect(result.content[0].text).toContain('Please provide at least one search criteria');
    expect(result.content[0].text).toContain('query');
    expect(result.content[0].text).toContain('return_type');
    expect(result.content[0].text).toContain('param_type');
    expect(mockIndexer.searchSymbols).not.toHaveBeenCalled();
    expect(mockIndexer._searchByType).not.toHaveBeenCalled();
  });

  it('keeps name-based search behavior when only query is provided', async () => {
    const mockIndexer = createMockIndexer({
      symbolResults: [
        {
          symbol: {
            id: 'sym-1',
            name: 'greet',
            kind: 'function',
            signature: 'function greet(name: string): string',
            filePath: '/src/sample.ts',
            line: 10,
          },
          score: 0.9,
          matches: [],
        },
      ],
    });

    const result = await runSearchSymbols(mockIndexer as any, {
      query: 'greet',
      expand_synonyms: false,
    });

    expect(mockIndexer.searchSymbols).toHaveBeenCalledWith(
      'greet',
      expect.objectContaining({ type: undefined, language: undefined, limit: 20 })
    );
    expect(result.content[0].text).toContain('Search Results for "greet"');
    expect(result.content[0].text).toContain('greet');
  });

  it('supports compact output for name search', async () => {
    const mockIndexer = createMockIndexer({
      symbolResults: [
        {
          symbol: {
            id: 'sym-compact-1',
            name: 'registerRoute',
            kind: 'function',
            signature: 'function registerRoute(opts: RouteOptions): void',
            filePath: 'src/route.ts',
            line: 45,
          },
          score: 0.95,
          matches: [],
        },
      ],
    });

    const result = await runSearchSymbols(mockIndexer as any, {
      query: 'registerRoute',
      expand_synonyms: false,
      format: 'compact',
    });

    const text = result.content[0].text;
    expect(text).toContain('name\tkind\tfile\tline\tscore\tsignature');
    expect(text).toContain('registerRoute\tfunction\tsrc/route.ts\t45\t0.95\tfunction registerRoute(opts: RouteOptions): void');
    expect(text).not.toContain('Search Results for');
  });

  it('routes to type-based search with match_mode when return_type is provided', async () => {
    const mockIndexer = createMockIndexer({
      typeResults: [
        {
          symbolId: 'sym-2',
          symbolName: 'findById',
          filePath: '/src/user-service.ts',
          language: 'typescript',
          returnType: 'Promise<User | null>',
          paramCount: 1,
          isMethod: true,
          parentClass: 'UserService',
        },
      ],
    });

    const result = await runSearchSymbols(mockIndexer as any, {
      return_type: 'User',
      match_mode: 'inner',
      verbose: true,
    });

    expect(mockIndexer._searchByType).toHaveBeenCalledWith(
      expect.objectContaining({
        returnType: 'User',
        paramType: undefined,
        matchMode: 'inner',
        includeAsyncVariants: true,
        includeNullableVariants: true,
      })
    );
    expect(mockIndexer.searchSymbols).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain('Type-Based Search Results');
    expect(result.content[0].text).toContain('Match Mode**: inner');
    expect(result.content[0].text).toContain('UserService.findById');
  });

  it('supports combined type search with query as an additional filter', async () => {
    const mockIndexer = createMockIndexer({
      typeResults: [
        {
          symbolId: 'sym-3',
          symbolName: 'createUser',
          filePath: '/src/user.ts',
          language: 'typescript',
          returnType: 'User',
          paramCount: 1,
          isMethod: false,
          parentClass: null,
          matchedParams: [{ name: 'input', type: 'UserInput', index: 0 }],
        },
        {
          symbolId: 'sym-4',
          symbolName: 'updateProfile',
          filePath: '/src/user.ts',
          language: 'typescript',
          returnType: 'User',
          paramCount: 1,
          isMethod: false,
          parentClass: null,
          matchedParams: [{ name: 'input', type: 'UserInput', index: 0 }],
        },
      ],
    });

    const result = await runSearchSymbols(mockIndexer as any, {
      query: 'create',
      param_type: 'UserInput',
      match_mode: 'base',
      verbose: false,
    });

    expect(result.content[0].text).toContain('Name contains: `create`');
    expect(result.content[0].text).toContain('createUser');
    expect(result.content[0].text).not.toContain('updateProfile');
    expect(result.content[0].text).toContain('**Found**: 1 function(s)');
  });
});
