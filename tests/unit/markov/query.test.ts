/**
 * Unit tests for markov query module
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queryMarkovChains, queryByName } from '../../../src/markov/query.js';

// Create a mock storage
function createMockStorage(options: {
  symbol?: { id: string; name: string; filePath?: string } | null;
  symbolById?: Map<string, { id: string; name: string; filePath?: string }>;
  chainIds?: Map<string, string>;
  chainSupport?: Map<string, Set<string>>;
  transitions?: Map<string, Array<{ toStateId: string; toStateName: string; probability: number }>>;
} = {}) {
  const symbolById = options.symbolById ?? new Map();
  const chainIds = options.chainIds ?? new Map();
  const chainSupport = options.chainSupport ?? new Map();
  const transitions = options.transitions ?? new Map();

  return {
    getSymbolByName: vi.fn().mockResolvedValue(options.symbol ?? null),
    getSymbolById: vi.fn().mockImplementation((id: string) => {
      return Promise.resolve(symbolById.get(id) ?? null);
    }),
    getChainId: vi.fn().mockImplementation((chainType: string) => {
      return Promise.resolve(chainIds.get(chainType) ?? null);
    }),
    hasChainSupport: vi.fn().mockImplementation((chainId: string, stateId: string) => {
      const support = chainSupport.get(chainId);
      return Promise.resolve(support?.has(stateId) ?? false);
    }),
    getTransitionsFrom: vi.fn().mockImplementation((chainId: string, stateId: string) => {
      const key = `${chainId}:${stateId}`;
      return Promise.resolve(transitions.get(key) ?? []);
    }),
  };
}

describe('queryByName', () => {
  it('returns empty result when symbol not found', async () => {
    const storage = createMockStorage({ symbol: null });

    const result = await queryByName(storage as any, 'unknownSymbol');

    expect(result.startSymbol).toBe('unknownSymbol');
    expect(result.suggestions).toHaveLength(0);
    expect(result.chainsUsed).toHaveLength(0);
    expect(result.executionTimeMs).toBe(0);
  });

  it('queries chains when symbol is found', async () => {
    const storage = createMockStorage({
      symbol: { id: 'sym-1', name: 'testFunc' },
      symbolById: new Map([['sym-1', { id: 'sym-1', name: 'testFunc' }]]),
      chainIds: new Map([['call_flow', 'chain-cf']]),
      chainSupport: new Map([['chain-cf', new Set(['sym-1'])]]),
      transitions: new Map(),
    });

    const result = await queryByName(storage as any, 'testFunc');

    expect(storage.getSymbolByName).toHaveBeenCalledWith('testFunc');
    expect(result.startSymbol).toBe('testFunc');
  });

  it('passes filePath to query when provided', async () => {
    const storage = createMockStorage({
      symbol: { id: 'sym-1', name: 'testFunc', filePath: '/src/test.ts' },
    });

    await queryByName(storage as any, 'testFunc', '/src/test.ts');

    expect(storage.getSymbolByName).toHaveBeenCalledWith('testFunc');
  });
});

describe('queryMarkovChains', () => {
  describe('no chain support', () => {
    it('returns empty result when no chains have support', async () => {
      const storage = createMockStorage({
        symbolById: new Map([['sym-1', { id: 'sym-1', name: 'startFunc' }]]),
        chainIds: new Map([['call_flow', 'chain-cf']]),
        chainSupport: new Map(), // No support for any state
      });

      const result = await queryMarkovChains(storage as any, 'sym-1');

      expect(result.startSymbol).toBe('startFunc');
      expect(result.suggestions).toHaveLength(0);
      expect(result.chainsUsed).toHaveLength(0);
    });

    it('uses stateId as name when symbol not found', async () => {
      const storage = createMockStorage({
        chainIds: new Map([['call_flow', 'chain-cf']]),
        chainSupport: new Map(),
      });

      const result = await queryMarkovChains(storage as any, 'unknown-id');

      expect(result.startSymbol).toBe('unknown-id');
    });
  });

  describe('with transitions', () => {
    it('finds related symbols through transitions', async () => {
      const storage = createMockStorage({
        symbolById: new Map([
          ['sym-1', { id: 'sym-1', name: 'startFunc' }],
          ['sym-2', { id: 'sym-2', name: 'relatedFunc', filePath: '/src/related.ts' }],
        ]),
        chainIds: new Map([['call_flow', 'chain-cf']]),
        chainSupport: new Map([['chain-cf', new Set(['sym-1'])]]),
        transitions: new Map([
          ['chain-cf:sym-1', [
            { toStateId: 'sym-2', toStateName: 'relatedFunc', probability: 0.8 },
          ]],
        ]),
      });

      const result = await queryMarkovChains(storage as any, 'sym-1', {
        chainTypes: ['call_flow'],
        depth: 2,
      });

      expect(result.chainsUsed).toContain('call_flow');
      expect(result.suggestions).toHaveLength(1);
      expect(result.suggestions[0].symbolName).toBe('relatedFunc');
      expect(result.suggestions[0].score).toBeGreaterThan(0);
    });

    it('excludes start state from suggestions', async () => {
      const storage = createMockStorage({
        symbolById: new Map([
          ['sym-1', { id: 'sym-1', name: 'startFunc' }],
        ]),
        chainIds: new Map([['call_flow', 'chain-cf']]),
        chainSupport: new Map([['chain-cf', new Set(['sym-1'])]]),
        transitions: new Map([
          ['chain-cf:sym-1', [
            { toStateId: 'sym-1', toStateName: 'startFunc', probability: 0.5 }, // Self-loop
          ]],
        ]),
      });

      const result = await queryMarkovChains(storage as any, 'sym-1', {
        chainTypes: ['call_flow'],
        depth: 2,
      });

      // Should not suggest the start state itself
      const selfSuggestion = result.suggestions.find(s => s.symbolId === 'sym-1');
      expect(selfSuggestion).toBeUndefined();
    });

    it('respects minProbability threshold', async () => {
      const storage = createMockStorage({
        symbolById: new Map([
          ['sym-1', { id: 'sym-1', name: 'startFunc' }],
          ['sym-2', { id: 'sym-2', name: 'highProb' }],
          ['sym-3', { id: 'sym-3', name: 'lowProb' }],
        ]),
        chainIds: new Map([['call_flow', 'chain-cf']]),
        chainSupport: new Map([['chain-cf', new Set(['sym-1'])]]),
        transitions: new Map([
          ['chain-cf:sym-1', [
            { toStateId: 'sym-2', toStateName: 'highProb', probability: 0.8 },
            { toStateId: 'sym-3', toStateName: 'lowProb', probability: 0.001 }, // Below threshold
          ]],
        ]),
      });

      const result = await queryMarkovChains(storage as any, 'sym-1', {
        chainTypes: ['call_flow'],
        depth: 2,
        minProbability: 0.05,
      });

      expect(result.suggestions.some(s => s.symbolName === 'highProb')).toBe(true);
      expect(result.suggestions.some(s => s.symbolName === 'lowProb')).toBe(false);
    });

    it('limits results with maxResults', async () => {
      const storage = createMockStorage({
        symbolById: new Map([
          ['sym-1', { id: 'sym-1', name: 'startFunc' }],
          ...Array.from({ length: 10 }, (_, i) => [
            `sym-${i + 2}`,
            { id: `sym-${i + 2}`, name: `func${i + 2}` },
          ] as const),
        ]),
        chainIds: new Map([['call_flow', 'chain-cf']]),
        chainSupport: new Map([['chain-cf', new Set(['sym-1'])]]),
        transitions: new Map([
          ['chain-cf:sym-1', Array.from({ length: 10 }, (_, i) => ({
            toStateId: `sym-${i + 2}`,
            toStateName: `func${i + 2}`,
            probability: 0.5,
          }))],
        ]),
      });

      const result = await queryMarkovChains(storage as any, 'sym-1', {
        chainTypes: ['call_flow'],
        depth: 2,
        maxResults: 5,
      });

      expect(result.suggestions.length).toBeLessThanOrEqual(5);
    });

    it('respects depth limit', async () => {
      const storage = createMockStorage({
        symbolById: new Map([
          ['sym-1', { id: 'sym-1', name: 'start' }],
          ['sym-2', { id: 'sym-2', name: 'hop1' }],
          ['sym-3', { id: 'sym-3', name: 'hop2' }],
        ]),
        chainIds: new Map([['call_flow', 'chain-cf']]),
        chainSupport: new Map([['chain-cf', new Set(['sym-1'])]]),
        transitions: new Map([
          ['chain-cf:sym-1', [{ toStateId: 'sym-2', toStateName: 'hop1', probability: 0.8 }]],
          ['chain-cf:sym-2', [{ toStateId: 'sym-3', toStateName: 'hop2', probability: 0.8 }]],
        ]),
      });

      const result = await queryMarkovChains(storage as any, 'sym-1', {
        chainTypes: ['call_flow'],
        depth: 1, // Only 1 hop
      });

      // Should only find sym-2 (1 hop), not sym-3 (2 hops)
      expect(result.suggestions.some(s => s.symbolName === 'hop1')).toBe(true);
      expect(result.suggestions.some(s => s.symbolName === 'hop2')).toBe(false);
    });

    it('includes execution time', async () => {
      const storage = createMockStorage({
        symbolById: new Map([['sym-1', { id: 'sym-1', name: 'start' }]]),
        chainIds: new Map([['call_flow', 'chain-cf']]),
        chainSupport: new Map([['chain-cf', new Set(['sym-1'])]]),
        transitions: new Map(),
      });

      const result = await queryMarkovChains(storage as any, 'sym-1');

      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('explanation', () => {
    it('includes explanation when explain option is true', async () => {
      const storage = createMockStorage({
        symbolById: new Map([
          ['sym-1', { id: 'sym-1', name: 'startFunc' }],
          ['sym-2', { id: 'sym-2', name: 'relatedFunc', filePath: '/src/related.ts' }],
        ]),
        chainIds: new Map([['call_flow', 'chain-cf']]),
        chainSupport: new Map([['chain-cf', new Set(['sym-1'])]]),
        transitions: new Map([
          ['chain-cf:sym-1', [
            { toStateId: 'sym-2', toStateName: 'relatedFunc', probability: 0.8 },
          ]],
        ]),
      });

      const result = await queryMarkovChains(storage as any, 'sym-1', {
        chainTypes: ['call_flow'],
        depth: 2,
        explain: true,
      });

      expect(result.suggestions[0].explanation).toBeDefined();
      expect(result.suggestions[0].explanation).toContain('startFunc');
      expect(result.suggestions[0].explanation).toContain('relatedFunc');
      expect(result.suggestions[0].explanation).toContain('call_flow');
    });

    it('does not include explanation when explain is false', async () => {
      const storage = createMockStorage({
        symbolById: new Map([
          ['sym-1', { id: 'sym-1', name: 'startFunc' }],
          ['sym-2', { id: 'sym-2', name: 'relatedFunc' }],
        ]),
        chainIds: new Map([['call_flow', 'chain-cf']]),
        chainSupport: new Map([['chain-cf', new Set(['sym-1'])]]),
        transitions: new Map([
          ['chain-cf:sym-1', [
            { toStateId: 'sym-2', toStateName: 'relatedFunc', probability: 0.8 },
          ]],
        ]),
      });

      const result = await queryMarkovChains(storage as any, 'sym-1', {
        chainTypes: ['call_flow'],
        depth: 2,
        explain: false,
      });

      expect(result.suggestions[0].explanation).toBeUndefined();
    });
  });

  describe('multiple chains', () => {
    it('combines scores from multiple chains', async () => {
      const storage = createMockStorage({
        symbolById: new Map([
          ['sym-1', { id: 'sym-1', name: 'startFunc' }],
          ['sym-2', { id: 'sym-2', name: 'relatedFunc' }],
        ]),
        chainIds: new Map([
          ['call_flow', 'chain-cf'],
          ['cooccurrence', 'chain-co'],
        ]),
        chainSupport: new Map([
          ['chain-cf', new Set(['sym-1'])],
          ['chain-co', new Set(['sym-1'])],
        ]),
        transitions: new Map([
          ['chain-cf:sym-1', [
            { toStateId: 'sym-2', toStateName: 'relatedFunc', probability: 0.6 },
          ]],
          ['chain-co:sym-1', [
            { toStateId: 'sym-2', toStateName: 'relatedFunc', probability: 0.4 },
          ]],
        ]),
      });

      const result = await queryMarkovChains(storage as any, 'sym-1', {
        chainTypes: ['call_flow', 'cooccurrence'],
        depth: 2,
      });

      expect(result.chainsUsed).toContain('call_flow');
      expect(result.chainsUsed).toContain('cooccurrence');
      expect(result.suggestions[0].chainContributions).toBeDefined();
      expect(result.suggestions[0].chainContributions.call_flow).toBeGreaterThan(0);
      expect(result.suggestions[0].chainContributions.cooccurrence).toBeGreaterThan(0);
    });

    it('only uses chains with support for start state', async () => {
      const storage = createMockStorage({
        symbolById: new Map([
          ['sym-1', { id: 'sym-1', name: 'startFunc' }],
          ['sym-2', { id: 'sym-2', name: 'relatedFunc' }],
        ]),
        chainIds: new Map([
          ['call_flow', 'chain-cf'],
          ['cooccurrence', 'chain-co'],
        ]),
        chainSupport: new Map([
          ['chain-cf', new Set(['sym-1'])], // Has support
          ['chain-co', new Set()], // No support for sym-1
        ]),
        transitions: new Map([
          ['chain-cf:sym-1', [
            { toStateId: 'sym-2', toStateName: 'relatedFunc', probability: 0.8 },
          ]],
        ]),
      });

      const result = await queryMarkovChains(storage as any, 'sym-1', {
        chainTypes: ['call_flow', 'cooccurrence'],
        depth: 2,
      });

      expect(result.chainsUsed).toContain('call_flow');
      expect(result.chainsUsed).not.toContain('cooccurrence');
    });
  });

  describe('path tracking', () => {
    it('tracks path through transitions', async () => {
      const storage = createMockStorage({
        symbolById: new Map([
          ['sym-1', { id: 'sym-1', name: 'start' }],
          ['sym-2', { id: 'sym-2', name: 'middle' }],
          ['sym-3', { id: 'sym-3', name: 'end' }],
        ]),
        chainIds: new Map([['call_flow', 'chain-cf']]),
        chainSupport: new Map([['chain-cf', new Set(['sym-1'])]]),
        transitions: new Map([
          ['chain-cf:sym-1', [{ toStateId: 'sym-2', toStateName: 'middle', probability: 0.8 }]],
          ['chain-cf:sym-2', [{ toStateId: 'sym-3', toStateName: 'end', probability: 0.7 }]],
        ]),
      });

      const result = await queryMarkovChains(storage as any, 'sym-1', {
        chainTypes: ['call_flow'],
        depth: 3,
      });

      const endSuggestion = result.suggestions.find(s => s.symbolName === 'end');
      expect(endSuggestion).toBeDefined();
      expect(endSuggestion?.path).toEqual(['start', 'middle', 'end']);
      expect(endSuggestion?.depth).toBe(2);
    });

    it('keeps shorter path when same symbol reached via multiple paths', async () => {
      const storage = createMockStorage({
        symbolById: new Map([
          ['sym-1', { id: 'sym-1', name: 'start' }],
          ['sym-2', { id: 'sym-2', name: 'shortcut' }],
          ['sym-3', { id: 'sym-3', name: 'target' }],
        ]),
        chainIds: new Map([['call_flow', 'chain-cf']]),
        chainSupport: new Map([['chain-cf', new Set(['sym-1'])]]),
        transitions: new Map([
          ['chain-cf:sym-1', [
            { toStateId: 'sym-3', toStateName: 'target', probability: 0.9 }, // Direct path (higher prob)
            { toStateId: 'sym-2', toStateName: 'shortcut', probability: 0.5 },
          ]],
          ['chain-cf:sym-2', [
            { toStateId: 'sym-3', toStateName: 'target', probability: 0.3 }, // Indirect path
          ]],
        ]),
      });

      const result = await queryMarkovChains(storage as any, 'sym-1', {
        chainTypes: ['call_flow'],
        depth: 3,
      });

      const targetSuggestion = result.suggestions.find(s => s.symbolName === 'target');
      expect(targetSuggestion).toBeDefined();
      // Should keep the shorter path
      expect(targetSuggestion?.path.length).toBeLessThanOrEqual(2);
    });
  });

  describe('sorting', () => {
    it('sorts suggestions by score descending', async () => {
      const storage = createMockStorage({
        symbolById: new Map([
          ['sym-1', { id: 'sym-1', name: 'start' }],
          ['sym-2', { id: 'sym-2', name: 'lowScore' }],
          ['sym-3', { id: 'sym-3', name: 'highScore' }],
        ]),
        chainIds: new Map([['call_flow', 'chain-cf']]),
        chainSupport: new Map([['chain-cf', new Set(['sym-1'])]]),
        transitions: new Map([
          ['chain-cf:sym-1', [
            { toStateId: 'sym-2', toStateName: 'lowScore', probability: 0.2 },
            { toStateId: 'sym-3', toStateName: 'highScore', probability: 0.9 },
          ]],
        ]),
      });

      const result = await queryMarkovChains(storage as any, 'sym-1', {
        chainTypes: ['call_flow'],
        depth: 2,
      });

      expect(result.suggestions[0].symbolName).toBe('highScore');
      expect(result.suggestions[1].symbolName).toBe('lowScore');
    });
  });
});
