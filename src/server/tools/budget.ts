/**
 * Shared token budgeting helpers for tool output shaping.
 */

export interface TokenBudget {
  maxTokens: number;
  symbolBudget: number;
  typesBudget: number;
  calleesBudget: number;
  testsBudget: number;
}

/**
 * Estimate token count (rough approximation).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Truncate content to fit within a token budget.
 */
export function truncateToFit(content: string, maxTokens: number): string {
  const estimated = estimateTokens(content);
  if (estimated <= maxTokens) {
    return content;
  }

  const maxChars = Math.max(0, maxTokens * 4);
  const lines = content.split('\n');
  let result = '';
  let totalChars = 0;

  for (const line of lines) {
    if (totalChars + line.length + 1 > maxChars) {
      result += '\n// ... truncated ...';
      break;
    }
    result += (result ? '\n' : '') + line;
    totalChars += line.length + 1;
  }

  return result;
}

/**
 * Create a default token budget for context bundling.
 */
export function createTokenBudget(maxTokens?: number, includeTests?: boolean): TokenBudget {
  const total = maxTokens ?? 8000;

  if (includeTests) {
    return {
      maxTokens: total,
      symbolBudget: Math.floor(total * 0.4),
      typesBudget: Math.floor(total * 0.25),
      calleesBudget: Math.floor(total * 0.25),
      testsBudget: Math.floor(total * 0.1),
    };
  }

  return {
    maxTokens: total,
    symbolBudget: Math.floor(total * 0.45),
    typesBudget: Math.floor(total * 0.28),
    calleesBudget: Math.floor(total * 0.27),
    testsBudget: 0,
  };
}
