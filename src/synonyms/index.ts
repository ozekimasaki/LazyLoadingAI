/**
 * Synonym mapping system for LazyLoadingAI
 * Provides query expansion and result scoring using a programming concept thesaurus
 */

// Type exports
export type {
  SynonymRelation,
  SynonymCategory,
  Synonym,
  SynonymEntry,
  SynonymConfig,
  ExpansionResult,
  ScoredResult,
} from './types.js';

export { DEFAULT_SYNONYM_CONFIG } from './types.js';

// Default synonyms
export { DEFAULT_SYNONYMS, getSynonymMap, findSynonymEntries } from './default-synonyms.js';

// Query expansion
export {
  expandQuery,
  getExpandedTerms,
  areSynonyms,
  getCanonical,
} from './expander.js';

// Result scoring
export type { ScoringOptions } from './scorer.js';
export {
  scoreResults,
  rerankResults,
  filterByExpansion,
  groupByMatchedTerm,
  explainRelevance,
} from './scorer.js';
