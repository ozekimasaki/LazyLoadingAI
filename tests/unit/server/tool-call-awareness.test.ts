import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CONFIG,
  TOOL_CALL_AWARENESS_NOTE,
  TOOL_CALL_AWARENESS_THRESHOLD,
  appendToolCallAwarenessNote,
  createToolCallAwarenessWrapper,
  extractTarget,
  getAwarenessState,
} from '../../../src/server/tools/tool-call-awareness.js';

function createTextHandler(text: string = 'payload') {
  return vi.fn(async () => ({
    content: [{ type: 'text' as const, text }],
  }));
}

describe('tool-call-awareness', () => {
  it('Novel tracking: 8 calls with different targets remain in explore state', async () => {
    const handler = createTextHandler();
    const wrapped = createToolCallAwarenessWrapper()(handler, 'search_symbols');

    for (let i = 1; i <= 8; i += 1) {
      const result = await wrapped({ query: `symbol${i}` });
      expect(result.content?.[0]?.text).toBe('payload');
      expect(result.content?.[0]?.text).not.toContain('[Note:');
      expect(result.content?.[0]?.text).not.toContain('[Warning:');
      expect(result.content?.[0]?.text).not.toContain('[LazyLoadingAI BUDGET EXHAUSTED]');
    }

    expect(handler).toHaveBeenCalledTimes(8);
  });

  it('Pipeline progression: same target across different tools counts as novel each time', async () => {
    const handler = createTextHandler();
    const wrap = createToolCallAwarenessWrapper({
      novelExploreLimit: 2,
      novelSynthesizeLimit: 10,
      totalHardCap: 20,
    });

    const search = wrap(handler, 'search_symbols');
    const getFunction = wrap(handler, 'get_function');
    const traceCalls = wrap(handler, 'trace_calls');

    const first = await search({ query: 'X' });
    const second = await getFunction({ function_name: 'X' });
    const third = await traceCalls({ function_name: 'X', depth: 1 });

    expect(first.content?.[0]?.text).toBe('payload');
    expect(second.content?.[0]?.text).toBe('payload');
    expect(third.content?.[0]?.text).toContain('payload');
    expect(third.content?.[0]?.text).toContain('[Note: 3 unique lookups across 3 total calls.');
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('Same (tool,target) twice without cache hit does not increase novel count', async () => {
    const handler = createTextHandler();
    const wrapped = createToolCallAwarenessWrapper({
      novelExploreLimit: 1,
      novelSynthesizeLimit: 5,
      totalHardCap: 10,
    })(handler, 'search_symbols');

    const first = await wrapped({ query: 'Auth', limit: 5 });
    const second = await wrapped({ query: 'Auth', limit: 10 });
    const third = await wrapped({ query: 'Billing', limit: 10 });

    expect(first.content?.[0]?.text).toBe('payload');
    expect(second.content?.[0]?.text).toBe('payload');
    expect(second.content?.[0]?.text).not.toContain('[Note:');
    expect(second.content?.[0]?.text).not.toContain('[Warning:');
    expect(third.content?.[0]?.text).toContain('[Note: 2 unique lookups across 3 total calls.');
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('SYNTHESIZE triggers on novel count (not total count)', async () => {
    const handler = createTextHandler();
    const wrapped = createToolCallAwarenessWrapper()(handler, 'search_symbols');

    for (let i = 1; i <= 8; i += 1) {
      const result = await wrapped({ query: `n${i}` });
      expect(result.content?.[0]?.text).toBe('payload');
    }

    for (let i = 1; i <= 4; i += 1) {
      const repeated = await wrapped({ query: 'n1', limit: i });
      expect(repeated.content?.[0]?.text).toBe('payload');
      expect(repeated.content?.[0]?.text).not.toContain('[Note:');
      expect(repeated.content?.[0]?.text).not.toContain('[Warning:');
    }

    const thirteenthTotal = await wrapped({ query: 'n9' });
    expect(thirteenthTotal.content?.[0]?.text).toContain('[Note: 9 unique lookups across 13 total calls.');
    expect(handler).toHaveBeenCalledTimes(13);
  });

  it('FINALIZE: blocks at novel count 16', async () => {
    const handler = createTextHandler();
    const wrapped = createToolCallAwarenessWrapper()(handler, 'search_symbols');

    for (let i = 1; i <= 15; i += 1) {
      await wrapped({ query: `symbol${i}` });
    }

    const blocked = await wrapped({ query: 'symbol16' });
    expect(blocked.content?.[0]?.text).toContain('[LazyLoadingAI BUDGET EXHAUSTED]');
    expect(blocked.content?.[0]?.text).toContain('16 unique lookups across 16 total calls');
    expect(handler).toHaveBeenCalledTimes(15);
  });

  it('FINALIZE: blocks at total call 26 even with low novelty', async () => {
    const handler = createTextHandler();
    const wrapped = createToolCallAwarenessWrapper()(handler, 'search_symbols');

    for (let i = 1; i <= 25; i += 1) {
      await wrapped({ query: 'same-symbol', limit: i });
    }

    const blocked = await wrapped({ query: 'same-symbol', limit: 26 });
    expect(blocked.content?.[0]?.text).toContain('[LazyLoadingAI BUDGET EXHAUSTED]');
    expect(blocked.content?.[0]?.text).toContain('1 unique lookups across 26 total calls');
    expect(handler).toHaveBeenCalledTimes(25);
  });

  it('sync_index is exempt and does not increment counters', async () => {
    const searchHandler = createTextHandler('search');
    const syncHandler = createTextHandler('synced');

    const wrap = createToolCallAwarenessWrapper({
      novelExploreLimit: 10,
      novelSynthesizeLimit: 20,
      totalHardCap: 2,
    });

    const search = wrap(searchHandler, 'search_symbols');
    const sync = wrap(syncHandler, 'sync_index');

    await search({ query: 'a' });
    await sync({ files: ['src/example.ts'] });
    await sync({ files: ['src/example.ts'] });
    const secondSearch = await search({ query: 'b' });
    const blocked = await search({ query: 'c' });

    expect(secondSearch.content?.[0]?.text).toBe('search');
    expect(blocked.content?.[0]?.text).toContain('[LazyLoadingAI BUDGET EXHAUSTED]');
    expect(searchHandler).toHaveBeenCalledTimes(2);
    expect(syncHandler).toHaveBeenCalledTimes(2);
  });

  it('Cache: exact input match is free and does not consume budget', async () => {
    const handler = createTextHandler();
    const wrapped = createToolCallAwarenessWrapper({
      novelExploreLimit: 1,
      novelSynthesizeLimit: 1,
      totalHardCap: 1,
    })(handler, 'search_symbols');

    const first = await wrapped({ query: 'cache-me', limit: 5 });
    const cached = await wrapped({ query: 'cache-me', limit: 5 });
    const blocked = await wrapped({ query: 'new-target', limit: 5 });

    expect(first.content?.[0]?.text).toBe('payload');
    expect(cached.content?.[0]?.text).toContain('[Cached call reused]');
    expect(blocked.content?.[0]?.text).toContain('[LazyLoadingAI BUDGET EXHAUSTED]');
    expect(blocked.content?.[0]?.text).toContain('2 unique lookups across 2 total calls');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('Target extraction: maps all tool inputs to normalized targets', () => {
    const cases: Array<{
      tool: string | undefined;
      input: unknown;
      expected: string | null;
    }> = [
      {
        tool: 'search_symbols',
        input: { query: '  useInfrastructureOAuth  ', return_type: ' Promise<User> ', param_type: ' Request ' },
        expected: 'query:useinfrastructureoauth||return_type:promise<user>||param_type:request',
      },
      { tool: 'get_function', input: { function_name: '  LoadData  ' }, expected: 'loaddata' },
      { tool: 'get_class', input: { class_name: '  ReplyBuilder  ' }, expected: 'replybuilder' },
      { tool: 'find_references', input: { symbol_name: '  reply ' }, expected: 'reply' },
      { tool: 'trace_calls', input: { function_name: '  HandleError  ' }, expected: 'handleerror' },
      { tool: 'trace_types', input: { class_name: '  service  ' }, expected: 'service' },
      { tool: 'suggest_related', input: { symbol_name: '  normalize  ' }, expected: 'normalize' },
      { tool: 'get_related_context', input: { symbol_name: '  orchestrate  ' }, expected: 'orchestrate' },
      { tool: 'list_functions', input: { file_path: '  src/App.ts  ' }, expected: 'src/app.ts' },
      { tool: 'list_files', input: { directory: '  SRC/Server  ' }, expected: 'src/server' },
      { tool: 'list_files', input: {}, expected: '*' },
      { tool: 'get_module_dependencies', input: { file_path: '  src/server/index.ts  ' }, expected: 'src/server/index.ts' },
      { tool: 'get_architecture_overview', input: { focus: '  Modules  ' }, expected: 'modules' },
      { tool: 'get_architecture_overview', input: {}, expected: '*' },
      { tool: 'sync_index', input: { files: ['src/a.ts'] }, expected: null },
      { tool: 'unknown_tool', input: { query: 'x' }, expected: null },
      { tool: undefined, input: { query: 'x' }, expected: null },
    ];

    for (const { tool, input, expected } of cases) {
      expect(extractTarget(tool, input)).toBe(expected);
    }
  });

  it('leaves non-text responses unchanged', () => {
    const result = appendToolCallAwarenessNote(
      {
        content: [{ type: 'image', url: 'https://example.com/image.png' }],
      },
      TOOL_CALL_AWARENESS_THRESHOLD
    );

    expect(result).toEqual({
      content: [{ type: 'image', url: 'https://example.com/image.png' }],
    });
  });

  it('Custom config honors custom novelty and total thresholds', async () => {
    const handler = createTextHandler();
    const wrapped = createToolCallAwarenessWrapper({
      novelExploreLimit: 1,
      novelSynthesizeLimit: 2,
      totalHardCap: 5,
    })(handler, 'search_symbols');

    const first = await wrapped({ query: 'a' });
    const second = await wrapped({ query: 'b' });
    const third = await wrapped({ query: 'c' });

    expect(first.content?.[0]?.text).toBe('payload');
    expect(second.content?.[0]?.text).toContain('[Note: 2 unique lookups across 2 total calls.');
    expect(third.content?.[0]?.text).toContain('[LazyLoadingAI BUDGET EXHAUSTED]');
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('getAwarenessState returns expected boundary states', () => {
    expect(getAwarenessState(0, 0)).toBe('explore');
    expect(getAwarenessState(DEFAULT_CONFIG.novelExploreLimit, DEFAULT_CONFIG.novelExploreLimit)).toBe('explore');
    expect(getAwarenessState(DEFAULT_CONFIG.novelExploreLimit + 1, DEFAULT_CONFIG.novelExploreLimit + 1)).toBe('synthesize');
    expect(getAwarenessState(DEFAULT_CONFIG.novelSynthesizeLimit, DEFAULT_CONFIG.novelSynthesizeLimit)).toBe('synthesize');
    expect(getAwarenessState(DEFAULT_CONFIG.novelSynthesizeLimit + 1, DEFAULT_CONFIG.novelSynthesizeLimit + 1)).toBe('finalize');
    expect(getAwarenessState(1, DEFAULT_CONFIG.totalHardCap + 1)).toBe('finalize');
  });

  it('does not append duplicate notes', () => {
    const result = appendToolCallAwarenessNote(
      { content: [{ type: 'text', text: `payload\n\n${TOOL_CALL_AWARENESS_NOTE}` }] },
      TOOL_CALL_AWARENESS_THRESHOLD
    );

    expect(result.content?.[0]?.text).toBe(`payload\n\n${TOOL_CALL_AWARENESS_NOTE}`);
  });
});
