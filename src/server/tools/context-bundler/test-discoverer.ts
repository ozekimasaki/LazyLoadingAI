/**
 * Test discovery for context bundling
 * Finds tests related to a symbol
 */

import path from 'node:path';
import type { SqliteStorage } from '../../../indexer/storage/sqlite.js';
import type { SymbolReference } from '../../../types/symbols.js';

export type TestFramework = 'vitest' | 'jest' | 'mocha' | 'pytest' | 'unknown';

export interface TestReference {
  filePath: string;
  relativePath: string;
  testName: string;
  lineNumber: number;
  context: string;
  framework: TestFramework;
}

/**
 * Patterns for detecting test files
 */
const TEST_FILE_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /test_.*\.py$/,
  /_test\.py$/,
  /tests?\/.*\.[jt]sx?$/,
];

/**
 * Test function patterns by framework
 */
const TEST_PATTERNS: Record<TestFramework, RegExp[]> = {
  vitest: [
    /\b(?:describe|it|test)\s*\(\s*['"`]([^'"`]+)['"`]/,
    /\b(?:beforeEach|afterEach|beforeAll|afterAll)\s*\(/,
  ],
  jest: [
    /\b(?:describe|it|test)\s*\(\s*['"`]([^'"`]+)['"`]/,
    /\b(?:beforeEach|afterEach|beforeAll|afterAll)\s*\(/,
  ],
  mocha: [
    /\b(?:describe|it|specify|context)\s*\(\s*['"`]([^'"`]+)['"`]/,
    /\b(?:before|after|beforeEach|afterEach)\s*\(/,
  ],
  pytest: [
    /\bdef\s+(test_\w+)\s*\(/,
    /\bclass\s+(Test\w+)/,
    /@pytest\.fixture/,
  ],
  unknown: [],
};

/**
 * Check if a file is a test file
 */
export function isTestFile(filePath: string): boolean {
  const basename = path.basename(filePath);
  const dirname = path.dirname(filePath);

  // Check file name patterns
  for (const pattern of TEST_FILE_PATTERNS) {
    if (pattern.test(filePath) || pattern.test(basename)) {
      return true;
    }
  }

  // Check if in a tests directory
  if (dirname.includes('/tests/') || dirname.includes('/test/') ||
      dirname.includes('/__tests__/') || dirname.endsWith('/tests') ||
      dirname.endsWith('/test') || dirname.endsWith('/__tests__')) {
    return true;
  }

  return false;
}

/**
 * Detect the test framework used in a file
 */
export function detectFramework(filePath: string, content: string): TestFramework {
  const ext = path.extname(filePath);

  // Python files use pytest
  if (ext === '.py') {
    return 'pytest';
  }

  // Check for framework imports
  if (content.includes("from 'vitest'") || content.includes('from "vitest"') ||
      content.includes("import { describe, it") || content.includes("import { test")) {
    // Could be vitest or jest - check for vitest-specific imports
    if (content.includes('vitest')) {
      return 'vitest';
    }
  }

  if (content.includes("from 'jest'") || content.includes('from "jest"') ||
      content.includes("require('jest')") || content.includes('require("jest")')) {
    return 'jest';
  }

  if (content.includes("from 'mocha'") || content.includes('from "mocha"') ||
      content.includes("require('mocha')") || content.includes('require("mocha")')) {
    return 'mocha';
  }

  // Default to jest/vitest style for JS/TS files
  if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx') {
    return 'vitest'; // Modern default
  }

  return 'unknown';
}

/**
 * Discover tests that reference a symbol
 */
export async function discoverTests(
  symbolName: string,
  storage: SqliteStorage,
  rootDir: string
): Promise<TestReference[]> {
  const tests: TestReference[] = [];

  // Get all references to the symbol
  const references = await storage.getReferencesByName(symbolName);

  // Filter to references in test files
  const testRefs = references.filter(ref => isTestFile(ref.referencingFile));

  // Group references by file
  const byFile = new Map<string, SymbolReference[]>();
  for (const ref of testRefs) {
    const existing = byFile.get(ref.referencingFile) ?? [];
    existing.push(ref);
    byFile.set(ref.referencingFile, existing);
  }

  // For each test file, find the enclosing test
  for (const [filePath, refs] of byFile) {
    try {
      const fs = await import('node:fs');
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      const framework = detectFramework(filePath, content);

      for (const ref of refs) {
        const testInfo = findEnclosingTest(lines, ref.lineNumber, framework);
        if (testInfo) {
          tests.push({
            filePath,
            relativePath: path.relative(rootDir, filePath),
            testName: testInfo.name,
            lineNumber: testInfo.line,
            context: ref.context,
            framework,
          });
        }
      }
    } catch {
      // Skip files that can't be read
    }
  }

  // Remove duplicates (same test might reference symbol multiple times)
  const seen = new Set<string>();
  return tests.filter(t => {
    const key = `${t.filePath}:${t.lineNumber}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Find the enclosing test for a line number
 */
function findEnclosingTest(
  lines: string[],
  lineNumber: number,
  framework: TestFramework
): { name: string; line: number } | null {
  const patterns = TEST_PATTERNS[framework];
  if (patterns.length === 0) return null;

  // Search backwards from the line to find the enclosing test
  for (let i = lineNumber - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line) continue;

    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        const testName = match[1] ?? extractFunctionName(line);
        if (testName) {
          return { name: testName, line: i + 1 };
        }
      }
    }
  }

  return null;
}

/**
 * Extract function name from a line
 */
function extractFunctionName(line: string): string | null {
  // Try to extract function name from various patterns
  const patterns = [
    /\bfunction\s+(\w+)/,
    /\bdef\s+(\w+)/,
    /\bconst\s+(\w+)\s*=/,
    /\b(\w+)\s*[=:]\s*(?:async\s*)?\(/,
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match) {
      return match[1]!;
    }
  }

  return null;
}

/**
 * Get test source code with context
 */
export async function getTestSource(
  test: TestReference,
  contextLines: number = 20
): Promise<string | null> {
  try {
    const fs = await import('node:fs');
    const content = await fs.promises.readFile(test.filePath, 'utf-8');
    const lines = content.split('\n');

    // Find the end of the test block
    const startIdx = test.lineNumber - 1;
    let endIdx = startIdx;
    let braceCount = 0;
    let foundStart = false;

    for (let i = startIdx; i < lines.length && i < startIdx + contextLines; i++) {
      const line = lines[i]!;
      for (const char of line) {
        if (char === '{' || char === '(') {
          braceCount++;
          foundStart = true;
        } else if (char === '}' || char === ')') {
          braceCount--;
          if (foundStart && braceCount === 0) {
            endIdx = i;
            break;
          }
        }
      }
      if (foundStart && braceCount === 0) break;
      endIdx = i;
    }

    return lines.slice(startIdx, endIdx + 1).join('\n');
  } catch {
    return null;
  }
}
