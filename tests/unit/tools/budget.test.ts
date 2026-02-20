import { describe, expect, it } from 'vitest';
import {
  estimateTokens,
  truncateToFit,
  createTokenBudget,
} from '../../../src/server/tools/budget.js';

describe('budget helpers', () => {
  it('estimates tokens from character length', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });

  it('does not truncate when content is within budget', () => {
    const content = 'line 1\nline 2';
    expect(truncateToFit(content, 10)).toBe(content);
  });

  it('truncates with a deterministic marker when over budget', () => {
    const content = ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)].join('\n');
    const truncated = truncateToFit(content, 10);

    expect(truncated).toContain('// ... truncated ...');
    expect(truncated.length).toBeLessThan(content.length);
  });

  it('creates default budget without tests by default', () => {
    const budget = createTokenBudget();

    expect(budget.maxTokens).toBe(8000);
    expect(budget.symbolBudget).toBe(3600);
    expect(budget.typesBudget).toBe(2240);
    expect(budget.calleesBudget).toBe(2160);
    expect(budget.testsBudget).toBe(0);
  });

  it('allocates test budget when includeTests is true', () => {
    const budget = createTokenBudget(1000, true);

    expect(budget.maxTokens).toBe(1000);
    expect(budget.symbolBudget).toBe(400);
    expect(budget.typesBudget).toBe(250);
    expect(budget.calleesBudget).toBe(250);
    expect(budget.testsBudget).toBe(100);
  });
});
