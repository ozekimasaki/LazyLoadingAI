/**
 * Markov chain query engine with n-hop traversal
 */

import type { SqliteStorage } from '../indexer/storage/sqlite.js';
import type {
  ChainType,
  MarkovQueryOptions,
  MarkovSuggestion,
  MarkovQueryResult,
} from './types.js';
import { DEFAULT_CHAIN_WEIGHTS } from './types.js';

const DEFAULT_QUERY_OPTIONS: Required<MarkovQueryOptions> = {
  chainTypes: ['call_flow', 'cooccurrence'],
  depth: 2,
  minProbability: 0.05,
  maxResults: 20,
  decayFactor: 0.7,
  explain: false,
};

/**
 * Redistribute weights when some chains have no support for start state
 */
function redistributeWeights(
  activeChains: ChainType[],
  defaultWeights: Record<ChainType, number>
): Record<ChainType, number> {
  const activeSum = activeChains.reduce((sum, c) => sum + defaultWeights[c], 0);
  const adjusted: Record<string, number> = {};

  for (const chain of activeChains) {
    adjusted[chain] = activeSum > 0 ? defaultWeights[chain] / activeSum : 0;
  }

  return adjusted as Record<ChainType, number>;
}

/**
 * Query the Markov chains for suggestions related to a start symbol
 */
export async function queryMarkovChains(
  storage: SqliteStorage,
  startStateId: string,
  options: MarkovQueryOptions = {}
): Promise<MarkovQueryResult> {
  const startTime = Date.now();
  const fullOptions: Required<MarkovQueryOptions> = { ...DEFAULT_QUERY_OPTIONS, ...options };

  // Resolve start state name
  const startSymbol = await storage.getSymbolById(startStateId);
  const startStateName = startSymbol?.name ?? startStateId;

  // Find which chains have support for this start state
  const activeChains: ChainType[] = [];
  for (const chainType of fullOptions.chainTypes) {
    const chainId = await storage.getChainId(chainType);
    if (chainId && await storage.hasChainSupport(chainId, startStateId)) {
      activeChains.push(chainType);
    }
  }

  if (activeChains.length === 0) {
    return {
      startSymbol: startStateName,
      suggestions: [],
      chainsUsed: [],
      queryOptions: fullOptions,
      executionTimeMs: Date.now() - startTime,
    };
  }

  const adjustedWeights = redistributeWeights(activeChains, DEFAULT_CHAIN_WEIGHTS);

  // Results map: stateId -> suggestion data
  const results = new Map<string, {
    symbolName: string;
    score: number;
    path: string[];
    depth: number;
    chainContributions: Record<ChainType, number>;
  }>();

  // Query each active chain
  for (const chainType of activeChains) {
    const chainId = await storage.getChainId(chainType);
    if (!chainId) continue;

    const chainWeight = adjustedWeights[chainType];

    // BFS with probability accumulation (Viterbi-style max-path scoring)
    const visited = new Map<string, { prob: number; path: string[] }>();
    const queue: Array<{
      stateId: string;
      stateName: string;
      prob: number;
      path: string[];
      hop: number;
    }> = [{
      stateId: startStateId,
      stateName: startStateName,
      prob: 1.0,
      path: [startStateName],
      hop: 0,
    }];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.hop >= fullOptions.depth) continue;

      const transitions = await storage.getTransitionsFrom(chainId, current.stateId);

      for (const trans of transitions) {
        // Linear decay - multiply by decayFactor once per hop
        const newProb = current.prob * trans.probability * fullOptions.decayFactor;

        if (newProb < fullOptions.minProbability) continue;

        const existing = visited.get(trans.toStateId);
        if (!existing || existing.prob < newProb) {
          // Keep only best path (Viterbi-style) for interpretability
          const newPath = [...current.path, trans.toStateName];
          visited.set(trans.toStateId, { prob: newProb, path: newPath });

          if (current.hop + 1 < fullOptions.depth) {
            queue.push({
              stateId: trans.toStateId,
              stateName: trans.toStateName,
              prob: newProb,
              path: newPath,
              hop: current.hop + 1,
            });
          }
        }
      }
    }

    // Merge into combined results
    for (const [stateId, { prob, path }] of visited.entries()) {
      if (stateId === startStateId) continue;  // Don't suggest the start state

      const weightedScore = prob * chainWeight;
      const existing = results.get(stateId);

      if (existing) {
        existing.score += weightedScore;
        existing.chainContributions[chainType] = prob;
        // Keep the shorter path
        if (path.length < existing.path.length) {
          existing.path = path;
          existing.depth = path.length - 1;
        }
      } else {
        results.set(stateId, {
          symbolName: path[path.length - 1] ?? stateId,
          score: weightedScore,
          path,
          depth: path.length - 1,
          chainContributions: { [chainType]: prob } as Record<ChainType, number>,
        });
      }
    }
  }

  // Convert to suggestions and sort by score
  const suggestions: MarkovSuggestion[] = [];
  for (const [symbolId, data] of results.entries()) {
    // Get file path for the symbol
    const symbolInfo = await storage.getSymbolById(symbolId);

    let explanation: string | undefined;
    if (fullOptions.explain) {
      const contribs = Object.entries(data.chainContributions)
        .map(([chain, prob]) => `${chain}: ${(prob * 100).toFixed(1)}%`)
        .join(', ');
      explanation = `Found via path: ${data.path.join(' → ')}\nChain contributions: ${contribs}`;
    }

    suggestions.push({
      symbolId,
      symbolName: data.symbolName,
      filePath: symbolInfo?.filePath,
      score: data.score,
      path: data.path,
      depth: data.depth,
      chainContributions: data.chainContributions,
      explanation,
    });
  }

  // Sort by score descending and limit
  suggestions.sort((a, b) => b.score - a.score);
  const limitedSuggestions = suggestions.slice(0, fullOptions.maxResults);

  return {
    startSymbol: startStateName,
    suggestions: limitedSuggestions,
    chainsUsed: activeChains,
    queryOptions: fullOptions,
    executionTimeMs: Date.now() - startTime,
  };
}

/**
 * Query by symbol name instead of ID
 */
export async function queryByName(
  storage: SqliteStorage,
  symbolName: string,
  filePath?: string,
  options: MarkovQueryOptions = {}
): Promise<MarkovQueryResult> {
  // Try to find the symbol by name
  const symbol = await storage.getSymbolByName(symbolName);

  if (!symbol) {
    return {
      startSymbol: symbolName,
      suggestions: [],
      chainsUsed: [],
      queryOptions: { ...DEFAULT_QUERY_OPTIONS, ...options },
      executionTimeMs: 0,
    };
  }

  return queryMarkovChains(storage, symbol.id, options);
}

/**
 * Query with fallback to direct references when Markov chains return empty.
 * This provides useful results even when the symbol isn't well-represented in chains.
 */
export async function queryWithFallback(
  storage: SqliteStorage,
  symbolName: string,
  filePath?: string,
  options: MarkovQueryOptions = {}
): Promise<MarkovQueryResult & { fallbackUsed?: boolean; fallbackType?: string }> {
  const startTime = Date.now();
  const fullOptions: Required<MarkovQueryOptions> = { ...DEFAULT_QUERY_OPTIONS, ...options };

  // First try the normal Markov query
  const markovResult = await queryByName(storage, symbolName, filePath, options);

  // If we got results, return them
  if (markovResult.suggestions.length > 0) {
    return { ...markovResult, fallbackUsed: false };
  }

  // Fallback: Use direct call graph and references
  const suggestions: MarkovSuggestion[] = [];
  let fallbackType = '';

  // Fallback 1: Get direct callers (who calls this function?)
  const callers = await storage.getCallersByName(symbolName);
  if (callers.length > 0) {
    fallbackType = 'callers';
    for (const caller of callers.slice(0, fullOptions.maxResults / 2)) {
      suggestions.push({
        symbolId: caller.callerSymbolId,
        symbolName: caller.callerName,
        filePath: undefined,  // CallGraphEdge doesn't have filePath
        score: 0.8,  // High score for direct callers
        path: [symbolName, caller.callerName],
        depth: 1,
        chainContributions: {} as Record<ChainType, number>,
        explanation: fullOptions.explain ? `Directly calls ${symbolName}` : undefined,
      });
    }
  }

  // Fallback 2: Get direct callees (what does this function call?)
  const callees = await storage.getCalleesByName(symbolName);
  if (callees.length > 0) {
    fallbackType = fallbackType ? `${fallbackType}+callees` : 'callees';
    for (const callee of callees.slice(0, fullOptions.maxResults / 2)) {
      // Avoid duplicates
      if (suggestions.some(s => s.symbolName === callee.calleeName)) continue;

      suggestions.push({
        symbolId: callee.calleeSymbolId ?? `callee:${callee.calleeName}`,
        symbolName: callee.calleeName,
        filePath: undefined,  // CallGraphEdge doesn't have filePath
        score: 0.7,  // Slightly lower score for callees
        path: [symbolName, callee.calleeName],
        depth: 1,
        chainContributions: {} as Record<ChainType, number>,
        explanation: fullOptions.explain ? `Called by ${symbolName}` : undefined,
      });
    }
  }

  // Fallback 3: Get symbols in the same file (co-located symbols are often related)
  const symbol = await storage.getSymbolByName(symbolName);
  if (symbol && suggestions.length < fullOptions.maxResults) {
    const fileRefs = await storage.getReferencesInFile(symbol.filePath);
    fallbackType = fallbackType ? `${fallbackType}+colocated` : 'colocated';

    // Get unique referenced symbols from the same file
    const seenNames = new Set(suggestions.map(s => s.symbolName));
    seenNames.add(symbolName);

    for (const ref of fileRefs) {
      // SymbolReference uses symbolName for the referenced symbol
      if (seenNames.has(ref.symbolName)) continue;
      if (suggestions.length >= fullOptions.maxResults) break;

      seenNames.add(ref.symbolName);
      suggestions.push({
        symbolId: ref.symbolId || `ref:${ref.symbolName}`,
        symbolName: ref.symbolName,
        filePath: symbol.filePath,
        score: 0.5,  // Lower score for co-located
        path: [symbolName, ref.symbolName],
        depth: 1,
        chainContributions: {} as Record<ChainType, number>,
        explanation: fullOptions.explain ? `Co-located in ${symbol.filePath}` : undefined,
      });
    }
  }

  // Sort by score
  suggestions.sort((a, b) => b.score - a.score);

  return {
    startSymbol: symbolName,
    suggestions: suggestions.slice(0, fullOptions.maxResults),
    chainsUsed: [],
    queryOptions: fullOptions,
    executionTimeMs: Date.now() - startTime,
    fallbackUsed: suggestions.length > 0,
    fallbackType: fallbackType || undefined,
  };
}
