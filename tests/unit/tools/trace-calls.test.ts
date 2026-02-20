/**
 * Unit tests for trace-calls tool
 */

import { describe, it, expect } from 'vitest';
import { traceCallsTool } from '../../../src/server/tools/trace-calls.js';
import { createMockIndexer } from '../../helpers/mocks/indexer.js';
import { createTestCallGraphEdge, createTestSymbolReference } from '../../helpers/database.js';


async function runTraceCalls(indexer: any, input: Record<string, unknown> = {}) {
  return traceCallsTool(indexer, { format: 'markdown', ...input } as any);
}

describe('traceCallsTool', () => {
  it('traces callers when direction=callers', async () => {
    const mockIndexer = createMockIndexer({
      callGraphEdges: [
        createTestCallGraphEdge({
          callerName: 'processRequest',
          calleeName: 'validateInput',
          callCount: 2,
        }),
        createTestCallGraphEdge({
          callerName: 'handleForm',
          calleeName: 'validateInput',
          callCount: 1,
        }),
      ],
    });

    const result = await runTraceCalls(mockIndexer as any, {
      functionName: 'validateInput',
      direction: 'callers',
    });

    const text = result.content[0].text;
    expect(text).toContain('Callers of "validateInput"');
    expect(text).toContain('processRequest');
    expect(text).toContain('handleForm');
    expect(text).toContain('Found 2 caller(s)');
  });

  it('traces callees when direction=callees', async () => {
    const mockIndexer = createMockIndexer({
      callGraphEdges: [
        createTestCallGraphEdge({
          callerName: 'processData',
          calleeName: 'validateInput',
        }),
        createTestCallGraphEdge({
          callerName: 'processData',
          calleeName: 'transformData',
          callCount: 3,
          isAsync: true,
        }),
      ],
    });

    const result = await runTraceCalls(mockIndexer as any, {
      functionName: 'processData',
      direction: 'callees',
    });

    const text = result.content[0].text;
    expect(text).toContain('Functions called by "processData"');
    expect(text).toContain('validateInput');
    expect(text).toContain('transformData');
    expect(text).toContain('| `transformData` | 3 | Yes | No |');
    expect(text).toContain('| `validateInput` | 1 | No | No |');
  });

  it('combines callers and callees when direction=both and normalizes depth', async () => {
    const mockIndexer = createMockIndexer({
      callGraphEdges: [
        createTestCallGraphEdge({
          callerName: 'entrypoint',
          calleeName: 'processData',
        }),
        createTestCallGraphEdge({
          callerName: 'processData',
          calleeName: 'validateInput',
        }),
      ],
    });

    const result = await runTraceCalls(mockIndexer as any, {
      functionName: 'processData',
      direction: 'both',
      depth: 99,
    });

    const text = result.content[0].text;
    expect(text).toContain('# Call Trace for "processData"');
    expect(text).toContain('Depth: 3');
    expect(text).toContain('## Callers');
    expect(text).toContain('## Callees');
  });

  it('supports compact output format', async () => {
    const mockIndexer = createMockIndexer({
      callGraphEdges: [
        createTestCallGraphEdge({
          callerName: 'processData',
          calleeName: 'validateInput',
        }),
        createTestCallGraphEdge({
          callerName: 'processData',
          calleeName: 'transformData',
          callCount: 3,
          isAsync: true,
        }),
      ],
    });

    const result = await runTraceCalls(mockIndexer as any, {
      functionName: 'processData',
      direction: 'callees',
      format: 'compact',
    });

    const text = result.content[0].text;
    expect(text).toContain('[CALLEES of processData]');
    expect(text).toContain('name\tfile\tcalls\tasync\tconditional');
    expect(text).toContain('transformData');
    expect(text).toContain('\t3\tY\tN');
  });

  it('falls back to symbol references for callers when call graph is empty', async () => {
    const mockIndexer = createMockIndexer({
      symbolReferences: [
        createTestSymbolReference({
          symbolName: 'targetFn',
          referencingSymbolName: 'fallbackCaller',
          referenceKind: 'call',
        }),
      ],
    });

    const result = await runTraceCalls(mockIndexer as any, {
      functionName: 'targetFn',
      direction: 'callers',
    });

    expect(result.content[0].text).toContain('fallbackCaller');
    expect(result.content[0].text).toContain('via symbol references');
  });

  it('uses trace_calls tool names in guidance text', async () => {
    const mockIndexer = createMockIndexer({
      callGraphEdges: [
        createTestCallGraphEdge({
          callerName: 'singleCaller',
          calleeName: 'targetFn',
        }),
      ],
    });

    const callersResult = await runTraceCalls(mockIndexer as any, {
      functionName: 'targetFn',
      direction: 'callers',
    });
    expect(callersResult.content[0].text).toContain('`trace_calls` with `direction: "callees"`');

    const calleesResult = await runTraceCalls(mockIndexer as any, {
      functionName: 'singleCaller',
      direction: 'callees',
    });
    expect(calleesResult.content[0].text).toContain('`trace_calls` with `direction: "callers"`');
  });

  it('returns clear validation errors', async () => {
    const mockIndexer = createMockIndexer();

    const emptyName = await runTraceCalls(mockIndexer as any, {
      functionName: '   ',
    });
    expect(emptyName.content[0].text).toContain('Invalid function_name');

    const invalidDirection = await runTraceCalls(mockIndexer as any, {
      functionName: 'targetFn',
      direction: 'sideways' as any,
    });
    expect(invalidDirection.content[0].text).toContain('Invalid direction "sideways"');
  });
});
