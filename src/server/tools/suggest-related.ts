/**
 * suggest_related tool implementation
 * Find related symbols using Markov chain analysis
 */

import type { Indexer } from '../../indexer/index.js';
import { queryWithFallback } from '../../markov/index.js';
import type { ChainType, MarkovQueryOptions } from '../../markov/types.js';
import { enforceOutputBudget, formatCompactTable } from './compact-format.js';

export interface SuggestRelatedInput {
  symbol_name: string;
  file_path?: string;
  chain_types?: ChainType[];
  depth?: number;
  min_probability?: number;
  limit?: number;
  explain?: boolean;
  format?: 'compact' | 'markdown';
}

const DEFAULT_MAX_BYTES = 3000;

export async function suggestRelatedTool(
  indexer: Indexer,
  input: SuggestRelatedInput
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const outputMode = input.format ?? 'compact';
  const storage = indexer.getStorage();

  const options: MarkovQueryOptions = {
    chainTypes: input.chain_types ?? ['call_flow', 'cooccurrence'],
    depth: input.depth ?? 2,
    minProbability: input.min_probability ?? 0.05,
    maxResults: input.limit ?? 20,
    explain: input.explain ?? false,
  };

  const result = await queryWithFallback(storage, input.symbol_name, input.file_path, options);

  if (result.suggestions.length === 0) {
    let msg = `No related symbols found for "${input.symbol_name}"`;

    if (result.chainsUsed.length === 0) {
      const getAllChainStats = (storage as {
        getAllChainStats?: () => Promise<Array<{ totalTransitions: number }>>;
      }).getAllChainStats;

      if (typeof getAllChainStats === 'function') {
        const chainStats = await getAllChainStats.call(storage);
        const totalTransitions = chainStats.reduce((sum, stat) => sum + stat.totalTransitions, 0);

        if (chainStats.length === 0) {
          msg += '\n\nNo Markov chains have been built yet. Run `sync_index` with `rebuild_chains: true` to build the chains.';
        } else if (totalTransitions === 0) {
          msg += '\n\nMarkov chains exist but currently have no transitions. This can happen in very small codebases or before relationship-rich code is indexed.';
        } else {
          msg += '\n\nMarkov chains are built, but this symbol has no transitions in the selected chains.';
        }
      } else {
        msg += '\n\nNo Markov chains have been built yet. Run `sync_index` with `rebuild_chains: true` to build the chains.';
      }
    } else {
      msg += `\n\nChains searched: ${result.chainsUsed.join(', ')}`;
    }

    msg += '\n\nTry:\n- Checking the symbol name spelling';
    msg += '\n- Using `find_references` or `trace_calls` (`direction: "callers"`) for direct relationships';
    msg += '\n- Rebuilding chains if the codebase has changed';

    return {
      content: [
        {
          type: 'text',
          text: msg,
        },
      ],
    };
  }

  if (outputMode === 'compact') {
    const rows = result.suggestions.map((suggestion) => ({
      symbol: suggestion.symbolName,
      score: Number(suggestion.score.toFixed(4)),
      file: suggestion.filePath ?? '',
      chain: suggestion.path.join(' -> '),
    }));
    const compactOutput = enforceOutputBudget(
      formatCompactTable(rows, {
        columns: ['symbol', 'score', 'file', 'chain'],
      }),
      DEFAULT_MAX_BYTES
    );

    return {
      content: [
        {
          type: 'text',
          text: compactOutput,
        },
      ],
    };
  }

  let output = `# Related Symbols for "${result.startSymbol}"\n\n`;

  // Show source of results
  if (result.fallbackUsed) {
    output += `**Source**: Direct references (${result.fallbackType})\n`;
  } else {
    output += `**Chains used**: ${result.chainsUsed.join(', ')}\n`;
  }
  output += `**Search depth**: ${options.depth}\n`;
  output += `**Found**: ${result.suggestions.length} related symbol(s)\n`;
  output += `**Execution time**: ${result.executionTimeMs}ms\n\n`;

  // Group by depth
  const byDepth = new Map<number, typeof result.suggestions>();
  for (const suggestion of result.suggestions) {
    if (!byDepth.has(suggestion.depth)) {
      byDepth.set(suggestion.depth, []);
    }
    byDepth.get(suggestion.depth)!.push(suggestion);
  }

  for (const [depth, suggestions] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
    output += `## ${depth === 1 ? 'Directly Related' : `${depth} Hops Away`}\n\n`;

    output += '| Symbol | Score | Path | File |\n';
    output += '|--------|-------|------|------|\n';

    for (const s of suggestions) {
      const scorePercent = (s.score * 100).toFixed(1);
      const pathStr = s.path.length > 3
        ? `${s.path[0]} → ... → ${s.path[s.path.length - 1]}`
        : s.path.join(' → ');
      const fileStr = s.filePath ? s.filePath.split('/').pop() : '-';

      output += `| \`${s.symbolName}\` | ${scorePercent}% | ${pathStr} | ${fileStr} |\n`;
    }

    output += '\n';
  }

  // Show explanations if requested
  if (input.explain) {
    output += '## Explanations\n\n';
    for (const s of result.suggestions.slice(0, 5)) {
      if (s.explanation) {
        output += `### ${s.symbolName}\n`;
        output += `${s.explanation}\n\n`;
      }
    }
  }

  output += '---\n\n';
  output += '**Tip**: Use `get_function` or `get_class` to retrieve the full implementation of any suggested symbol.\n';
  output += '**Note**: Suggestions are based on learned patterns from call graphs, co-occurrence, and type relationships.\n';

  return {
    content: [
      {
        type: 'text',
        text: output,
      },
    ],
  };
}
