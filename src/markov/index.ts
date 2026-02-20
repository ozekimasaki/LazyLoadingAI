/**
 * Markov chain suggestion system for LazyLoadingAI
 * Provides intelligent code suggestions based on codebase patterns
 */

// Type exports
export type {
  ChainType,
  MarkovChainMeta,
  MarkovTransition,
  MarkovStateSum,
  MarkovQueryOptions,
  MarkovSuggestion,
  MarkovQueryResult,
  CallFlowChainConfig,
  CooccurrenceChainConfig,
  TypeAffinityChainConfig,
  ImportClusterChainConfig,
  MarkovChainStats,
  MarkovStats,
} from './types.js';

export {
  DEFAULT_CHAIN_WEIGHTS,
  DEFAULT_CALL_FLOW_CONFIG,
  DEFAULT_COOCCURRENCE_CONFIG,
  DEFAULT_TYPE_AFFINITY_CONFIG,
  DEFAULT_IMPORT_CLUSTER_CONFIG,
} from './types.js';

// Chain builders
export {
  buildCallFlowChain,
  buildCooccurrenceChain,
  buildTypeAffinityChain,
  buildImportClusterChain,
  buildAllChains,
} from './chains/index.js';

// Query engine
export {
  queryMarkovChains,
  queryByName,
  queryWithFallback,
} from './query.js';
