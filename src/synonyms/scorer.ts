/**
 * Result scoring and ranking with synonym-based weighting
 */

import type { ScoredResult, ExpansionResult } from './types.js';

/**
 * Options for scoring results
 */
export interface ScoringOptions {
  /** Weight given to original search score (0-1) */
  originalScoreWeight: number;
  /** Weight given to synonym match score (0-1) */
  synonymScoreWeight: number;
  /** Bonus for exact matches */
  exactMatchBonus: number;
  /** Bonus for matching the canonical term */
  canonicalMatchBonus: number;
  /** Whether to boost results that match multiple expanded terms */
  multiMatchBoost: boolean;
}

const DEFAULT_SCORING_OPTIONS: ScoringOptions = {
  originalScoreWeight: 0.6,
  synonymScoreWeight: 0.4,
  exactMatchBonus: 0.2,
  canonicalMatchBonus: 0.1,
  multiMatchBoost: true,
};

/**
 * Calculate synonym-based score for a result
 */
function calculateSynonymScore<T>(
  item: T,
  expansion: ExpansionResult,
  getSearchableText: (item: T) => string,
  options: ScoringOptions
): { score: number; matchedTerms: Array<{ term: string; weight: number; source: string }> } {
  const text = getSearchableText(item).toLowerCase();
  const matchedTerms: Array<{ term: string; weight: number; source: string }> = [];
  let totalScore = 0;
  let matchCount = 0;

  for (const exp of expansion.expansions) {
    // Check if this expansion term appears in the item text
    if (text.includes(exp.term)) {
      matchedTerms.push({
        term: exp.term,
        weight: exp.weight,
        source: exp.source,
      });

      let termScore = exp.weight;

      // Apply bonuses
      if (exp.source === 'original') {
        termScore += options.exactMatchBonus;
      } else if (exp.source === 'canonical') {
        termScore += options.canonicalMatchBonus;
      }

      totalScore += termScore;
      matchCount++;
    }
  }

  // Apply multi-match boost
  if (options.multiMatchBoost && matchCount > 1) {
    totalScore *= 1 + (matchCount - 1) * 0.1;
  }

  // Normalize score to 0-1 range (approximately)
  const normalizedScore = Math.min(1, totalScore / Math.max(1, expansion.expansions.length * 0.5));

  return { score: normalizedScore, matchedTerms };
}

/**
 * Score and rank results using synonym expansion
 */
export function scoreResults<T>(
  results: Array<{ item: T; originalScore: number }>,
  expansion: ExpansionResult,
  getSearchableText: (item: T) => string,
  options: Partial<ScoringOptions> = {}
): ScoredResult<T>[] {
  const fullOptions = { ...DEFAULT_SCORING_OPTIONS, ...options };

  const scoredResults: ScoredResult<T>[] = results.map(result => {
    const { score: synonymScore, matchedTerms } = calculateSynonymScore(
      result.item,
      expansion,
      getSearchableText,
      fullOptions
    );

    const combinedScore =
      result.originalScore * fullOptions.originalScoreWeight +
      synonymScore * fullOptions.synonymScoreWeight;

    return {
      item: result.item,
      originalScore: result.originalScore,
      synonymScore,
      combinedScore,
      matchedTerms,
    };
  });

  // Sort by combined score descending
  scoredResults.sort((a, b) => b.combinedScore - a.combinedScore);

  return scoredResults;
}

/**
 * Re-rank existing search results using synonym expansion
 * This is useful when the original search already returns results
 * and we want to re-order them based on synonym relevance
 */
export function rerankResults<T>(
  results: T[],
  expansion: ExpansionResult,
  getSearchableText: (item: T) => string,
  getOriginalScore: (item: T, index: number) => number,
  options: Partial<ScoringOptions> = {}
): ScoredResult<T>[] {
  const resultsWithScores = results.map((item, index) => ({
    item,
    originalScore: getOriginalScore(item, index),
  }));

  return scoreResults(resultsWithScores, expansion, getSearchableText, options);
}

/**
 * Filter results to only include those matching at least one expanded term
 */
export function filterByExpansion<T>(
  items: T[],
  expansion: ExpansionResult,
  getSearchableText: (item: T) => string,
  minWeight: number = 0
): T[] {
  return items.filter(item => {
    const text = getSearchableText(item).toLowerCase();
    return expansion.expansions.some(
      exp => exp.weight >= minWeight && text.includes(exp.term)
    );
  });
}

/**
 * Group results by which expansion term they matched
 */
export function groupByMatchedTerm<T>(
  scoredResults: ScoredResult<T>[]
): Map<string, ScoredResult<T>[]> {
  const groups = new Map<string, ScoredResult<T>[]>();

  for (const result of scoredResults) {
    for (const match of result.matchedTerms) {
      if (!groups.has(match.term)) {
        groups.set(match.term, []);
      }
      groups.get(match.term)!.push(result);
    }
  }

  return groups;
}

/**
 * Calculate relevance explanation for a result
 */
export function explainRelevance<T>(
  result: ScoredResult<T>,
  expansion: ExpansionResult
): string {
  const explanations: string[] = [];

  // Explain original score contribution
  explanations.push(`Base relevance: ${(result.originalScore * 100).toFixed(0)}%`);

  // Explain synonym matches
  if (result.matchedTerms.length > 0) {
    const matchExplanations = result.matchedTerms.map(m => {
      if (m.source === 'original') {
        return `"${m.term}" (exact match)`;
      } else if (m.source === 'canonical') {
        return `"${m.term}" (canonical form)`;
      } else {
        return `"${m.term}" (synonym, ${(m.weight * 100).toFixed(0)}% weight)`;
      }
    });
    explanations.push(`Matched terms: ${matchExplanations.join(', ')}`);
  }

  // Final score
  explanations.push(`Combined score: ${(result.combinedScore * 100).toFixed(0)}%`);

  return explanations.join('\n');
}
