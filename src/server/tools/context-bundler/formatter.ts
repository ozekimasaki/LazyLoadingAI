/**
 * Output formatting for context bundling
 */

import path from 'node:path';
import type { TypeDefinition } from './type-resolver.js';
import type { TestReference } from './test-discoverer.js';
import type { FunctionSignature, CallGraphEdge } from '../../../types/symbols.js';
import { estimateTokens, truncateToFit, type TokenBudget } from '../budget.js';
import { formatCompactTable, formatCompactSource } from '../compact-format.js';

export { estimateTokens, truncateToFit, type TokenBudget, createTokenBudget } from '../budget.js';

// Known external package patterns for categorization
const EXTERNAL_PATTERNS: Record<string, RegExp[]> = {
  'react': [/^use[A-Z]/, /^React\./, /^useState$/, /^useEffect$/, /^useCallback$/, /^useMemo$/, /^useRef$/, /^useContext$/, /^useReducer$/],
  'lodash': [/^_\./, /^lodash\./, /^debounce$/, /^throttle$/, /^cloneDeep$/, /^merge$/, /^pick$/, /^omit$/],
  'node': [/^console\./, /^process\./, /^require$/, /^import$/, /^Buffer\./, /^__dirname$/, /^__filename$/],
  'node:fs': [/^readFile/, /^writeFile/, /^stat/, /^mkdir/, /^readdir/, /^unlink/, /^rename$/],
  'node:path': [/^join$/, /^resolve$/, /^dirname$/, /^basename$/, /^extname$/, /^relative$/],
  'async': [/^Promise\./, /^async$/, /^await$/, /^setTimeout$/, /^setInterval$/],
};

/**
 * Categorize a callee as external or internal
 */
function categorizeCallee(calleeName: string): { isExternal: boolean; package?: string } {
  for (const [pkg, patterns] of Object.entries(EXTERNAL_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(calleeName)) {
        return { isExternal: true, package: pkg };
      }
    }
  }
  return { isExternal: false };
}

export interface ContextBundleData {
  symbol: {
    signature: FunctionSignature;
    source: string;
    filePath: string;
    relativePath: string;
  };
  types: Array<{
    definition: TypeDefinition;
    source: string | null;
  }>;
  callees: Array<{
    edge: CallGraphEdge;
    signature: FunctionSignature | null;
    source: string | null;
  }>;
  tests: Array<{
    reference: TestReference;
    source: string | null;
  }>;
}

/**
 * Format the context bundle as markdown
 */
export function formatContextBundle(
  data: ContextBundleData,
  budget: TokenBudget,
  rootDir: string,
  options?: { includeTests?: boolean }
): string {
  const sections: string[] = [];
  let totalTokens = 0;

  // Header
  sections.push(`# Context Bundle for \`${data.symbol.signature.name}\`\n`);

  // 1. Function Source (40% budget)
  {
    const symbolSection = formatSymbolSection(data.symbol, budget.symbolBudget);
    sections.push(symbolSection.content);
    totalTokens += symbolSection.tokens;
  }

  // 2. Type Definitions (25% budget)
  if (data.types.length > 0) {
    const typesSection = formatTypesSection(data.types, budget.typesBudget, rootDir);
    sections.push(typesSection.content);
    totalTokens += typesSection.tokens;
  }

  // 3. Called Functions (25% budget)
  if (data.callees.length > 0) {
    const calleesSection = formatCalleesSection(data.callees, budget.calleesBudget, rootDir);
    sections.push(calleesSection.content);
    totalTokens += calleesSection.tokens;
  }

  // 4. Related Tests (only if requested)
  if (options?.includeTests && data.tests.length > 0) {
    const testsSection = formatTestsSection(data.tests, budget.testsBudget, rootDir);
    sections.push(testsSection.content);
    totalTokens += testsSection.tokens;
  }

  return sections.join('\n');
}

/**
 * Format the context bundle in compact TSV-oriented format for low token cost.
 */
export function formatContextBundleCompact(
  data: ContextBundleData,
  rootDir: string,
  options?: { includeTests?: boolean }
): string {
  const sections: string[] = [];
  const startLine = data.symbol.signature.location.startLine;
  const endLine = data.symbol.signature.location.endLine;
  const symbolRef = `${data.symbol.relativePath}:${startLine}-${endLine}`;
  const language = inferLanguageLabel(data.symbol.filePath);

  sections.push(`[SYMBOL] ${data.symbol.signature.name} (${symbolRef})`);
  sections.push(formatCompactSource(`${symbolRef} ${language}`, data.symbol.source));

  if (data.types.length > 0) {
    const typeRows = data.types.map(({ definition }) => ({
      name: definition.name,
      file: path.relative(rootDir, definition.filePath),
      line: definition.startLine,
    }));
    sections.push('[TYPES]');
    sections.push(formatCompactTable(typeRows, { columns: ['name', 'file', 'line'] }));
  }

  if (data.callees.length > 0) {
    const calleeRows = data.callees.map(({ edge, signature }) => ({
      name: edge.calleeName,
      file: signature ? path.relative(rootDir, signature.location.filePath) : '',
      resolved: signature ? 'Y' : 'N',
    }));
    sections.push('[CALLEES]');
    sections.push(formatCompactTable(calleeRows, { columns: ['name', 'file', 'resolved'] }));
  }

  if (options?.includeTests && data.tests.length > 0) {
    const testRows = data.tests.map(({ reference }) => ({
      file: reference.relativePath,
      line: reference.lineNumber,
      test: reference.testName,
    }));
    sections.push('[TESTS]');
    sections.push(formatCompactTable(testRows, { columns: ['file', 'line', 'test'] }));
  }

  return sections.join('\n\n');
}

function formatSymbolSection(
  symbol: ContextBundleData['symbol'],
  maxTokens: number
): { content: string; tokens: number } {
  let content = `## 1. Function Source\n\n`;
  content += `**File**: \`${symbol.relativePath}:${symbol.signature.location.startLine}-${symbol.signature.location.endLine}\`\n\n`;

  const source = truncateToFit(symbol.source, maxTokens - 50);
  content += '```typescript\n' + source + '\n```\n';

  return { content, tokens: estimateTokens(content) };
}

function formatTypesSection(
  types: ContextBundleData['types'],
  maxTokens: number,
  rootDir: string
): { content: string; tokens: number } {
  let content = `## 2. Type Definitions (${types.length})\n\n`;
  let usedTokens = estimateTokens(content);
  const tokensPerType = Math.floor((maxTokens - usedTokens) / Math.max(types.length, 1));

  for (const { definition, source } of types) {
    if (usedTokens >= maxTokens) {
      content += '\n*... additional types truncated ...*\n';
      break;
    }

    const relativePath = path.relative(rootDir, definition.filePath);
    content += `### ${definition.name} (\`${relativePath}:${definition.startLine}\`)\n\n`;

    if (source) {
      const truncatedSource = truncateToFit(source, tokensPerType - 30);
      content += '```typescript\n' + truncatedSource + '\n```\n\n';
    } else {
      content += `*Source not available*\n\n`;
    }

    usedTokens = estimateTokens(content);
  }

  return { content, tokens: usedTokens };
}

function formatCalleesSection(
  callees: ContextBundleData['callees'],
  maxTokens: number,
  rootDir: string
): { content: string; tokens: number } {
  // Categorize callees into resolved, external (by package), and unresolved
  const resolved: typeof callees = [];
  const externalByPackage = new Map<string, string[]>();
  const unresolved: string[] = [];

  for (const callee of callees) {
    if (callee.signature) {
      resolved.push(callee);
    } else {
      const category = categorizeCallee(callee.edge.calleeName);
      if (category.isExternal && category.package) {
        const existing = externalByPackage.get(category.package) ?? [];
        existing.push(callee.edge.calleeName);
        externalByPackage.set(category.package, existing);
      } else {
        unresolved.push(callee.edge.calleeName);
      }
    }
  }

  let content = `## 3. Called Functions (${callees.length})\n\n`;
  let usedTokens = estimateTokens(content);

  // Show resolved functions with source
  if (resolved.length > 0) {
    content += `### Internal Functions (${resolved.length})\n\n`;
    const tokensPerCallee = Math.floor((maxTokens - usedTokens - 500) / Math.max(resolved.length, 1));

    for (const { edge, signature, source } of resolved) {
      if (usedTokens >= maxTokens - 200) {
        content += '\n*... additional callees truncated ...*\n';
        break;
      }

      const relativePath = path.relative(rootDir, signature!.location.filePath);
      content += `#### ${edge.calleeName} (\`${relativePath}:${signature!.location.startLine}\`)\n\n`;

      if (source) {
        const truncatedSource = truncateToFit(source, tokensPerCallee - 30);
        content += '```typescript\n' + truncatedSource + '\n```\n\n';
      } else {
        content += `\`\`\`typescript\n${signature!.signature}\n\`\`\`\n\n`;
      }

      usedTokens = estimateTokens(content);
    }
  }

  // Show external dependencies as a summarized table
  if (externalByPackage.size > 0) {
    content += `### External Dependencies\n\n`;
    content += `| Package | Functions |\n`;
    content += `|---------|----------|\n`;

    for (const [pkg, funcs] of externalByPackage) {
      const uniqueFuncs = [...new Set(funcs)];
      const displayCount = 4;
      if (uniqueFuncs.length > displayCount) {
        const shown = uniqueFuncs.slice(0, displayCount).join(', ');
        content += `| ${pkg} | ${shown} (+${uniqueFuncs.length - displayCount} more) |\n`;
      } else {
        content += `| ${pkg} | ${uniqueFuncs.join(', ')} |\n`;
      }
    }
    content += '\n';
    usedTokens = estimateTokens(content);
  }

  // Show truly unresolved functions (not categorized as external)
  if (unresolved.length > 0) {
    const uniqueUnresolved = [...new Set(unresolved)];
    content += `### Unresolved Functions (${uniqueUnresolved.length})\n\n`;
    content += `*These are internal calls that couldn't be found in the index:*\n\n`;

    const maxToShow = 10;
    const toShow = uniqueUnresolved.slice(0, maxToShow);
    for (const name of toShow) {
      content += `- \`${name}\`\n`;
    }
    if (uniqueUnresolved.length > maxToShow) {
      content += `\n*... and ${uniqueUnresolved.length - maxToShow} more*\n`;
    }
    content += '\n';
    usedTokens = estimateTokens(content);
  }

  return { content, tokens: usedTokens };
}

function formatTestsSection(
  tests: ContextBundleData['tests'],
  maxTokens: number,
  rootDir: string
): { content: string; tokens: number } {
  let content = `## 4. Related Tests (${tests.length})\n\n`;
  let usedTokens = estimateTokens(content);

  for (const { reference, source } of tests) {
    if (usedTokens >= maxTokens) {
      content += '\n*... additional tests truncated ...*\n';
      break;
    }

    content += `- **${reference.relativePath}:${reference.lineNumber}** - "${reference.testName}"\n`;

    if (source) {
      const tokensRemaining = maxTokens - usedTokens - 50;
      if (tokensRemaining > 100) {
        const truncatedSource = truncateToFit(source, Math.min(tokensRemaining, 200));
        content += '```typescript\n' + truncatedSource + '\n```\n';
      }
    }

    usedTokens = estimateTokens(content);
  }

  return { content, tokens: usedTokens };
}

function inferLanguageLabel(filePath: string): string {
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) return 'typescript';
  if (filePath.endsWith('.js') || filePath.endsWith('.jsx') || filePath.endsWith('.mjs')) return 'javascript';
  if (filePath.endsWith('.py')) return 'python';
  return 'text';
}
