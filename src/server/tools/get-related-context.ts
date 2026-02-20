/**
 * MCP Tool: get_related_context - Smart context bundling for a symbol
 */

import type { Indexer } from '../../indexer/index.js';
import { bundleContext, type ContextBundlerOptions } from './context-bundler/index.js';
import { enforceOutputBudget } from './compact-format.js';

const DEFAULT_MAX_BYTES = 8000;

export interface GetRelatedContextInput {
  symbolName: string;
  filePath?: string;
  includeTypes?: boolean;
  includeCallees?: boolean;
  includeTests?: boolean;
  calleeDepth?: number;
  maxTokens?: number;
  format?: 'compact' | 'markdown';
}

export async function getRelatedContextTool(
  indexer: Indexer,
  input: GetRelatedContextInput
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const outputMode = input.format ?? 'compact';
  const options: ContextBundlerOptions = {
    includeTypes: input.includeTypes ?? true,
    includeCallees: input.includeCallees ?? true,
    includeTests: input.includeTests ?? false,
    calleeDepth: input.calleeDepth ?? 1,
    maxTokens: input.maxTokens,
    format: outputMode,
  };

  const result = await bundleContext(
    indexer,
    input.symbolName,
    input.filePath,
    options
  );

  if (!result.success) {
    return {
      content: [{
        type: 'text',
        text: result.output,
      }],
    };
  }

  if (outputMode === 'compact') {
    return {
      content: [{
        type: 'text',
        text: enforceOutputBudget(result.output, DEFAULT_MAX_BYTES),
      }],
    };
  }

  // Add stats summary
  let output = result.output;
  output += '\n\n---\n';
  output += `**Stats**: ${result.stats.typesFound} types, ${result.stats.calleesFound} callees, ${result.stats.testsFound} tests | ~${result.stats.estimatedTokens} tokens`;

  return {
    content: [{
      type: 'text',
      text: output,
    }],
  };
}
