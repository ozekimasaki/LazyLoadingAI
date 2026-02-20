/**
 * Type definitions for the synonym mapping system
 */

/**
 * Relation type between synonyms
 */
export type SynonymRelation = 'exact' | 'abbreviation' | 'conceptual' | 'implementation';

/**
 * Category for organizing synonyms
 */
export type SynonymCategory = 'crud' | 'data' | 'patterns' | 'async' | 'errors' | 'domain' | 'http' | 'auth' | 'common';

/**
 * A single synonym with metadata
 */
export interface Synonym {
  term: string;
  relation: SynonymRelation;
  weight: number;  // 0.0 - 1.0
  bidirectional: boolean;
  languageHint?: 'typescript' | 'python';
}

/**
 * A canonical term with its synonyms
 */
export interface SynonymEntry {
  canonical: string;
  category: SynonymCategory;
  synonyms: Synonym[];
}

/**
 * Configuration for synonym expansion
 */
export interface SynonymConfig {
  enabled: boolean;
  useBuiltinSynonyms: boolean;
  customSynonyms: SynonymEntry[];
  overrides: Record<string, Synonym[]>;
  disabled: string[];  // Canonical terms to disable
  minWeightThreshold: number;
  maxExpansions: number;
}

/**
 * Default synonym configuration
 */
export const DEFAULT_SYNONYM_CONFIG: SynonymConfig = {
  enabled: true,
  useBuiltinSynonyms: true,
  customSynonyms: [],
  overrides: {},
  disabled: [],
  minWeightThreshold: 0.3,
  maxExpansions: 15,
};

/**
 * Result of expanding a query
 */
export interface ExpansionResult {
  original: string;
  expansions: Array<{
    term: string;
    weight: number;
    source: 'original' | 'canonical' | 'synonym';
    relation?: SynonymRelation;
  }>;
  ftsQuery: string;
}

/**
 * Scored search result after synonym-based ranking
 */
export interface ScoredResult<T> {
  item: T;
  originalScore: number;
  synonymScore: number;
  combinedScore: number;
  matchedTerms: Array<{
    term: string;
    weight: number;
    source: string;
  }>;
}
