/**
 * Type definitions for the Markov chain suggestion system
 */

/**
 * Types of Markov chains supported
 */
export type ChainType = 'call_flow' | 'cooccurrence' | 'type_affinity' | 'import_cluster';

/**
 * Metadata for a Markov chain
 */
export interface MarkovChainMeta {
  id: string;
  chainType: ChainType;
  createdAt: number;
  updatedAt: number;
  totalStates: number;
  totalTransitions: number;
  config: Record<string, unknown>;
}

/**
 * A single transition in the Markov chain
 */
export interface MarkovTransition {
  id: number;
  chainId: string;
  fromStateId: string;
  fromStateName: string;
  toStateId: string;
  toStateName: string;
  rawCount: number;
  probability: number;
  metadata?: {
    isAsync?: boolean;
    scope?: string;
    distance?: number;
    [key: string]: unknown;
  };
}

/**
 * State normalization data for incremental updates
 */
export interface MarkovStateSum {
  chainId: string;
  stateId: string;
  rawSum: number;
  transitionCount: number;
}

/**
 * Query options for Markov chain traversal
 */
export interface MarkovQueryOptions {
  chainTypes?: ChainType[];
  depth?: number;  // 1-5, default 2
  minProbability?: number;  // default 0.05
  maxResults?: number;  // default 20
  decayFactor?: number;  // default 0.7 (linear decay per hop)
  explain?: boolean;  // Include explanation of why each was suggested
}

/**
 * Default chain weights for combining results
 */
export const DEFAULT_CHAIN_WEIGHTS: Record<ChainType, number> = {
  call_flow: 0.4,
  cooccurrence: 0.25,
  type_affinity: 0.2,
  import_cluster: 0.15,
};

/**
 * A suggestion from the Markov chain query
 */
export interface MarkovSuggestion {
  symbolId: string;
  symbolName: string;
  filePath?: string;
  score: number;  // Combined score (not strict probability)
  path: string[];  // Path from start state to this suggestion
  depth: number;
  chainContributions: Record<ChainType, number>;
  explanation?: string;
}

/**
 * Result of a Markov chain query
 */
export interface MarkovQueryResult {
  startSymbol: string;
  suggestions: MarkovSuggestion[];
  chainsUsed: ChainType[];
  queryOptions: MarkovQueryOptions;
  executionTimeMs: number;
}

/**
 * Configuration for building a call flow chain
 */
export interface CallFlowChainConfig {
  /** Use geometric mean for co-caller weights */
  useGeometricMean: boolean;
  /** Apply fanout normalization */
  fanoutNormalization: boolean;
  /** Async call bonus */
  asyncBonus: number;
  /** Conditional call penalty */
  conditionalPenalty: number;
  /** Minimum call count to include */
  minCallCount: number;
}

export const DEFAULT_CALL_FLOW_CONFIG: CallFlowChainConfig = {
  useGeometricMean: true,
  fanoutNormalization: true,
  asyncBonus: 0.1,
  conditionalPenalty: 0.2,
  minCallCount: 1,
};

/**
 * Configuration for building a co-occurrence chain
 */
export interface CooccurrenceChainConfig {
  /** Weight for symbols in same function body */
  sameFunctionWeight: number;
  /** Weight for symbols in same class */
  sameClassWeight: number;
  /** Weight for symbols in same file */
  sameFileWeight: number;
  /** Apply IDF weighting */
  useIdfWeighting: boolean;
}

export const DEFAULT_COOCCURRENCE_CONFIG: CooccurrenceChainConfig = {
  sameFunctionWeight: 3.0,
  sameClassWeight: 2.0,
  sameFileWeight: 1.0,
  useIdfWeighting: true,
};

/**
 * Configuration for building a type affinity chain
 */
export interface TypeAffinityChainConfig {
  /** Weight for extends relationship */
  extendsWeight: number;
  /** Weight for implements relationship */
  implementsWeight: number;
  /** Weight for mixin relationship */
  mixinWeight: number;
  /** Include method type relationships */
  includeMethodTypes: boolean;
}

export const DEFAULT_TYPE_AFFINITY_CONFIG: TypeAffinityChainConfig = {
  extendsWeight: 1.0,
  implementsWeight: 0.9,
  mixinWeight: 0.7,
  includeMethodTypes: true,
};

/**
 * Configuration for building an import cluster chain
 */
export interface ImportClusterChainConfig {
  /** Weight for direct imports */
  directImportWeight: number;
  /** Weight for shared import sources */
  sharedSourceWeight: number;
  /** Minimum shared imports to consider related */
  minSharedImports: number;
}

export const DEFAULT_IMPORT_CLUSTER_CONFIG: ImportClusterChainConfig = {
  directImportWeight: 1.0,
  sharedSourceWeight: 0.5,
  minSharedImports: 2,
};

/**
 * Statistics for a Markov chain
 */
export interface MarkovChainStats {
  chainType: ChainType;
  totalStates: number;
  totalTransitions: number;
  avgTransitionsPerState: number;
  maxTransitionsPerState: number;
  createdAt: Date;
  updatedAt: Date;
  topStates: Array<{
    stateId: string;
    stateName: string;
    outgoingCount: number;
  }>;
}

/**
 * Overall Markov system statistics
 */
export interface MarkovStats {
  chains: MarkovChainStats[];
  totalChains: number;
  totalTransitions: number;
  lastRebuildAt: Date | null;
}
