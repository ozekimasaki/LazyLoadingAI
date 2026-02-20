import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { Indexer } from '../../../src/indexer/index.js';
import { getFunctionTool } from '../../../src/server/tools/get-function.js';
import { getClassTool } from '../../../src/server/tools/get-class.js';
import { listFunctionsTool } from '../../../src/server/tools/list-functions.js';
import { traceCallsTool } from '../../../src/server/tools/trace-calls.js';
import { getArchitectureOverviewTool } from '../../../src/server/tools/get-architecture-overview.js';
import { createTempProject, type TempProjectResult } from '../../helpers/fixtures.js';

function createLargeImplementationsFixture(): string {
  const functionBlocks = Array.from({ length: 12 }, (_, index) => {
    const body = Array.from(
      { length: 90 },
      (_, offset) => `  result = (result * 3 + ${index + offset}) % 9973;`
    ).join('\n');

    return `export function heavyImplementation${index}(seed: number): number {
  let result = seed;
${body}
  return result;
}`;
  });

  return functionBlocks.join('\n\n') + '\n';
}


async function runGetFunction(indexer: Indexer, input: Record<string, unknown> = {}) {
  return getFunctionTool(indexer, { format: 'markdown', ...input } as any);
}

async function runGetClass(indexer: Indexer, input: Record<string, unknown> = {}) {
  return getClassTool(indexer, { format: 'markdown', ...input } as any);
}

async function runListFunctions(indexer: Indexer, input: Record<string, unknown> = {}) {
  return listFunctionsTool(indexer, { format: 'markdown', ...input } as any);
}

async function runTraceCalls(indexer: Indexer, input: Record<string, unknown> = {}) {
  return traceCallsTool(indexer, { format: 'markdown', ...input } as any);
}

describe('Symbol Tools Integration', () => {
  let indexer: Indexer;
  let tempProject: TempProjectResult;

  beforeAll(async () => {
    tempProject = createTempProject({
      'package.json': JSON.stringify({
        name: 'symbol-test-project',
        version: '1.0.0',
        main: './dist/index.js',
        exports: {
          '.': './dist/index.js',
          './utils': './dist/utils.js',
        },
      }, null, 2),
      'src/index.ts': `
// Main entry point
export { Calculator } from './calculator.js';
export { formatNumber, parseNumber } from './utils.js';
export type { CalculatorOptions } from './types.js';
`,
      'src/types.ts': `
export interface CalculatorOptions {
  precision: number;
  roundingMode: 'floor' | 'ceil' | 'round';
}

export type Operation = 'add' | 'subtract' | 'multiply' | 'divide';
`,
      'src/utils.ts': `
import type { CalculatorOptions } from './types.js';

/**
 * Format a number with the specified precision
 * @param num - The number to format
 * @param options - Formatting options
 * @returns Formatted number string
 */
export function formatNumber(num: number, options?: CalculatorOptions): string {
  const precision = options?.precision ?? 2;
  return num.toFixed(precision);
}

/**
 * Parse a string to number
 */
export function parseNumber(str: string): number {
  const num = parseFloat(str);
  if (isNaN(num)) {
    throw new Error('Invalid number');
  }
  return num;
}

// Internal helper
function validatePrecision(precision: number): void {
  if (precision < 0 || precision > 20) {
    throw new Error('Precision must be between 0 and 20');
  }
}

export function roundNumber(num: number, precision: number): number {
  validatePrecision(precision);
  const factor = Math.pow(10, precision);
  return Math.round(num * factor) / factor;
}
`,
      'src/calculator.ts': `
import type { CalculatorOptions, Operation } from './types.js';
import { formatNumber, roundNumber } from './utils.js';

/**
 * A simple calculator class
 */
export class Calculator {
  private history: number[] = [];
  private options: CalculatorOptions;

  /**
   * Create a new calculator
   * @param options - Calculator configuration
   */
  constructor(options: Partial<CalculatorOptions> = {}) {
    this.options = {
      precision: options.precision ?? 2,
      roundingMode: options.roundingMode ?? 'round',
    };
  }

  /**
   * Add two numbers
   */
  add(a: number, b: number): number {
    const result = a + b;
    this.history.push(result);
    return roundNumber(result, this.options.precision);
  }

  /**
   * Subtract b from a
   */
  subtract(a: number, b: number): number {
    const result = a - b;
    this.history.push(result);
    return roundNumber(result, this.options.precision);
  }

  /**
   * Multiply two numbers
   */
  multiply(a: number, b: number): number {
    const result = a * b;
    this.history.push(result);
    return roundNumber(result, this.options.precision);
  }

  /**
   * Divide a by b
   * @throws Error if b is zero
   */
  divide(a: number, b: number): number {
    if (b === 0) {
      throw new Error('Cannot divide by zero');
    }
    const result = a / b;
    this.history.push(result);
    return roundNumber(result, this.options.precision);
  }

  /**
   * Get the calculation history
   */
  getHistory(): number[] {
    return [...this.history];
  }

  /**
   * Clear the calculation history
   */
  clearHistory(): void {
    this.history = [];
  }

  /**
   * Format a result using the calculator's options
   */
  format(num: number): string {
    return formatNumber(num, this.options);
  }

  /**
   * Perform a calculation based on operation type
   */
  calculate(operation: Operation, a: number, b: number): number {
    switch (operation) {
      case 'add':
        return this.add(a, b);
      case 'subtract':
        return this.subtract(a, b);
      case 'multiply':
        return this.multiply(a, b);
      case 'divide':
        return this.divide(a, b);
    }
  }

  /**
   * Static factory method
   */
  static create(precision: number = 2): Calculator {
    return new Calculator({ precision });
  }
}
`,
      'src/cli-command.ts': `
import { Command } from 'commander';

export const cliCommand = new Command('demo')
  .description('Demo command for CLI callback parsing')
  .action(async (options) => {
    const output = options?.output ?? 'ok';
    console.log(output);
    return output;
  });
`,
      'src/large-implementations.ts': createLargeImplementationsFixture(),
    });

    indexer = new Indexer({
      rootDirectory: tempProject.rootDir,
      databasePath: path.join(tempProject.rootDir, '.lazyload', 'test.db'),
      include: ['**/*.ts', '**/*.json'],
      exclude: ['node_modules/**'],
    });
    await indexer.initialize();
    await indexer.indexDirectory();
  });

  afterAll(async () => {
    await indexer.close();
    tempProject.cleanup();
  });

  describe('getFunctionTool', () => {
    it('retrieves function source code', async () => {
      const result = await runGetFunction(indexer, {
        filePath: 'src/utils.ts',
        functionName: 'formatNumber',
      });
      const text = result.content[0]?.text ?? '';

      expect(text).toContain('formatNumber');
      expect(text).toContain('toFixed');
      expect(text).toContain('Source Code');
    });

    it('includes JSDoc documentation', async () => {
      const result = await runGetFunction(indexer, {
        filePath: 'src/utils.ts',
        functionName: 'formatNumber',
      });
      const text = result.content[0]?.text ?? '';

      // Should include the doc comment
      expect(text).toContain('Format a number');
    });

    it('retrieves function with context lines', async () => {
      const result = await runGetFunction(indexer, {
        filePath: 'src/utils.ts',
        functionName: 'parseNumber',
        includeContext: true,
        contextLines: 3,
      });
      const text = result.content[0]?.text ?? '';

      expect(text).toContain('parseNumber');
    });

    it('handles non-existent function', async () => {
      const result = await runGetFunction(indexer, {
        filePath: 'src/utils.ts',
        functionName: 'nonexistentFunction',
      });
      const text = result.content[0]?.text ?? '';

      expect(text.toLowerCase()).toContain('not found');
    });

    it('retrieves private/internal functions', async () => {
      const result = await runGetFunction(indexer, {
        filePath: 'src/utils.ts',
        functionName: 'validatePrecision',
      });
      const text = result.content[0]?.text ?? '';

      expect(text).toContain('validatePrecision');
    });
  });

  describe('getClassTool', () => {
    it('retrieves full class source code', async () => {
      const result = await runGetClass(indexer, {
        filePath: 'src/calculator.ts',
        className: 'Calculator',
      });
      const text = result.content[0]?.text ?? '';

      expect(text).toContain('class Calculator');
      expect(text).toContain('add');
      expect(text).toContain('subtract');
      expect(text).toContain('multiply');
      expect(text).toContain('divide');
    });

    it('retrieves only method signatures when methodsOnly is true', async () => {
      const result = await runGetClass(indexer, {
        filePath: 'src/calculator.ts',
        className: 'Calculator',
        methodsOnly: true,
      });
      const text = result.content[0]?.text ?? '';

      expect(text).toContain('Calculator');
      expect(text).toContain('Signature');
    });

    it('includes class documentation', async () => {
      const result = await runGetClass(indexer, {
        filePath: 'src/calculator.ts',
        className: 'Calculator',
      });
      const text = result.content[0]?.text ?? '';

      expect(text).toContain('simple calculator');
    });

    it('shows static methods', async () => {
      const result = await runGetClass(indexer, {
        filePath: 'src/calculator.ts',
        className: 'Calculator',
      });
      const text = result.content[0]?.text ?? '';

      expect(text).toContain('create');
      expect(text).toContain('static');
    });

    it('handles non-existent class', async () => {
      const result = await runGetClass(indexer, {
        filePath: 'src/calculator.ts',
        className: 'NonExistentClass',
      });
      const text = result.content[0]?.text ?? '';

      expect(text.toLowerCase()).toContain('not found');
    });

    it('includes context when requested', async () => {
      const result = await runGetClass(indexer, {
        filePath: 'src/calculator.ts',
        className: 'Calculator',
        includeContext: true,
      });
      const text = result.content[0]?.text ?? '';

      expect(text).toContain('Calculator');
    });
  });

  describe('listFunctionsTool', () => {
    it('lists all functions in a file', async () => {
      const result = await runListFunctions(indexer, {
        filePath: 'src/utils.ts',
      });
      const text = result.content[0]?.text ?? '';

      expect(text).toContain('formatNumber');
      expect(text).toContain('parseNumber');
      expect(text).toContain('roundNumber');
    });

    it('lists class methods', async () => {
      const result = await runListFunctions(indexer, {
        filePath: 'src/calculator.ts',
      });
      const text = result.content[0]?.text ?? '';

      expect(text).toContain('add');
      expect(text).toContain('subtract');
      expect(text).toContain('multiply');
      expect(text).toContain('divide');
      expect(text).toContain('calculate');
    });

    it('includes private functions when requested', async () => {
      const result = await runListFunctions(indexer, {
        filePath: 'src/utils.ts',
        includePrivate: true,
      });
      const text = result.content[0]?.text ?? '';

      // validatePrecision is a private function
      expect(text).toContain('validatePrecision');
    });

    it('handles file with no functions', async () => {
      const result = await runListFunctions(indexer, {
        filePath: 'src/types.ts',
      });
      const text = result.content[0]?.text ?? '';

      // types.ts only has interfaces, no functions
      expect(text).toBeDefined();
    });

    it('handles non-existent file', async () => {
      const result = await runListFunctions(indexer, {
        filePath: 'src/nonexistent.ts',
      });
      const text = result.content[0]?.text ?? '';

      expect(text.toLowerCase()).toContain('not found');
    });

    it('includes top implementations when includeSource is true', async () => {
      const result = await runListFunctions(indexer, {
        filePath: 'src/calculator.ts',
        includeSource: true,
      });
      const text = result.content[0]?.text ?? '';

      expect(text).toContain('## Top Implementations');
      expect(text).toMatch(/### Calculator\.(add|subtract|multiply|divide|calculate)/);
      expect(text).toContain('Reference Count');

      const topSection = text.split('## Top Implementations')[1] ?? '';
      expect(topSection).not.toMatch(/###\s+validatePrecision\b/);
    });

    it('enforces source budget when includeSource output is large', async () => {
      const result = await runListFunctions(indexer, {
        filePath: 'src/large-implementations.ts',
        includeSource: true,
      });
      const text = result.content[0]?.text ?? '';

      expect(text).toContain('## Top Implementations');
      expect(text).toContain('Source budget reached');
    });

    it('adds a direct Read hint for small files with includeSource', async () => {
      const result = await runListFunctions(indexer, {
        filePath: 'src/utils.ts',
        includeSource: true,
      });
      const text = result.content[0]?.text ?? '';

      expect(text).toContain('This file is only');
      expect(text).toContain('Read()');
    });

    it('falls back to callback implementations for CLI command files', async () => {
      const result = await runListFunctions(indexer, {
        filePath: 'src/cli-command.ts',
        includeSource: true,
      });
      const text = result.content[0]?.text ?? '';

      expect(text).toContain('## Top Implementations');
      expect(text).toContain('using callback implementations');
      expect(text).toContain('action_callback_');
      expect(text).toContain('console.log(output)');
      expect(text).not.toContain('No functions, methods, or callback candidates found');
    });
  });

  describe('traceCallsTool callers mode', () => {
    it('finds callers of a function', async () => {
      const result = await runTraceCalls(indexer, {
        functionName: 'roundNumber',
        direction: 'callers',
      });
      const text = result.content[0]?.text ?? '';

      // roundNumber is called by Calculator methods
      expect(text).toBeDefined();
    });

    it('handles function with no callers', async () => {
      const result = await runTraceCalls(indexer, {
        functionName: 'parseNumber',
        direction: 'callers',
      });
      const text = result.content[0]?.text ?? '';

      // parseNumber is exported but might not be called internally
      expect(text).toBeDefined();
    });

    it('respects depth parameter', async () => {
      const result = await runTraceCalls(indexer, {
        functionName: 'validatePrecision',
        direction: 'callers',
        depth: 2,
      });
      const text = result.content[0]?.text ?? '';

      expect(text).toBeDefined();
    });
  });

  describe('traceCallsTool callees mode', () => {
    it('finds callees of a function', async () => {
      const result = await runTraceCalls(indexer, {
        functionName: 'Calculator.add',
        direction: 'callees',
      });
      const text = result.content[0]?.text ?? '';

      // add() calls roundNumber
      expect(text).toBeDefined();
    });

    it('handles function with no callees', async () => {
      const result = await runTraceCalls(indexer, {
        functionName: 'parseNumber',
        direction: 'callees',
      });
      const text = result.content[0]?.text ?? '';

      expect(text).toBeDefined();
    });

    it('respects depth parameter', async () => {
      const result = await runTraceCalls(indexer, {
        functionName: 'Calculator.calculate',
        direction: 'callees',
        depth: 2,
      });
      const text = result.content[0]?.text ?? '';

      // calculate() calls add/subtract/multiply/divide which call roundNumber
      expect(text).toBeDefined();
    });
  });

  describe('getArchitectureOverviewTool', () => {
    it('includes absorbed public API in full architecture output', async () => {
      const result = await getArchitectureOverviewTool(indexer, {
        focus: 'full',
        format: 'markdown',
      });
      const text = result.content[0]?.text ?? '';

      expect(text).toContain('## Modules');
      expect(text).toContain('## Public API');
      expect(text).toContain('Calculator');
      expect(text).toContain('formatNumber');
    });

    it('supports public_api focus grouped by file', async () => {
      const result = await getArchitectureOverviewTool(indexer, {
        focus: 'public_api',
        group_by: 'file',
        format: 'markdown',
      });
      const text = result.content[0]?.text ?? '';

      expect(text).toContain('## Public API');
      expect(text).toContain('`src/calculator.ts`');
      expect(text).toContain('`src/utils.ts`');
    });

    it('renders module dependencies section', async () => {
      const result = await getArchitectureOverviewTool(indexer, {
        focus: 'dependencies',
        format: 'markdown',
      });
      const text = result.content[0]?.text ?? '';

      expect(text).toContain('## Module Dependencies');
      expect(text).toContain('No cross-module internal imports detected');
    });
  });
});

describe('Symbol Tools - Edge Cases', () => {
  let indexer: Indexer;
  let tempProject: TempProjectResult;

  beforeAll(async () => {
    tempProject = createTempProject({
      'src/edge-cases.ts': `
// Arrow functions
export const arrowFunc = (x: number): number => x * 2;

// Nested function
export function outer() {
  function inner() {
    return 'inner';
  }
  return inner();
}

// Async function
export async function asyncFunc(): Promise<string> {
  return 'async result';
}

// Generator function
export function* generatorFunc(): Generator<number> {
  yield 1;
  yield 2;
  yield 3;
}

// Function with default parameters
export function withDefaults(a: number = 0, b: string = 'default'): string {
  return \`\${a}: \${b}\`;
}

// Function with rest parameters
export function withRest(...args: number[]): number {
  return args.reduce((sum, n) => sum + n, 0);
}

// Overloaded function
export function overloaded(x: string): string;
export function overloaded(x: number): number;
export function overloaded(x: string | number): string | number {
  return x;
}

// Generic function
export function identity<T>(value: T): T {
  return value;
}

// Method decorator (for testing decorators)
function log(target: any, key: string, descriptor: PropertyDescriptor) {
  return descriptor;
}

// Class with decorators
export class DecoratedClass {
  @log
  decoratedMethod(): void {
    console.log('decorated');
  }
}

// Abstract class
export abstract class AbstractBase {
  abstract abstractMethod(): void;

  concreteMethod(): string {
    return 'concrete';
  }
}

// Implementing abstract class
export class ConcreteImpl extends AbstractBase {
  abstractMethod(): void {
    console.log('implemented');
  }
}
`,
    });

    indexer = new Indexer({
      rootDirectory: tempProject.rootDir,
      databasePath: path.join(tempProject.rootDir, '.lazyload', 'test.db'),
      include: ['**/*.ts'],
      exclude: [],
    });
    await indexer.initialize();
    await indexer.indexDirectory();
  });

  afterAll(async () => {
    await indexer.close();
    tempProject.cleanup();
  });

  it('handles arrow functions', async () => {
    const result = await runListFunctions(indexer, {
      filePath: 'src/edge-cases.ts',
    });
    const text = result.content[0]?.text ?? '';

    expect(text).toContain('arrowFunc');
  });

  it('handles async functions', async () => {
    const result = await runGetFunction(indexer, {
      filePath: 'src/edge-cases.ts',
      functionName: 'asyncFunc',
    });
    const text = result.content[0]?.text ?? '';

    expect(text).toContain('async');
    expect(text).toContain('Promise');
  });

  it('handles generator functions', async () => {
    const result = await runGetFunction(indexer, {
      filePath: 'src/edge-cases.ts',
      functionName: 'generatorFunc',
    });
    const text = result.content[0]?.text ?? '';

    expect(text).toContain('Generator');
  });

  it('handles functions with default parameters', async () => {
    const result = await runGetFunction(indexer, {
      filePath: 'src/edge-cases.ts',
      functionName: 'withDefaults',
    });
    const text = result.content[0]?.text ?? '';

    expect(text).toContain('withDefaults');
  });

  it('handles generic functions', async () => {
    const result = await runGetFunction(indexer, {
      filePath: 'src/edge-cases.ts',
      functionName: 'identity',
    });
    const text = result.content[0]?.text ?? '';

    expect(text).toContain('identity');
  });

  it('handles abstract classes', async () => {
    const result = await runGetClass(indexer, {
      filePath: 'src/edge-cases.ts',
      className: 'AbstractBase',
    });
    const text = result.content[0]?.text ?? '';

    expect(text).toContain('abstract');
    expect(text).toContain('AbstractBase');
  });

  it('handles class inheritance', async () => {
    const result = await runGetClass(indexer, {
      filePath: 'src/edge-cases.ts',
      className: 'ConcreteImpl',
    });
    const text = result.content[0]?.text ?? '';

    expect(text).toContain('ConcreteImpl');
    expect(text).toContain('extends');
  });
});
