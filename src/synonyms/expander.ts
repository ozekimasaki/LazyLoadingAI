/**
 * Query expansion using synonym mappings
 */

import type { SynonymConfig, ExpansionResult, SynonymEntry } from './types.js';
import { DEFAULT_SYNONYM_CONFIG } from './types.js';
import { DEFAULT_SYNONYMS, findSynonymEntries } from './default-synonyms.js';

/**
 * Tokenize a query string into individual terms
 */
function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[_-]/g, ' ')  // Replace underscores and hyphens with spaces
    .replace(/([a-z])([A-Z])/g, '$1 $2')  // Split camelCase
    .split(/\s+/)
    .filter(term => term.length > 1);  // Filter out single characters
}

/**
 * Build the effective synonym database based on configuration
 */
function buildSynonymDatabase(config: SynonymConfig): SynonymEntry[] {
  let database: SynonymEntry[] = [];

  // Start with builtin synonyms if enabled
  if (config.useBuiltinSynonyms) {
    database = [...DEFAULT_SYNONYMS];
  }

  // Add custom synonyms
  for (const custom of config.customSynonyms) {
    // Check if it's overriding an existing canonical
    const existingIndex = database.findIndex(e => e.canonical === custom.canonical);
    if (existingIndex >= 0) {
      // Merge synonyms
      const existing = database[existingIndex];
      if (existing) {
        const mergedSynonyms = [...existing.synonyms];
        for (const syn of custom.synonyms) {
          const existingSynIndex = mergedSynonyms.findIndex(s => s.term === syn.term);
          if (existingSynIndex >= 0) {
            mergedSynonyms[existingSynIndex] = syn;  // Override
          } else {
            mergedSynonyms.push(syn);
          }
        }
        database[existingIndex] = {
          canonical: existing.canonical,
          category: existing.category,
          synonyms: mergedSynonyms,
        };
      }
    } else {
      database.push(custom);
    }
  }

  // Apply overrides
  for (const [canonical, synonyms] of Object.entries(config.overrides)) {
    const entry = database.find(e => e.canonical === canonical);
    if (entry) {
      entry.synonyms = synonyms;
    }
  }

  // Remove disabled entries
  database = database.filter(e => !config.disabled.includes(e.canonical));

  return database;
}

/**
 * Expand a single term using the synonym database
 */
function expandTerm(
  term: string,
  database: SynonymEntry[],
  config: SynonymConfig
): Array<{ term: string; weight: number; source: 'original' | 'canonical' | 'synonym'; relation?: import('./types.js').SynonymRelation }> {
  const expansions: Map<string, { weight: number; source: 'original' | 'canonical' | 'synonym'; relation?: import('./types.js').SynonymRelation }> = new Map();

  // Always include original with weight 1.0
  expansions.set(term.toLowerCase(), { weight: 1.0, source: 'original' });

  const normalizedTerm = term.toLowerCase();

  // Find matching entries
  for (const entry of database) {
    let matched = false;
    let matchWeight = 1.0;

    // Check if term matches canonical
    if (entry.canonical.toLowerCase() === normalizedTerm) {
      matched = true;
    }

    // Check if term matches any synonym
    if (!matched) {
      for (const syn of entry.synonyms) {
        if (syn.term.toLowerCase() === normalizedTerm && syn.bidirectional) {
          matched = true;
          matchWeight = syn.weight;
          break;
        }
      }
    }

    if (matched) {
      // Add canonical (if different from term)
      if (entry.canonical.toLowerCase() !== normalizedTerm) {
        const existingCanonical = expansions.get(entry.canonical.toLowerCase());
        if (!existingCanonical || existingCanonical.weight < 0.9 * matchWeight) {
          expansions.set(entry.canonical.toLowerCase(), {
            weight: 0.9 * matchWeight,
            source: 'canonical',
          });
        }
      }

      // Add all synonyms that meet threshold
      for (const syn of entry.synonyms) {
        if (syn.weight >= config.minWeightThreshold) {
          const effectiveWeight = syn.weight * matchWeight;
          const existing = expansions.get(syn.term.toLowerCase());
          if (!existing || existing.weight < effectiveWeight) {
            expansions.set(syn.term.toLowerCase(), {
              weight: effectiveWeight,
              source: 'synonym',
              relation: syn.relation,
            });
          }
        }
      }
    }
  }

  return Array.from(expansions.entries()).map(([t, data]) => ({ term: t, ...data }));
}

/**
 * Build an FTS5 query string from expansions
 */
function buildFtsQuery(expansions: Array<{ term: string; weight: number }>): string {
  // Sort by weight descending
  const sorted = [...expansions].sort((a, b) => b.weight - a.weight);

  // Build OR query with prefix matching
  const terms = sorted.map(e => `${e.term}*`);
  return terms.join(' OR ');
}

/**
 * Expand a query using synonym mappings
 */
export function expandQuery(
  query: string,
  config: Partial<SynonymConfig> = {}
): ExpansionResult {
  const fullConfig: SynonymConfig = { ...DEFAULT_SYNONYM_CONFIG, ...config };

  if (!fullConfig.enabled) {
    return {
      original: query,
      expansions: [{ term: query.toLowerCase(), weight: 1.0, source: 'original' }],
      ftsQuery: `${query.toLowerCase()}*`,
    };
  }

  const database = buildSynonymDatabase(fullConfig);
  const terms = tokenize(query);

  // Collect all expansions from all terms
  const allExpansions: Map<string, { weight: number; source: 'original' | 'canonical' | 'synonym'; relation?: import('./types.js').SynonymRelation }> = new Map();

  for (const term of terms) {
    const termExpansions = expandTerm(term, database, fullConfig);
    for (const exp of termExpansions) {
      const existing = allExpansions.get(exp.term);
      if (!existing || existing.weight < exp.weight) {
        allExpansions.set(exp.term, {
          weight: exp.weight,
          source: exp.source,
          relation: exp.relation,
        });
      }
    }
  }

  // Also add the original query as a phrase if multi-word
  if (terms.length > 1) {
    const phrase = query.toLowerCase().replace(/[_-]/g, '');
    if (!allExpansions.has(phrase)) {
      allExpansions.set(phrase, { weight: 1.0, source: 'original' });
    }
  }

  // Convert to array and apply max expansions limit
  let expansionArray = Array.from(allExpansions.entries())
    .map(([term, data]) => ({ term, ...data }))
    .sort((a, b) => b.weight - a.weight);

  if (expansionArray.length > fullConfig.maxExpansions) {
    expansionArray = expansionArray.slice(0, fullConfig.maxExpansions);
  }

  return {
    original: query,
    expansions: expansionArray,
    ftsQuery: buildFtsQuery(expansionArray),
  };
}

/**
 * Get a simple list of expanded terms for a query
 */
export function getExpandedTerms(
  query: string,
  config: Partial<SynonymConfig> = {}
): string[] {
  const result = expandQuery(query, config);
  return result.expansions.map(e => e.term);
}

/**
 * Check if two terms are synonyms
 */
export function areSynonyms(term1: string, term2: string): boolean {
  const normalized1 = term1.toLowerCase();
  const normalized2 = term2.toLowerCase();

  if (normalized1 === normalized2) return true;

  const entries1 = findSynonymEntries(term1);
  for (const entry of entries1) {
    if (entry.canonical.toLowerCase() === normalized2) return true;
    for (const syn of entry.synonyms) {
      if (syn.term.toLowerCase() === normalized2) return true;
    }
  }

  return false;
}

/**
 * Get the canonical form of a term if it exists
 */
export function getCanonical(term: string): string | null {
  const entries = findSynonymEntries(term);
  const first = entries[0];
  if (first) {
    return first.canonical;
  }
  return null;
}
