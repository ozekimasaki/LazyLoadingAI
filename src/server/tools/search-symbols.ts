/**
 * search_symbols tool implementation
 */

import type { Indexer } from '../../indexer/index.js';
import type { Language, QueryOptions } from '../../types/index.js';
import { expandQuery, rerankResults } from '../../synonyms/index.js';
import { enforceOutputBudget, formatCompactTable } from './compact-format.js';

type MatchMode = 'exact' | 'base' | 'inner' | 'partial';
type SymbolType = 'function' | 'class' | 'interface' | 'type' | 'variable' | 'all';

interface TypeSearchResult {
  symbolId: string;
  symbolName: string;
  filePath: string;
  language: Language;
  returnType: string | null;
  paramCount: number;
  isMethod: boolean;
  parentClass: string | null;
  matchedParams?: Array<{ name: string; type: string; index: number }>;
}

interface QueryExpansion {
  original: string;
  expansions: Array<{ term: string; weight: number; source: 'original' | 'canonical' | 'synonym' }>;
  ftsQuery: string;
}

const DEFAULT_MAX_BYTES = 3000;

export interface SearchSymbolsInput {
  query?: string;
  type?: SymbolType;
  language?: Language;
  limit?: number;
  expand_synonyms?: boolean;
  return_type?: string;
  param_type?: string;
  match_mode?: MatchMode;
  verbose?: boolean;  // Default: false - compact output
  format?: 'compact' | 'markdown';
}

export async function searchSymbolsTool(
  indexer: Indexer,
  input: SearchSymbolsInput
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const query = normalizeOptionalText(input.query);
  const returnType = normalizeOptionalText(input.return_type);
  const paramType = normalizeOptionalText(input.param_type);

  if (!query && !returnType && !paramType) {
    return {
      content: [
        {
          type: 'text',
          text: 'Please provide at least one search criteria: `query`, `return_type`, or `param_type`.',
        },
      ],
    };
  }

  if (returnType || paramType) {
    return searchByType(indexer, {
      ...input,
      query,
      return_type: returnType,
      param_type: paramType,
    });
  }

  return searchByName(indexer, {
    ...input,
    query: query!,
  });
}

async function searchByName(
  indexer: Indexer,
  input: SearchSymbolsInput & { query: string }
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const outputMode = input.format ?? 'compact';
  const useSynonyms = input.expand_synonyms !== false;  // Default to true
  // Use a tighter default limit in compact mode to reduce response size for simple lookups
  const defaultLimit = outputMode === 'compact' ? 10 : 20;
  const requestedLimit = input.limit ?? defaultLimit;

  const expansion = buildQueryExpansion(input.query, useSynonyms);

  const searchLimit = useSynonyms ? Math.max(requestedLimit * 2, 50) : requestedLimit;
  const options: QueryOptions = {
    type: input.type,
    language: input.language,
    limit: searchLimit,
  };

  const searchQuery = useSynonyms ? expansion.ftsQuery : input.query;
  const results = await indexer.searchSymbols(searchQuery, options);

  if (results.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: `No matches for \`${input.query}\`. Try different term or check index.`,
        },
      ],
    };
  }

  let finalResults: Array<{ symbol: typeof results[0]['symbol']; score: number; matchedTerms?: string[] }>;

  if (useSynonyms && results.length > 0) {
    const reranked = rerankResults(
      results,
      expansion,
      (item) => `${item.symbol.name} ${item.symbol.signature}`,
      (item, _index) => item.score
    );

    finalResults = reranked
      .slice(0, requestedLimit)
      .map(r => ({
        symbol: r.item.symbol,
        score: r.combinedScore,
        matchedTerms: r.matchedTerms.map(m => m.term),
      }));
  } else {
    finalResults = results.slice(0, requestedLimit).map(r => ({
      symbol: r.symbol,
      score: r.score,
    }));
  }

  if (outputMode === 'compact') {
    const output = enforceOutputBudget(formatNameSearchCompact(finalResults), DEFAULT_MAX_BYTES);
    return {
      content: [
        {
          type: 'text',
          text: output,
        },
      ],
    };
  }

  const verbose = input.verbose ?? false;
  let output = `# Search Results for "${input.query}"\n\n`;

  if (useSynonyms && expansion.expansions.length > 1) {
    const synonymTerms = expansion.expansions
      .filter(e => e.source !== 'original')
      .slice(0, 8)
      .map(e => `\`${e.term}\` (${Math.round(e.weight * 100)}%)`);
    if (synonymTerms.length > 0) {
      output += `**Expanded with synonyms**: ${synonymTerms.join(', ')}\n\n`;
    }
  }

  output += `Found ${finalResults.length} matching symbols\n\n`;
  output += formatNameSearchResults(finalResults, verbose);
  output += buildSearchTip(finalResults.length, verbose);

  return {
    content: [
      {
        type: 'text',
        text: output,
      },
    ],
  };
}

async function searchByType(
  indexer: Indexer,
  input: SearchSymbolsInput & {
    query?: string;
    return_type?: string;
    param_type?: string;
  }
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const outputMode = input.format ?? 'compact';
  if (input.type && input.type !== 'all' && input.type !== 'function') {
    return {
      content: [
        {
          type: 'text',
          text: 'Type-based search only supports `type: "function"` or `type: "all"`.',
        },
      ],
    };
  }

  const defaultLimit = outputMode === 'compact' ? 10 : 20;
  const requestedLimit = input.limit ?? defaultLimit;
  const nameFilter = input.query?.toLowerCase();
  const storageLimit = nameFilter ? Math.max(requestedLimit * 3, 60) : requestedLimit;
  const matchMode = input.match_mode ?? 'base';

  const storage = indexer.getStorage();
  const rawResults = await storage.searchByType({
    returnType: input.return_type,
    paramType: input.param_type,
    matchMode,
    includeAsyncVariants: true,
    includeNullableVariants: true,
    language: input.language,
    limit: storageLimit,
  });

  const filteredResults = nameFilter
    ? rawResults.filter(result => matchesTypeSearchNameFilter(result, nameFilter))
    : rawResults;
  const results = filteredResults.slice(0, requestedLimit);

  if (results.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: buildTypeSearchNoResultsMessage(input),
        },
      ],
    };
  }

  if (outputMode === 'compact') {
    const output = enforceOutputBudget(formatTypeSearchCompact(results), DEFAULT_MAX_BYTES);
    return {
      content: [
        {
          type: 'text',
          text: output,
        },
      ],
    };
  }

  const verbose = input.verbose ?? false;
  let output = '# Type-Based Search Results\n\n';
  const criteria: string[] = [];
  if (input.return_type) criteria.push(`Returns: \`${input.return_type}\``);
  if (input.param_type) criteria.push(`Accepts: \`${input.param_type}\``);
  if (input.query) criteria.push(`Name contains: \`${input.query}\``);

  output += `**Search Criteria**: ${criteria.join(' | ')}\n`;
  output += `**Match Mode**: ${matchMode}\n`;
  output += `**Found**: ${results.length} function(s)\n\n`;
  output += formatTypeSearchResults(results, verbose);
  output += buildSearchTip(results.length, verbose);

  return {
    content: [
      {
        type: 'text',
        text: output,
      },
    ],
  };
}

function normalizeOptionalText(value?: string): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function buildQueryExpansion(query: string, useSynonyms: boolean): QueryExpansion {
  const fallbackExpansion: QueryExpansion = {
    original: query,
    expansions: [{ term: query.toLowerCase(), weight: 1.0, source: 'original' }],
    ftsQuery: `${query.toLowerCase()}*`,
  };

  if (!useSynonyms) {
    return fallbackExpansion;
  }

  const expanded = expandQuery(query);
  if (expanded.expansions.length === 0 || expanded.ftsQuery.trim().length === 0) {
    return fallbackExpansion;
  }

  return expanded;
}

function formatNameSearchResults(
  results: Array<{ symbol: { name: string; kind: string; signature: string; filePath: string; line: number }; matchedTerms?: string[] }>,
  verbose: boolean
): string {
  let output = '';

  if (verbose) {
    const byFile = new Map<string, typeof results>();
    for (const result of results) {
      const filePath = result.symbol.filePath;
      if (!byFile.has(filePath)) {
        byFile.set(filePath, []);
      }
      byFile.get(filePath)!.push(result);
    }

    for (const [filePath, fileResults] of byFile) {
      output += `## ${filePath}\n\n`;

      for (const result of fileResults) {
        const { symbol, matchedTerms } = result;

        output += `### ${symbol.name}\n`;
        output += `- **Kind**: ${symbol.kind}\n`;
        output += `- **Line**: ${symbol.line}\n`;
        if (matchedTerms && matchedTerms.length > 0) {
          output += `- **Matched**: ${matchedTerms.join(', ')}\n`;
        }
        output += '\n**Signature**:\n';
        output += '```\n';
        output += symbol.signature + '\n';
        output += '```\n\n';
      }
    }
    return output;
  }

  output += '| Symbol | Kind | File | Line |\n';
  output += '|--------|------|------|------|\n';

  for (const result of results) {
    const { symbol } = result;
    const fileName = symbol.filePath.split('/').pop() ?? symbol.filePath;
    output += `| \`${escapeMarkdownTableCell(symbol.name)}\` | ${escapeMarkdownTableCell(symbol.kind)} | ${escapeMarkdownTableCell(fileName)} | ${symbol.line} |\n`;
  }

  output += '\n';
  return output;
}

function formatTypeSearchResults(results: TypeSearchResult[], verbose: boolean): string {
  let output = '';

  if (verbose) {
    const byFile = new Map<string, TypeSearchResult[]>();
    for (const result of results) {
      if (!byFile.has(result.filePath)) {
        byFile.set(result.filePath, []);
      }
      byFile.get(result.filePath)!.push(result);
    }

    for (const [filePath, fileResults] of byFile) {
      output += `## ${filePath}\n\n`;
      for (const result of fileResults) {
        const name = formatTypeResultName(result);
        output += `### ${name}\n`;
        output += `- **Returns**: \`${result.returnType ?? 'void'}\`\n`;
        output += `- **Parameters**: ${result.paramCount}\n`;
        if (result.matchedParams && result.matchedParams.length > 0) {
          output += '- **Matched Parameters**:\n';
          for (const param of result.matchedParams) {
            output += `  - \`${param.name}\`: \`${param.type}\` (position ${param.index + 1})\n`;
          }
        }
        output += '\n';
      }
    }
    return output;
  }

  output += '| Function | Returns | Matched Params | File |\n';
  output += '|----------|---------|----------------|------|\n';
  for (const result of results) {
    const fileName = result.filePath.split('/').pop() ?? result.filePath;
    const matchedParams = result.matchedParams && result.matchedParams.length > 0
      ? result.matchedParams.map(p => `${p.name}: ${p.type}`).join(', ')
      : '-';
    output += `| \`${escapeMarkdownTableCell(formatTypeResultName(result))}\` | \`${escapeMarkdownTableCell(result.returnType ?? 'void')}\` | ${escapeMarkdownTableCell(matchedParams)} | ${escapeMarkdownTableCell(fileName)} |\n`;
  }
  output += '\n';

  return output;
}

function formatTypeResultName(result: TypeSearchResult): string {
  if (result.isMethod && result.parentClass) {
    return `${result.parentClass}.${result.symbolName}`;
  }
  if (result.isMethod) {
    return `(method) ${result.symbolName}`;
  }
  return result.symbolName;
}

function matchesTypeSearchNameFilter(result: TypeSearchResult, nameFilter: string): boolean {
  const terms = nameFilter.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;

  const searchableParts: string[] = [
    result.symbolName,
    result.parentClass ?? '',
    result.returnType ?? '',
    result.filePath,
  ];

  if (result.matchedParams && result.matchedParams.length > 0) {
    for (const param of result.matchedParams) {
      searchableParts.push(param.name, param.type);
    }
  }

  const haystack = searchableParts.join(' ').toLowerCase();
  return terms.every(term => haystack.includes(term));
}

function buildTypeSearchNoResultsMessage(input: SearchSymbolsInput & {
  query?: string;
  return_type?: string;
  param_type?: string;
}): string {
  const criteria: string[] = [];
  if (input.return_type) criteria.push(`return type "${input.return_type}"`);
  if (input.param_type) criteria.push(`parameter type "${input.param_type}"`);
  if (input.query) criteria.push(`name filter "${input.query}"`);

  const criteriaText = criteria.length > 0
    ? criteria.join(' and ')
    : 'the provided criteria';

  return `No functions found with ${criteriaText}\n\nTry:\n- Using a different match mode (base, inner, partial)\n- Checking type names and query spelling\n- Removing the name filter for broader results\n- Using simple type names without complex generic wrappers`;
}

function buildSearchTip(resultCount: number, verbose: boolean): string {
  if (resultCount < 3) {
    return '---\nUse `get_function` or `get_class` to retrieve full implementation.\n';
  }
  if (!verbose) {
    return '---\nUse `verbose: true` to see full signatures.\n';
  }
  return '';
}

function escapeMarkdownTableCell(value: string): string {
  return value
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ')
    .trim();
}

function formatNameSearchCompact(
  results: Array<{ symbol: { name: string; kind: string; signature: string; filePath: string; line: number }; score: number }>
): string {
  const records = results.map(result => ({
    name: result.symbol.name,
    kind: result.symbol.kind,
    file: result.symbol.filePath,
    line: result.symbol.line,
    score: formatScore(result.score),
    signature: normalizeCompactSignature(result.symbol.signature),
  }));

  return formatCompactTable(records, {
    columns: ['name', 'kind', 'file', 'line', 'score', 'signature'],
  });
}

function formatTypeSearchCompact(results: TypeSearchResult[]): string {
  const records = results.map(result => ({
    name: formatTypeResultName(result),
    kind: result.isMethod ? 'method' : 'function',
    file: result.filePath,
    line: '',
    score: '',
    signature: buildTypeResultSignature(result),
  }));

  return formatCompactTable(records, {
    columns: ['name', 'kind', 'file', 'line', 'score', 'signature'],
  });
}

function formatScore(score: number): string {
  if (!Number.isFinite(score)) return '';
  const rounded = Math.round(score * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function normalizeCompactSignature(signature: string): string {
  return signature.replace(/\s+/g, ' ').trim();
}

function buildTypeResultSignature(result: TypeSearchResult): string {
  const returnType = result.returnType ?? 'void';
  const params = result.paramCount === 1 ? '1 param' : `${result.paramCount} params`;
  return `${result.symbolName}(${params}): ${returnType}`;
}
