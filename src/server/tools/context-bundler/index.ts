/**
 * Smart Context Bundling
 * Bundles related code context for a symbol
 */

import path from 'node:path';
import type { Indexer } from '../../../indexer/index.js';
import type { SqliteStorage } from '../../../indexer/storage/sqlite.js';
import type { FunctionSignature } from '../../../types/symbols.js';

import { resolveAllTypes, getTypeSource, type TypeDefinition } from './type-resolver.js';
import { discoverTests, getTestSource, type TestReference } from './test-discoverer.js';
import {
  formatContextBundle,
  formatContextBundleCompact,
  createTokenBudget,
  type ContextBundleData,
  type TokenBudget,
} from './formatter.js';

export interface ContextBundlerOptions {
  includeTypes?: boolean;
  includeCallees?: boolean;
  includeTests?: boolean;
  calleeDepth?: number;
  maxTokens?: number;
  format?: 'compact' | 'markdown';
}

export interface ContextBundleResult {
  success: boolean;
  output: string;
  stats: {
    typesFound: number;
    calleesFound: number;
    testsFound: number;
    estimatedTokens: number;
  };
}

/**
 * Bundle related context for a symbol
 */
export async function bundleContext(
  indexer: Indexer,
  symbolName: string,
  filePath?: string,
  options: ContextBundlerOptions = {}
): Promise<ContextBundleResult> {
  const storage = indexer.getStorage();
  const rootDir = indexer.getRootDir();

  const includeTypes = options.includeTypes ?? true;
  const includeCallees = options.includeCallees ?? true;
  const includeTests = options.includeTests ?? false;  // Default to false to save tokens
  const calleeDepth = Math.min(options.calleeDepth ?? 1, 2);
  const format = options.format ?? 'markdown';

  // Create token budget (allocates more to other sections when tests excluded)
  const budget = createTokenBudget(options.maxTokens, includeTests);

  // Find the symbol
  const symbol = await findSymbol(storage, symbolName, filePath);
  if (!symbol) {
    return {
      success: false,
      output: `Symbol "${symbolName}" not found${filePath ? ` in ${filePath}` : ''}`,
      stats: { typesFound: 0, calleesFound: 0, testsFound: 0, estimatedTokens: 0 },
    };
  }

  // Get symbol source code
  const symbolSource = await getSymbolSource(symbol, indexer);
  const relativePath = path.relative(rootDir, symbol.location.filePath);

  // Initialize bundle data
  const bundleData: ContextBundleData = {
    symbol: {
      signature: symbol,
      source: symbolSource,
      filePath: symbol.location.filePath,
      relativePath,
    },
    types: [],
    callees: [],
    tests: [],
  };

  // Resolve types
  if (includeTypes) {
    const types = await resolveAllTypes(symbol, storage);
    for (const typeDef of types) {
      const source = await getTypeSource(typeDef, storage, rootDir);
      bundleData.types.push({ definition: typeDef, source });
    }
  }

  // Get callees
  if (includeCallees) {
    bundleData.callees = await getCallees(storage, indexer, symbol, calleeDepth);
  }

  // Discover tests
  if (includeTests) {
    const tests = await discoverTests(symbolName, storage, rootDir);
    for (const test of tests.slice(0, 5)) { // Limit to 5 tests
      const source = await getTestSource(test);
      bundleData.tests.push({ reference: test, source });
    }
  }

  // Format output
  const output = format === 'compact'
    ? formatContextBundleCompact(bundleData, rootDir, { includeTests })
    : formatContextBundle(bundleData, budget, rootDir, { includeTests });

  return {
    success: true,
    output,
    stats: {
      typesFound: bundleData.types.length,
      calleesFound: bundleData.callees.length,
      testsFound: bundleData.tests.length,
      estimatedTokens: Math.ceil(output.length / 4),
    },
  };
}

/**
 * Find a symbol by name and optionally file path
 */
async function findSymbol(
  storage: SqliteStorage,
  symbolName: string,
  filePath?: string
): Promise<FunctionSignature | null> {
  if (filePath) {
    // Try to get the function directly from the file
    const func = await storage.getFunction(filePath, symbolName);
    if (func) return func;
  }

  // Search for the symbol
  const results = await storage.searchSymbols(symbolName, {
    type: 'function',
    limit: 10,
  });

  // Filter to exact name matches
  const exactMatches = results.filter(r => r.symbol.name === symbolName);

  if (exactMatches.length === 0) {
    return null;
  }

  // If file path specified, find the one in that file
  if (filePath) {
    const inFile = exactMatches.find(r => r.symbol.filePath === filePath);
    if (inFile) {
      return storage.getFunction(inFile.symbol.filePath, inFile.symbol.name);
    }
  }

  // Return the first match
  const match = exactMatches[0]!;
  return storage.getFunction(match.symbol.filePath, match.symbol.name);
}

/**
 * Get source code for a symbol
 */
async function getSymbolSource(
  symbol: FunctionSignature,
  indexer: Indexer
): Promise<string> {
  try {
    const fs = await import('node:fs');
    const content = await fs.promises.readFile(symbol.location.filePath, 'utf-8');
    const lines = content.split('\n');

    const startIdx = Math.max(0, symbol.location.startLine - 1);
    const endIdx = Math.min(lines.length, symbol.location.endLine);

    return lines.slice(startIdx, endIdx).join('\n');
  } catch {
    return symbol.signature;
  }
}

/**
 * Get callees for a symbol
 */
async function getCallees(
  storage: SqliteStorage,
  indexer: Indexer,
  symbol: FunctionSignature,
  depth: number
): Promise<ContextBundleData['callees']> {
  const callees: ContextBundleData['callees'] = [];
  const seen = new Set<string>();

  async function collectCallees(symbolId: string, currentDepth: number): Promise<void> {
    if (currentDepth > depth) return;

    const edges = await storage.getCallees(symbolId);

    for (const edge of edges) {
      const key = `${edge.calleeName}:${edge.calleeSymbolId ?? 'unknown'}`;
      if (seen.has(key)) continue;
      seen.add(key);

      let signature: FunctionSignature | null = null;
      let source: string | null = null;

      if (edge.calleeSymbolId) {
        // Try to get the callee's signature
        const symbolInfo = await storage.getSymbolById(edge.calleeSymbolId);
        if (symbolInfo) {
          signature = await storage.getFunction(symbolInfo.filePath, symbolInfo.name);
          if (signature) {
            source = await getSymbolSource(signature, indexer);
          }
        }
      }

      callees.push({ edge, signature, source });

      // Recurse for deeper levels
      if (currentDepth < depth && edge.calleeSymbolId) {
        await collectCallees(edge.calleeSymbolId, currentDepth + 1);
      }
    }
  }

  await collectCallees(symbol.id, 1);

  return callees;
}

// Re-export components
export { resolveAllTypes, extractTypeNames, type TypeDefinition } from './type-resolver.js';
export { discoverTests, isTestFile, type TestReference, type TestFramework } from './test-discoverer.js';
export { formatContextBundle, formatContextBundleCompact, createTokenBudget, estimateTokens, type ContextBundleData, type TokenBudget } from './formatter.js';
