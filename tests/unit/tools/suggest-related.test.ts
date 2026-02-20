/**
 * Unit tests for suggest-related tool
 */

import { describe, it, expect, vi } from 'vitest';
import { suggestRelatedTool } from '../../../src/server/tools/suggest-related.js';

// Mock the queryWithFallback function
vi.mock('../../../src/markov/query.js', () => ({
  queryWithFallback: vi.fn(),
}));

// Create a mock indexer
function createMockIndexer(
  chainStats: Array<{ totalTransitions: number }> = []
) {
  const mockStorage = {
    getAllChainStats: vi.fn().mockResolvedValue(chainStats),
  };

  return {
    getStorage: () => mockStorage,
    _mockStorage: mockStorage,
  };
}


async function runSuggestRelated(indexer: any, input: Record<string, unknown> = {}) {
  return suggestRelatedTool(indexer, { format: 'markdown', ...input } as any);
}

describe('suggestRelatedTool', () => {
  describe('no suggestions found', () => {
    it('returns message when no chains are built', async () => {
      const { queryWithFallback } = await import('../../../src/markov/query.js');
      (queryWithFallback as any).mockResolvedValueOnce({
        startSymbol: 'testFunc',
        suggestions: [],
        chainsUsed: [],
        executionTimeMs: 5,
      });

      const mockIndexer = createMockIndexer([]);

      const result = await runSuggestRelated(mockIndexer as any, {
        symbol_name: 'testFunc',
      });

      expect(result.content[0].text).toContain('No related symbols found for "testFunc"');
      expect(result.content[0].text).toContain('No Markov chains have been built');
      expect(result.content[0].text).toContain('sync_index');
    });

    it('returns an accurate message when chains exist but symbol has no support', async () => {
      const { queryWithFallback } = await import('../../../src/markov/query.js');
      (queryWithFallback as any).mockResolvedValueOnce({
        startSymbol: 'detachedSymbol',
        suggestions: [],
        chainsUsed: [],
        executionTimeMs: 5,
      });

      const mockIndexer = createMockIndexer([
        { totalTransitions: 12 },
        { totalTransitions: 8 },
      ]);

      const result = await runSuggestRelated(mockIndexer as any, {
        symbol_name: 'detachedSymbol',
      });

      expect(result.content[0].text).toContain('No related symbols found for "detachedSymbol"');
      expect(result.content[0].text).toContain('Markov chains are built, but this symbol has no transitions in the selected chains');
      expect(result.content[0].text).not.toContain('No Markov chains have been built');
    });

    it('returns helpful suggestions when chains exist but no results', async () => {
      const { queryWithFallback } = await import('../../../src/markov/query.js');
      (queryWithFallback as any).mockResolvedValueOnce({
        startSymbol: 'unknownSymbol',
        suggestions: [],
        chainsUsed: ['call_flow', 'cooccurrence'],
        executionTimeMs: 10,
        fallbackUsed: false,
      });

      const mockIndexer = createMockIndexer();

      const result = await runSuggestRelated(mockIndexer as any, {
        symbol_name: 'unknownSymbol',
      });

      expect(result.content[0].text).toContain('No related symbols found for "unknownSymbol"');
      expect(result.content[0].text).toContain('Checking the symbol name spelling');
      expect(result.content[0].text).toContain('find_references');
    });
  });

  describe('with suggestions', () => {
    it('displays related symbols grouped by depth', async () => {
      const { queryWithFallback } = await import('../../../src/markov/query.js');
      (queryWithFallback as any).mockResolvedValueOnce({
        startSymbol: 'UserService',
        suggestions: [
          {
            symbolName: 'getUser',
            score: 0.85,
            depth: 1,
            path: ['UserService', 'getUser'],
            filePath: '/src/services/user.ts',
          },
          {
            symbolName: 'validateUser',
            score: 0.65,
            depth: 2,
            path: ['UserService', 'getUser', 'validateUser'],
            filePath: '/src/validators/user.ts',
          },
        ],
        chainsUsed: ['call_flow', 'cooccurrence'],
        executionTimeMs: 15,
      });

      const mockIndexer = createMockIndexer();

      const result = await runSuggestRelated(mockIndexer as any, {
        symbol_name: 'UserService',
      });

      expect(result.content[0].text).toContain('Related Symbols for "UserService"');
      expect(result.content[0].text).toContain('Directly Related');
      expect(result.content[0].text).toContain('2 Hops Away');
      expect(result.content[0].text).toContain('getUser');
      expect(result.content[0].text).toContain('validateUser');
      expect(result.content[0].text).toContain('85.0%');
      expect(result.content[0].text).toContain('65.0%');
    });

    it('shows execution time and chains used', async () => {
      const { queryWithFallback } = await import('../../../src/markov/query.js');
      (queryWithFallback as any).mockResolvedValueOnce({
        startSymbol: 'test',
        suggestions: [
          {
            symbolName: 'related',
            score: 0.5,
            depth: 1,
            path: ['test', 'related'],
            filePath: '/src/test.ts',
          },
        ],
        chainsUsed: ['call_flow'],
        executionTimeMs: 25,
        fallbackUsed: false,
      });

      const mockIndexer = createMockIndexer();

      const result = await runSuggestRelated(mockIndexer as any, {
        symbol_name: 'test',
      });

      expect(result.content[0].text).toContain('Chains used**: call_flow');
      expect(result.content[0].text).toContain('Execution time**: 25ms');
    });

    it('truncates long paths in display', async () => {
      const { queryWithFallback } = await import('../../../src/markov/query.js');
      (queryWithFallback as any).mockResolvedValueOnce({
        startSymbol: 'start',
        suggestions: [
          {
            symbolName: 'end',
            score: 0.3,
            depth: 5,
            path: ['start', 'a', 'b', 'c', 'end'],
            filePath: '/src/end.ts',
          },
        ],
        chainsUsed: ['call_flow'],
        executionTimeMs: 10,
      });

      const mockIndexer = createMockIndexer();

      const result = await runSuggestRelated(mockIndexer as any, {
        symbol_name: 'start',
        depth: 5,
      });

      // Long paths should be truncated to "start → ... → end"
      expect(result.content[0].text).toContain('start → ... → end');
    });

    it('shows short paths without truncation', async () => {
      const { queryWithFallback } = await import('../../../src/markov/query.js');
      (queryWithFallback as any).mockResolvedValueOnce({
        startSymbol: 'a',
        suggestions: [
          {
            symbolName: 'c',
            score: 0.5,
            depth: 2,
            path: ['a', 'b', 'c'],
            filePath: '/src/c.ts',
          },
        ],
        chainsUsed: ['call_flow'],
        executionTimeMs: 5,
      });

      const mockIndexer = createMockIndexer();

      const result = await runSuggestRelated(mockIndexer as any, {
        symbol_name: 'a',
      });

      expect(result.content[0].text).toContain('a → b → c');
    });

    it('shows file name from path', async () => {
      const { queryWithFallback } = await import('../../../src/markov/query.js');
      (queryWithFallback as any).mockResolvedValueOnce({
        startSymbol: 'test',
        suggestions: [
          {
            symbolName: 'related',
            score: 0.5,
            depth: 1,
            path: ['test', 'related'],
            filePath: '/very/long/path/to/file.ts',
          },
        ],
        chainsUsed: ['call_flow'],
        executionTimeMs: 5,
      });

      const mockIndexer = createMockIndexer();

      const result = await runSuggestRelated(mockIndexer as any, {
        symbol_name: 'test',
      });

      expect(result.content[0].text).toContain('file.ts');
    });

    it('shows dash when no file path', async () => {
      const { queryWithFallback } = await import('../../../src/markov/query.js');
      (queryWithFallback as any).mockResolvedValueOnce({
        startSymbol: 'test',
        suggestions: [
          {
            symbolName: 'related',
            score: 0.5,
            depth: 1,
            path: ['test', 'related'],
            filePath: undefined,
          },
        ],
        chainsUsed: ['call_flow'],
        executionTimeMs: 5,
      });

      const mockIndexer = createMockIndexer();

      const result = await runSuggestRelated(mockIndexer as any, {
        symbol_name: 'test',
      });

      expect(result.content[0].text).toMatch(/\| - \|/);
    });

    it('supports compact output format', async () => {
      const { queryWithFallback } = await import('../../../src/markov/query.js');
      (queryWithFallback as any).mockResolvedValueOnce({
        startSymbol: 'UserService',
        suggestions: [
          {
            symbolName: 'getUser',
            score: 0.85,
            depth: 1,
            path: ['UserService', 'getUser'],
            filePath: '/src/services/user.ts',
            explanation: 'should not appear in compact mode',
          },
        ],
        chainsUsed: ['call_flow'],
        executionTimeMs: 15,
      });

      const mockIndexer = createMockIndexer();
      const result = await runSuggestRelated(mockIndexer as any, {
        symbol_name: 'UserService',
        explain: true,
        format: 'compact',
      });

      const text = result.content[0].text;
      expect(text).toContain('symbol\tscore\tfile\tchain');
      expect(text).toContain('getUser');
      expect(text).not.toContain('Related Symbols for');
      expect(text).not.toContain('Explanations');
    });
  });

  describe('explanations', () => {
    it('shows explanations when explain is true', async () => {
      const { queryWithFallback } = await import('../../../src/markov/query.js');
      (queryWithFallback as any).mockResolvedValueOnce({
        startSymbol: 'func',
        suggestions: [
          {
            symbolName: 'related',
            score: 0.8,
            depth: 1,
            path: ['func', 'related'],
            filePath: '/src/file.ts',
            explanation: 'Called together in multiple files with high frequency',
          },
        ],
        chainsUsed: ['call_flow'],
        executionTimeMs: 10,
      });

      const mockIndexer = createMockIndexer();

      const result = await runSuggestRelated(mockIndexer as any, {
        symbol_name: 'func',
        explain: true,
      });

      expect(result.content[0].text).toContain('Explanations');
      expect(result.content[0].text).toContain('Called together in multiple files');
    });

    it('limits explanations to top 5', async () => {
      const { queryWithFallback } = await import('../../../src/markov/query.js');
      const suggestions = Array.from({ length: 10 }, (_, i) => ({
        symbolName: `related${i}`,
        score: 0.9 - i * 0.05,
        depth: 1,
        path: ['func', `related${i}`],
        filePath: `/src/file${i}.ts`,
        explanation: `Explanation for related${i}`,
      }));

      (queryWithFallback as any).mockResolvedValueOnce({
        startSymbol: 'func',
        suggestions,
        chainsUsed: ['call_flow'],
        executionTimeMs: 10,
      });

      const mockIndexer = createMockIndexer();

      const result = await runSuggestRelated(mockIndexer as any, {
        symbol_name: 'func',
        explain: true,
      });

      // Should only show first 5 explanations
      expect(result.content[0].text).toContain('related0');
      expect(result.content[0].text).toContain('related4');
      expect(result.content[0].text).not.toContain('Explanation for related5');
    });
  });

  describe('options', () => {
    it('passes chain_types to query', async () => {
      const { queryWithFallback } = await import('../../../src/markov/query.js');
      (queryWithFallback as any).mockResolvedValueOnce({
        startSymbol: 'test',
        suggestions: [],
        chainsUsed: ['type_affinity'],
        executionTimeMs: 5,
      });

      const mockIndexer = createMockIndexer();

      await runSuggestRelated(mockIndexer as any, {
        symbol_name: 'test',
        chain_types: ['type_affinity'],
      });

      expect(queryWithFallback).toHaveBeenCalledWith(
        expect.anything(),
        'test',
        undefined,
        expect.objectContaining({ chainTypes: ['type_affinity'] })
      );
    });

    it('passes depth to query', async () => {
      const { queryWithFallback } = await import('../../../src/markov/query.js');
      (queryWithFallback as any).mockResolvedValueOnce({
        startSymbol: 'test',
        suggestions: [],
        chainsUsed: [],
        executionTimeMs: 5,
      });

      const mockIndexer = createMockIndexer();

      await runSuggestRelated(mockIndexer as any, {
        symbol_name: 'test',
        depth: 4,
      });

      expect(queryWithFallback).toHaveBeenCalledWith(
        expect.anything(),
        'test',
        undefined,
        expect.objectContaining({ depth: 4 })
      );
    });

    it('passes min_probability to query', async () => {
      const { queryWithFallback } = await import('../../../src/markov/query.js');
      (queryWithFallback as any).mockResolvedValueOnce({
        startSymbol: 'test',
        suggestions: [],
        chainsUsed: [],
        executionTimeMs: 5,
      });

      const mockIndexer = createMockIndexer();

      await runSuggestRelated(mockIndexer as any, {
        symbol_name: 'test',
        min_probability: 0.1,
      });

      expect(queryWithFallback).toHaveBeenCalledWith(
        expect.anything(),
        'test',
        undefined,
        expect.objectContaining({ minProbability: 0.1 })
      );
    });

    it('passes limit to query', async () => {
      const { queryWithFallback } = await import('../../../src/markov/query.js');
      (queryWithFallback as any).mockResolvedValueOnce({
        startSymbol: 'test',
        suggestions: [],
        chainsUsed: [],
        executionTimeMs: 5,
      });

      const mockIndexer = createMockIndexer();

      await runSuggestRelated(mockIndexer as any, {
        symbol_name: 'test',
        limit: 50,
      });

      expect(queryWithFallback).toHaveBeenCalledWith(
        expect.anything(),
        'test',
        undefined,
        expect.objectContaining({ maxResults: 50 })
      );
    });

    it('passes file_path to query', async () => {
      const { queryWithFallback } = await import('../../../src/markov/query.js');
      (queryWithFallback as any).mockResolvedValueOnce({
        startSymbol: 'test',
        suggestions: [],
        chainsUsed: [],
        executionTimeMs: 5,
      });

      const mockIndexer = createMockIndexer();

      await runSuggestRelated(mockIndexer as any, {
        symbol_name: 'test',
        file_path: '/src/specific.ts',
      });

      expect(queryWithFallback).toHaveBeenCalledWith(
        expect.anything(),
        'test',
        '/src/specific.ts',
        expect.anything()
      );
    });

    it('uses default values when options not provided', async () => {
      const { queryWithFallback } = await import('../../../src/markov/query.js');
      (queryWithFallback as any).mockResolvedValueOnce({
        startSymbol: 'test',
        suggestions: [],
        chainsUsed: [],
        executionTimeMs: 5,
      });

      const mockIndexer = createMockIndexer();

      await runSuggestRelated(mockIndexer as any, {
        symbol_name: 'test',
      });

      expect(queryWithFallback).toHaveBeenCalledWith(
        expect.anything(),
        'test',
        undefined,
        expect.objectContaining({
          chainTypes: ['call_flow', 'cooccurrence'],
          depth: 2,
          minProbability: 0.05,
          maxResults: 20,
          explain: false,
        })
      );
    });
  });

  describe('output formatting', () => {
    it('includes tips about related tools', async () => {
      const { queryWithFallback } = await import('../../../src/markov/query.js');
      (queryWithFallback as any).mockResolvedValueOnce({
        startSymbol: 'test',
        suggestions: [
          {
            symbolName: 'related',
            score: 0.5,
            depth: 1,
            path: ['test', 'related'],
            filePath: '/src/test.ts',
          },
        ],
        chainsUsed: ['call_flow'],
        executionTimeMs: 5,
      });

      const mockIndexer = createMockIndexer();

      const result = await runSuggestRelated(mockIndexer as any, {
        symbol_name: 'test',
      });

      expect(result.content[0].text).toContain('get_function');
      expect(result.content[0].text).toContain('get_class');
    });
  });
});
