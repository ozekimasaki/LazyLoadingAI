import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

// Mock MCP SDK before importing the server module
vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  class MockMcpServer {
    static lastInstance: any;
    name: string;
    version: string;
    tools: any[] = [];
    connect = vi.fn().mockResolvedValue(undefined);
    constructor(opts: any) {
      this.name = opts.name;
      this.version = opts.version;
      (MockMcpServer as any).lastInstance = this;
    }
    tool(name: string, _desc: string, _schema: any, _meta: any, _handler: any) {
      this.tools.push({ name });
    }
  }
  return { McpServer: MockMcpServer };
});

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => {
  class StdioServerTransport {}
  return { StdioServerTransport };
});

// Defer import until after mocks are in place
const serverMod = await import('../../../src/server/index.js');

describe('server/index', () => {
  it('createServer registers MCP tools', async () => {
    const server = await serverMod.createServer({} as any, { name: 'test', version: '0.0.1' });

    // Access the mocked server instance
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const instance: any = (McpServer as any).lastInstance;

    expect(server).toBeDefined();
    expect(instance).toBeDefined();
    const names = instance.tools.map((t: any) => t.name).sort();
    expect(names).toEqual([...EXPECTED_TOOL_NAMES].sort());

    for (const removedToolName of REMOVED_TOOL_NAMES) {
      expect(names).not.toContain(removedToolName);
    }
  });

  it('startStdioServer connects with stdio transport', async () => {
    // Provide an indexer stub with a close method to satisfy signal handlers
    const indexerStub = { close: vi.fn().mockResolvedValue(undefined) } as any;

    // Spy on process.on to avoid side-effects while still recording registrations
    const onSpy = vi.spyOn(process, 'on');

    await serverMod.startStdioServer(indexerStub, { name: 'lazyloading-ai', version: '1.0.0' });

    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const instance: any = (McpServer as any).lastInstance;
    expect(instance.connect).toHaveBeenCalledTimes(1);

    // Ensure handlers were registered
    // Ensure handlers were registered for SIGINT and SIGTERM
    const events = onSpy.mock.calls.map(c => c[0]);
    expect(events).toEqual(expect.arrayContaining(['SIGINT', 'SIGTERM']));

    onSpy.mockRestore();
  });
});
