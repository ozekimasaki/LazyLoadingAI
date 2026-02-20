/**
 * MCP Tool registration
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Indexer } from '../../indexer/index.js';
import { findReferencesTool } from './find-references.js';
import { getArchitectureOverviewTool } from './get-architecture-overview.js';
import { getClassTool } from './get-class.js';
import { getFunctionTool } from './get-function.js';
import { getModuleDependenciesTool } from './get-module-dependencies.js';
import { getRelatedContextTool } from './get-related-context.js';
import { listFilesTool } from './list-files.js';
import { listFunctionsTool } from './list-functions.js';
import { searchSymbolsTool } from './search-symbols.js';
import { suggestRelatedTool } from './suggest-related.js';
import { syncIndexTool } from './sync-index.js';
import { createToolCallAwarenessWrapper } from './tool-call-awareness.js';
import { traceCallsTool } from './trace-calls.js';
import { traceTypesTool } from './trace-types.js';

const responseFormatSchema = z.enum(['compact', 'markdown']).optional().default('compact')
  .describe('Response format');

export function registerTools(server: McpServer, indexer: Indexer): void {
  const withToolCallAwareness = createToolCallAwarenessWrapper();

  server.tool(
    'list_files',
    'Browse indexed files and directory structure. Use this first to orient in the codebase.',
    {
      directory: z.string().optional().describe('Filter to files in this directory (relative or absolute path)'),
      recursive: z.boolean().optional().default(true).describe('Include files in subdirectories'),
      language: z.enum(['typescript', 'javascript', 'python']).optional().describe('Filter by programming language'),
      limit: z.number().optional().default(50).describe('Maximum number of files to return'),
      offset: z.number().optional().default(0).describe('Skip first N files for pagination'),
      exclude_patterns: z.array(z.string()).optional().describe('Glob patterns to exclude (e.g., "**/generated/**")'),
      include_tests: z.boolean().optional().default(false).describe('Include test files (excluded by default)'),
      summary_only: z.boolean().optional().default(false).describe('Return directory-level counts instead of file details'),
      format: responseFormatSchema,
    },
    { title: 'Peek Files' },
    withToolCallAwareness(async ({ directory, recursive, language, limit, offset, exclude_patterns, include_tests, summary_only, format }) => {
      return listFilesTool(indexer, {
        directory,
        recursive,
        language,
        limit,
        offset,
        exclude_patterns,
        include_tests,
        summary_only,
        format,
      });
    }, 'list_files')
  );

  server.tool(
    'list_functions',
    'List function/method signatures in a file. Optionally include top-ranked implementations inline for large-file exploration.',
    {
      file_path: z.string().describe('Path to the source file'),
      include_private: z.boolean().optional().default(false).describe('Include private functions/methods'),
      include_source: z.boolean().optional().default(false).describe('Include source for top-ranked exported implementations (budgeted output)'),
      format: responseFormatSchema,
    },
    { title: 'Peek Signatures' },
    withToolCallAwareness(async ({ file_path, include_private, include_source, format }) => {
      return listFunctionsTool(indexer, {
        filePath: file_path,
        includePrivate: include_private,
        includeSource: include_source,
        format,
      });
    }, 'list_functions')
  );

  server.tool(
    'get_function',
    'Get the full source code for a function or method.',
    {
      file_path: z.string().describe('Path to the source file'),
      function_name: z.string().describe('Name of the function or method to retrieve'),
      include_context: z.boolean().optional().default(false).describe('Include surrounding context lines'),
      context_lines: z.number().optional().default(3).describe('Context lines before and after the function'),
      format: responseFormatSchema,
    },
    { title: 'Hydrate Function' },
    withToolCallAwareness(async ({ file_path, function_name, include_context, context_lines, format }) => {
      return getFunctionTool(indexer, {
        filePath: file_path,
        functionName: function_name,
        includeContext: include_context,
        contextLines: context_lines,
        format,
      });
    }, 'get_function')
  );

  server.tool(
    'get_class',
    'Get the full source code for a class or interface.',
    {
      file_path: z.string().describe('Path to the source file'),
      class_name: z.string().describe('Name of the class or interface to retrieve'),
      methods_only: z.boolean().optional().default(false).describe('Return signatures only without full implementations'),
      include_context: z.boolean().optional().default(false).describe('Include surrounding context lines'),
      format: responseFormatSchema,
    },
    { title: 'Hydrate Class' },
    withToolCallAwareness(async ({ file_path, class_name, methods_only, include_context, format }) => {
      return getClassTool(indexer, {
        filePath: file_path,
        className: class_name,
        methodsOnly: methods_only,
        includeContext: include_context,
        format,
      });
    }, 'get_class')
  );

  server.tool(
    'search_symbols',
    'Search symbols by name and/or function type signatures. Provide at least one of query, return_type, or param_type.',
    {
      query: z.string().optional().describe('Name/text query for fuzzy symbol search'),
      return_type: z.string().optional().describe('Return type filter (e.g., "User", "Promise<string>")'),
      param_type: z.string().optional().describe('Parameter type filter (e.g., "Request", "string")'),
      match_mode: z.enum(['exact', 'base', 'inner', 'partial']).optional().default('base').describe('Type matching strategy for return_type/param_type'),
      type: z.enum(['function', 'class', 'interface', 'type', 'variable', 'all']).optional().default('all').describe('Filter by symbol type'),
      language: z.enum(['typescript', 'javascript', 'python']).optional().describe('Filter by programming language'),
      limit: z.number().optional().default(20).describe('Maximum number of results'),
      expand_synonyms: z.boolean().optional().default(true).describe('Expand name query with synonyms'),
      verbose: z.boolean().optional().default(false).describe('Show full signatures instead of compact table output'),
      format: responseFormatSchema,
    },
    { title: 'Search' },
    withToolCallAwareness(async ({
      query,
      return_type,
      param_type,
      match_mode,
      type,
      language,
      limit,
      expand_synonyms,
      verbose,
      format,
    }) => {
      return searchSymbolsTool(indexer, {
        query,
        return_type,
        param_type,
        match_mode,
        type,
        language,
        limit,
        expand_synonyms,
        verbose,
        format,
      });
    }, 'search_symbols')
  );

  server.tool(
    'find_references',
    'Find usages of a symbol across the codebase.',
    {
      symbol_name: z.string().describe('Name of the symbol to find references for'),
      file_path: z.string().optional().describe('Optional file filter for references'),
      limit: z.number().optional().default(50).describe('Maximum number of references'),
      format: responseFormatSchema,
    },
    { title: 'Find References' },
    withToolCallAwareness(async ({ symbol_name, file_path, limit, format }) => {
      return findReferencesTool(indexer, {
        symbolName: symbol_name,
        filePath: file_path,
        limit,
        format,
      });
    }, 'find_references')
  );

  server.tool(
    'trace_calls',
    'Trace callers and/or callees for a function in a single tool.',
    {
      function_name: z.string().describe('Function name to trace'),
      direction: z.enum(['callers', 'callees', 'both']).optional().default('both').describe('Trace incoming, outgoing, or both directions'),
      file_path: z.string().optional().describe('Optional file filter to disambiguate'),
      depth: z.number().int().min(1).max(3).optional().default(1).describe('Traversal depth for call chains (1-3)'),
      format: responseFormatSchema,
    },
    { title: 'Trace Calls' },
    withToolCallAwareness(async ({ function_name, direction, file_path, depth, format }) => {
      return traceCallsTool(indexer, {
        functionName: function_name,
        direction,
        filePath: file_path,
        depth,
        format,
      });
    }, 'trace_calls')
  );

  server.tool(
    'trace_types',
    'Trace inheritance hierarchy or implementations for a class/interface.',
    {
      class_name: z.string().describe('Class or interface name to trace'),
      mode: z.enum(['hierarchy', 'implementations']).optional().default('hierarchy').describe('Hierarchy traversal or implementation lookup'),
      file_path: z.string().optional().describe('Optional file filter to disambiguate'),
      direction: z.enum(['up', 'down', 'both']).optional().default('both').describe('Hierarchy direction (used when mode is hierarchy)'),
      limit: z.number().int().min(1).max(500).optional().default(50).describe('Result limit (used when mode is implementations)'),
      format: responseFormatSchema,
    },
    { title: 'Trace Types' },
    withToolCallAwareness(async ({ class_name, mode, file_path, direction, limit, format }) => {
      return traceTypesTool(indexer, {
        className: class_name,
        mode,
        filePath: file_path,
        direction,
        limit,
        format,
      });
    }, 'trace_types')
  );

  server.tool(
    'suggest_related',
    'Suggest related symbols using learned code relationships. Use this when you already found one relevant symbol and want to discover adjacent code you did not know to search for.',
    {
      symbol_name: z.string().describe('Name of the symbol to find related symbols for'),
      file_path: z.string().optional().describe('File path to disambiguate duplicate symbol names'),
      chain_types: z.array(z.enum(['call_flow', 'cooccurrence', 'type_affinity', 'import_cluster'])).optional().describe('Markov chains to query'),
      depth: z.number().min(1).max(5).optional().default(2).describe('How many hops to traverse (1-5)'),
      min_probability: z.number().min(0).max(1).optional().default(0.05).describe('Minimum probability threshold'),
      limit: z.number().optional().default(20).describe('Maximum number of suggestions'),
      explain: z.boolean().optional().default(false).describe('Include explanation text for suggestions'),
      format: responseFormatSchema,
    },
    { title: 'Suggest Related' },
    withToolCallAwareness(async ({ symbol_name, file_path, chain_types, depth, min_probability, limit, explain, format }) => {
      return suggestRelatedTool(indexer, {
        symbol_name,
        file_path,
        chain_types,
        depth,
        min_probability,
        limit,
        explain,
        format,
      });
    }, 'suggest_related')
  );

  server.tool(
    'get_related_context',
    'Bundle source, types, callees, and tests for a symbol into one contextual response.',
    {
      symbol_name: z.string().describe('Name of the function/method to analyze'),
      file_path: z.string().optional().describe('Optional file path to disambiguate'),
      include_types: z.boolean().optional().default(true).describe('Include referenced type definitions'),
      include_callees: z.boolean().optional().default(true).describe('Include called functions'),
      include_tests: z.boolean().optional().default(false).describe('Include related tests'),
      callee_depth: z.number().int().min(1).max(2).optional().default(1).describe('Depth of callee traversal (1-2)'),
      max_tokens: z.number().optional().describe('Maximum token budget for output'),
      format: responseFormatSchema,
    },
    { title: 'Hydrate Context' },
    withToolCallAwareness(async ({ symbol_name, file_path, include_types, include_callees, include_tests, callee_depth, max_tokens, format }) => {
      return getRelatedContextTool(indexer, {
        symbolName: symbol_name,
        filePath: file_path,
        includeTypes: include_types,
        includeCallees: include_callees,
        includeTests: include_tests,
        calleeDepth: callee_depth,
        maxTokens: max_tokens,
        format,
      });
    }, 'get_related_context')
  );

  server.tool(
    'get_architecture_overview',
    'Get a high-level architecture map of the entire codebase: modules, dependency edges, entry points, and public API. Use this for broad architectural questions, NOT for finding specific functions or classes (use search_symbols or get_function instead).',
    {
      focus: z.enum(['full', 'modules', 'entry_points', 'dependencies', 'public_api', 'patterns', 'core_classes']).optional().default('modules').describe('Restrict output to one architecture section'),
      max_depth: z.number().optional().default(2).describe('Reserved depth parameter for dependency expansion'),
      entry_file: z.string().optional().describe('Optional entry file override for public API extraction'),
      include_types: z.boolean().optional().default(true).describe('Include interfaces and type aliases in public API output'),
      group_by: z.enum(['kind', 'file']).optional().default('kind').describe('Public API grouping mode'),
      format: responseFormatSchema,
    },
    { title: 'Architecture' },
    withToolCallAwareness(async ({ focus, max_depth, entry_file, include_types, group_by, format }) => {
      return getArchitectureOverviewTool(indexer, {
        focus,
        max_depth,
        entry_file,
        include_types,
        group_by,
        format,
      });
    }, 'get_architecture_overview')
  );

  server.tool(
    'get_module_dependencies',
    'Show the dependency graph for a module including direct imports, reverse imports, and optional transitive/cycle analysis.',
    {
      file_path: z.string().describe('Path to the file to analyze'),
      depth: z.number().int().min(1).max(5).optional().default(1).describe('Dependency traversal depth (1-5)'),
      include_reverse: z.boolean().optional().default(true).describe('Include modules that import this file'),
      include_external: z.boolean().optional().default(true).describe('Include external package imports'),
      include_type_only: z.boolean().optional().default(true).describe('Include type-only imports'),
      detect_cycles: z.boolean().optional().default(false).describe('Detect circular dependencies'),
      output_format: z.enum(['tree', 'list']).optional().default('tree').describe('Dependency output format'),
      format: responseFormatSchema,
    },
    { title: 'Trace Dependencies' },
    withToolCallAwareness(async ({ file_path, depth, include_reverse, include_external, include_type_only, detect_cycles, output_format, format }) => {
      return getModuleDependenciesTool(indexer, {
        filePath: file_path,
        depth,
        includeReverse: include_reverse,
        includeExternal: include_external,
        includeTypeOnly: include_type_only,
        detectCycles: detect_cycles,
        outputFormat: output_format,
        format,
      });
    }, 'get_module_dependencies')
  );

  server.tool(
    'sync_index',
    'Sync the index after edits. Optionally rebuild relationship chains in the same call.',
    {
      files: z.array(z.string()).optional().describe('Specific modified files; omit for full incremental sync'),
      rebuild_chains: z.boolean().optional().default(false).describe('Rebuild Markov chains after sync'),
    },
    { title: 'Sync Index' },
    withToolCallAwareness(async ({ files, rebuild_chains }) => {
      return syncIndexTool(indexer, { files, rebuild_chains });
    }, 'sync_index')
  );
}
