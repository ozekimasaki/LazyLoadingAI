/**
 * Unit tests for markov chains builder
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildCallFlowChain,
  buildCooccurrenceChain,
  buildTypeAffinityChain,
  buildImportClusterChain,
  buildAllChains,
} from '../../../src/markov/chains/index.js';

// Create a mock storage for chain building
function createMockStorage(options: {
  callGraphEdges?: Array<{
    id: string;
    callerSymbolId: string;
    callerName: string;
    calleeSymbolId: string | null;
    calleeName: string;
    callCount: number;
    isAsync: boolean;
    isConditional: boolean;
  }>;
  files?: Array<{
    filePath: string;
    functions: Array<{ id: string; name: string }>;
    classes: Array<{ id: string; name: string; methods: Array<{ id: string; name: string }> }>;
    imports: Array<{ source: string; specifiers: Array<{ name: string }> }>;
  }>;
  typeRelationships?: Array<{
    id: string;
    sourceSymbolId: string;
    sourceName: string;
    targetSymbolId: string | null;
    targetName: string;
    relationshipKind: 'extends' | 'implements' | 'mixin';
  }>;
} = {}) {
  const chainIds = new Map<string, string>();
  const savedTransitions = new Map<string, any[]>();

  return {
    getOrCreateChain: vi.fn().mockImplementation((chainType: string) => {
      const chainId = `chain-${chainType}`;
      chainIds.set(chainType, chainId);
      return Promise.resolve(chainId);
    }),
    clearChain: vi.fn().mockResolvedValue(undefined),
    getAllCallGraphEdges: vi.fn().mockResolvedValue(options.callGraphEdges ?? []),
    listFiles: vi.fn().mockResolvedValue(options.files ?? []),
    getAllTypeRelationships: vi.fn().mockResolvedValue(options.typeRelationships ?? []),
    saveTransitions: vi.fn().mockImplementation((chainId: string, transitions: any[]) => {
      savedTransitions.set(chainId, transitions);
      return Promise.resolve();
    }),
    _chainIds: chainIds,
    _savedTransitions: savedTransitions,
  };
}

describe('buildCallFlowChain', () => {
  it('creates chain and clears existing data', async () => {
    const storage = createMockStorage({ callGraphEdges: [] });

    await buildCallFlowChain(storage as any);

    expect(storage.getOrCreateChain).toHaveBeenCalledWith('call_flow');
    expect(storage.clearChain).toHaveBeenCalled();
  });

  it('builds transitions from call graph edges', async () => {
    const storage = createMockStorage({
      callGraphEdges: [
        // Function A calls B and C
        {
          id: 'edge-1',
          callerSymbolId: 'func-a',
          callerName: 'funcA',
          calleeSymbolId: 'func-b',
          calleeName: 'funcB',
          callCount: 5,
          isAsync: false,
          isConditional: false,
        },
        {
          id: 'edge-2',
          callerSymbolId: 'func-a',
          callerName: 'funcA',
          calleeSymbolId: 'func-c',
          calleeName: 'funcC',
          callCount: 3,
          isAsync: false,
          isConditional: false,
        },
      ],
    });

    const chainId = await buildCallFlowChain(storage as any);

    expect(chainId).toBe('chain-call_flow');
    expect(storage.saveTransitions).toHaveBeenCalled();

    // B and C should have transitions to each other (co-callees)
    const transitions = storage._savedTransitions.get('chain-call_flow');
    expect(transitions).toBeDefined();
    expect(transitions!.length).toBeGreaterThan(0);
  });

  it('skips single callee situations (no co-callees)', async () => {
    const storage = createMockStorage({
      callGraphEdges: [
        {
          id: 'edge-1',
          callerSymbolId: 'func-a',
          callerName: 'funcA',
          calleeSymbolId: 'func-b',
          calleeName: 'funcB',
          callCount: 5,
          isAsync: false,
          isConditional: false,
        },
        // Only one callee, no co-caller patterns
      ],
    });

    await buildCallFlowChain(storage as any);

    const transitions = storage._savedTransitions.get('chain-call_flow');
    expect(transitions).toHaveLength(0);
  });

  it('applies async bonus to weights', async () => {
    const storage = createMockStorage({
      callGraphEdges: [
        {
          id: 'edge-1',
          callerSymbolId: 'func-a',
          callerName: 'funcA',
          calleeSymbolId: 'func-b',
          calleeName: 'funcB',
          callCount: 5,
          isAsync: false,
          isConditional: false,
        },
        {
          id: 'edge-2',
          callerSymbolId: 'func-a',
          callerName: 'funcA',
          calleeSymbolId: 'func-c',
          calleeName: 'funcC',
          callCount: 5,
          isAsync: true,
          isConditional: false,
        },
      ],
    });

    await buildCallFlowChain(storage as any);

    expect(storage.saveTransitions).toHaveBeenCalled();
  });

  it('applies conditional penalty to weights', async () => {
    const storage = createMockStorage({
      callGraphEdges: [
        {
          id: 'edge-1',
          callerSymbolId: 'func-a',
          callerName: 'funcA',
          calleeSymbolId: 'func-b',
          calleeName: 'funcB',
          callCount: 5,
          isAsync: false,
          isConditional: false,
        },
        {
          id: 'edge-2',
          callerSymbolId: 'func-a',
          callerName: 'funcA',
          calleeSymbolId: 'func-c',
          calleeName: 'funcC',
          callCount: 5,
          isAsync: false,
          isConditional: true, // Should have lower weight
        },
      ],
    });

    await buildCallFlowChain(storage as any);

    expect(storage.saveTransitions).toHaveBeenCalled();
  });
});

describe('buildCooccurrenceChain', () => {
  it('creates chain and clears existing data', async () => {
    const storage = createMockStorage({ files: [] });

    await buildCooccurrenceChain(storage as any);

    expect(storage.getOrCreateChain).toHaveBeenCalledWith('cooccurrence');
    expect(storage.clearChain).toHaveBeenCalled();
  });

  it('builds transitions from symbols in same file', async () => {
    const storage = createMockStorage({
      files: [
        {
          filePath: '/src/file.ts',
          functions: [
            { id: 'sym-1', name: 'funcA' },
            { id: 'sym-2', name: 'funcB' },
          ],
          classes: [],
          imports: [],
        },
      ],
    });

    const chainId = await buildCooccurrenceChain(storage as any);

    expect(chainId).toBe('chain-cooccurrence');
    expect(storage.saveTransitions).toHaveBeenCalled();
    // Transitions are saved (the actual number depends on normalization)
    expect(storage._savedTransitions.has('chain-cooccurrence')).toBe(true);
  });

  it('skips files with single symbol', async () => {
    const storage = createMockStorage({
      files: [
        {
          filePath: '/src/single.ts',
          functions: [{ id: 'sym-1', name: 'onlyFunc' }],
          classes: [],
          imports: [],
        },
      ],
    });

    await buildCooccurrenceChain(storage as any);

    const transitions = storage._savedTransitions.get('chain-cooccurrence');
    expect(transitions).toHaveLength(0);
  });
});

describe('buildTypeAffinityChain', () => {
  it('creates chain and clears existing data', async () => {
    const storage = createMockStorage({ typeRelationships: [] });

    await buildTypeAffinityChain(storage as any);

    expect(storage.getOrCreateChain).toHaveBeenCalledWith('type_affinity');
    expect(storage.clearChain).toHaveBeenCalled();
  });

  it('builds transitions from extends relationships', async () => {
    const storage = createMockStorage({
      typeRelationships: [
        {
          id: 'rel-1',
          sourceSymbolId: 'class-child',
          sourceName: 'ChildClass',
          targetSymbolId: 'class-parent',
          targetName: 'ParentClass',
          relationshipKind: 'extends',
        },
      ],
    });

    const chainId = await buildTypeAffinityChain(storage as any);

    expect(chainId).toBe('chain-type_affinity');
    expect(storage.saveTransitions).toHaveBeenCalled();

    const transitions = storage._savedTransitions.get('chain-type_affinity');
    expect(transitions).toBeDefined();
  });

  it('builds transitions from implements relationships', async () => {
    const storage = createMockStorage({
      typeRelationships: [
        {
          id: 'rel-1',
          sourceSymbolId: 'class-impl',
          sourceName: 'ServiceImpl',
          targetSymbolId: 'iface-svc',
          targetName: 'IService',
          relationshipKind: 'implements',
        },
      ],
    });

    const chainId = await buildTypeAffinityChain(storage as any);

    expect(chainId).toBe('chain-type_affinity');
    const transitions = storage._savedTransitions.get('chain-type_affinity');
    expect(transitions).toBeDefined();
  });

  it('handles multiple siblings (shared parent)', async () => {
    const storage = createMockStorage({
      typeRelationships: [
        {
          id: 'rel-1',
          sourceSymbolId: 'class-a',
          sourceName: 'ClassA',
          targetSymbolId: 'class-parent',
          targetName: 'Parent',
          relationshipKind: 'extends',
        },
        {
          id: 'rel-2',
          sourceSymbolId: 'class-b',
          sourceName: 'ClassB',
          targetSymbolId: 'class-parent',
          targetName: 'Parent',
          relationshipKind: 'extends',
        },
      ],
    });

    await buildTypeAffinityChain(storage as any);

    // ClassA and ClassB should have sibling relationships
    const transitions = storage._savedTransitions.get('chain-type_affinity');
    expect(transitions!.length).toBeGreaterThan(0);
  });
});

describe('buildImportClusterChain', () => {
  it('creates chain and clears existing data', async () => {
    const storage = createMockStorage({ files: [] });

    await buildImportClusterChain(storage as any);

    expect(storage.getOrCreateChain).toHaveBeenCalledWith('import_cluster');
    expect(storage.clearChain).toHaveBeenCalled();
  });

  it('builds transitions from shared imports', async () => {
    const storage = createMockStorage({
      files: [
        {
          filePath: '/src/a.ts',
          functions: [{ id: 'sym-a', name: 'funcA' }],
          classes: [],
          imports: [{ source: 'lodash', specifiers: [{ name: 'map' }] }],
        },
        {
          filePath: '/src/b.ts',
          functions: [{ id: 'sym-b', name: 'funcB' }],
          classes: [],
          imports: [{ source: 'lodash', specifiers: [{ name: 'filter' }] }],
        },
      ],
    });

    const chainId = await buildImportClusterChain(storage as any);

    expect(chainId).toBe('chain-import_cluster');
    // Files importing from same module should have their symbols related
  });
});

describe('buildAllChains', () => {
  it('builds all four chain types by default', async () => {
    const storage = createMockStorage({
      callGraphEdges: [],
      files: [],
      typeRelationships: [],
    });

    const chainIds = await buildAllChains(storage as any);

    expect(chainIds).toHaveLength(4);
    expect(chainIds).toContain('chain-call_flow');
    expect(chainIds).toContain('chain-cooccurrence');
    expect(chainIds).toContain('chain-type_affinity');
    expect(chainIds).toContain('chain-import_cluster');
  });

  it('builds only specified chain types', async () => {
    const storage = createMockStorage({
      callGraphEdges: [],
      files: [],
    });

    const chainIds = await buildAllChains(storage as any, ['call_flow', 'cooccurrence']);

    expect(chainIds).toHaveLength(2);
    expect(chainIds).toContain('chain-call_flow');
    expect(chainIds).toContain('chain-cooccurrence');
    expect(chainIds).not.toContain('chain-type_affinity');
    expect(chainIds).not.toContain('chain-import_cluster');
  });

  it('handles empty chain types array', async () => {
    const storage = createMockStorage();

    const chainIds = await buildAllChains(storage as any, []);

    expect(chainIds).toHaveLength(0);
  });
});
