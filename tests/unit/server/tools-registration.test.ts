import { describe, it, expect, vi } from 'vitest';
import { registerTools } from '../../../src/server/tools/index.js';

const EXPECTED_TOOL_NAMES = [
  'find_references',
  'get_architecture_overview',
  'get_class',
  'get_function',
  'get_module_dependencies',
  'get_related_context',
  'list_files',
  'list_functions',
  'search_symbols',
  'suggest_related',
  'sync_index',
  'trace_calls',
  'trace_types',
];

const REMOVED_TOOL_NAMES = [
  'get_file_summary',
  'get_public_api',
  'search_by_type',
  'find_functions_returning',
  'find_functions_accepting',
  'get_callers',
  'get_callees',
  'get_type_hierarchy',
  'find_implementations',
  'rebuild_markov',
  'get_markov_stats',
  'get_config_value',
  'search_config',
  'list_config_files',
  'explain_dependency_path',
];

describe('server/tools/registerTools', () => {
  it('registers all expected tools on the MCP server', () => {
    const registered: Array<{
      name: string;
      description: string;
      schema: Record<string, { parse: (value: unknown) => unknown }>;
      handler: (input: Record<string, unknown>) => Promise<{ content?: Array<{ text?: string }> }>;
    }> = [];
    const fakeServer = {
      tool: (name: string, description: string, schema: unknown, _opts: unknown, handler: (input: Record<string, unknown>) => Promise<{ content?: Array<{ text?: string }> }>) => {
        registered.push({ name, description, schema: schema as Record<string, { parse: (value: unknown) => unknown }>, handler });
      },
    } as any;

    // Minimal indexer stub; handlers won't be invoked in this test
    const fakeIndexer = {} as any;

    registerTools(fakeServer, fakeIndexer);

    const toolNames = registered.map(t => t.name).sort();
    expect(toolNames).toEqual([...EXPECTED_TOOL_NAMES].sort());

    for (const removedToolName of REMOVED_TOOL_NAMES) {
      expect(toolNames).not.toContain(removedToolName);
    }

    const suggestRelated = registered.find(t => t.name === 'suggest_related');
    expect(suggestRelated?.description).toContain('already found one relevant symbol');
    expect(suggestRelated?.description).toContain('discover adjacent code');

    const listFiles = registered.find(t => t.name === 'list_files');
    expect(listFiles?.schema.format.parse(undefined)).toBe('compact');

    const getArchitectureOverview = registered.find(t => t.name === 'get_architecture_overview');
    expect(getArchitectureOverview?.schema.format.parse(undefined)).toBe('compact');

    expect(toolNames).not.toContain('ask_codebase');
  });

  it('enforces explore/synthesize/finalize tool-call control', async () => {
    const registered: Array<{
      name: string;
      handler: (input: Record<string, unknown>) => Promise<{ content?: Array<{ text?: string }> }>;
    }> = [];

    const fakeServer = {
      tool: (
        name: string,
        _description: string,
        _schema: unknown,
        _opts: unknown,
        handler: (input: Record<string, unknown>) => Promise<{ content?: Array<{ text?: string }> }>
      ) => {
        registered.push({ name, handler });
      },
    } as any;

    const listFilesSpy = vi.fn(async () => [
        {
          relativePath: 'src/example.ts',
          language: 'typescript',
          lineCount: 10,
          functions: [],
          classes: [],
        },
      ]);
    const fakeIndexer = {
      listFiles: listFilesSpy,
    } as any;

    registerTools(fakeServer, fakeIndexer);
    const listFiles = registered.find(tool => tool.name === 'list_files');
    expect(listFiles).toBeDefined();

    for (let i = 1; i <= 8; i += 1) {
      const result = await listFiles!.handler({ directory: `src/novel-${i}` });
      expect(result.content?.[0]?.text).not.toContain('[Note:');
      expect(result.content?.[0]?.text).not.toContain('[Warning:');
      expect(result.content?.[0]?.text).not.toContain('[LazyLoadingAI BUDGET EXHAUSTED]');
    }

    const ninthResult = await listFiles!.handler({ directory: 'src/novel-9' });
    expect(ninthResult.content?.[0]?.text).toContain('[Note: 9 unique lookups across 9 total calls.');

    await listFiles!.handler({ directory: 'src/novel-10' });
    await listFiles!.handler({ directory: 'src/novel-11' });
    await listFiles!.handler({ directory: 'src/novel-12' });

    const thirteenthResult = await listFiles!.handler({ directory: 'src/novel-13' });
    expect(thirteenthResult.content?.[0]?.text).toContain('[Warning: 13 unique lookups across 13 total calls.');

    await listFiles!.handler({ directory: 'src/novel-14' });
    await listFiles!.handler({ directory: 'src/novel-15' });

    const sixteenthResult = await listFiles!.handler({ directory: 'src/novel-16' });
    expect(sixteenthResult.content?.[0]?.text).toContain('[LazyLoadingAI BUDGET EXHAUSTED]');
    expect(sixteenthResult.content?.[0]?.text).toContain('16 unique lookups across 16 total calls');

    const seventeenthResult = await listFiles!.handler({ directory: 'src/novel-17' });
    expect(seventeenthResult.content?.[0]?.text).toContain('[LazyLoadingAI BUDGET EXHAUSTED]');
    expect(seventeenthResult.content?.[0]?.text).toContain('17 unique lookups across 17 total calls');
    expect(listFilesSpy).toHaveBeenCalledTimes(15);
  });
});
