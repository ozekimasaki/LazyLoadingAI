/**
 * Unit tests for trace-types tool
 */

import { describe, it, expect } from 'vitest';
import { traceTypesTool } from '../../../src/server/tools/trace-types.js';
import { createMockIndexer } from '../../helpers/mocks/indexer.js';
import { createTestTypeRelationship } from '../../helpers/database.js';


async function runTraceTypes(indexer: any, input: Record<string, unknown> = {}) {
  return traceTypesTool(indexer, { format: 'markdown', ...input } as any);
}

describe('traceTypesTool', () => {
  it('defaults to hierarchy mode and remaps legacy implementation tip', async () => {
    const mockIndexer = createMockIndexer({
      typeRelationships: [
        createTestTypeRelationship({
          sourceName: 'UserService',
          targetName: 'BaseService',
          relationshipKind: 'extends',
        }),
      ],
    });

    const result = await runTraceTypes(mockIndexer as any, {
      className: 'UserService',
    });

    const text = result.content[0].text;
    expect(text).toContain('Type Hierarchy for "UserService"');
    expect(text).toContain('`trace_types` with `mode: "implementations"`');
    expect(text).not.toContain('`find_implementations`');
  });

  it('routes to implementations mode and remaps hierarchy tip', async () => {
    const mockIndexer = createMockIndexer({
      typeRelationships: [
        createTestTypeRelationship({
          sourceName: 'UserRepository',
          targetName: 'IRepository',
          relationshipKind: 'implements',
        }),
      ],
    });

    const result = await runTraceTypes(mockIndexer as any, {
      className: 'IRepository',
      mode: 'implementations',
    });

    const text = result.content[0].text;
    expect(text).toContain('Implementations of "IRepository"');
    expect(text).toContain('`trace_types` with `mode: "hierarchy"`');
    expect(text).not.toContain('`get_type_hierarchy`');
  });

  it('normalizes implementations limit to a bounded integer', async () => {
    const typeRelationships = Array.from({ length: 6 }, (_, index) => (
      createTestTypeRelationship({
        sourceName: `Service${index}`,
        targetName: 'IBase',
        relationshipKind: 'implements',
      })
    ));

    const mockIndexer = createMockIndexer({ typeRelationships });
    const result = await runTraceTypes(mockIndexer as any, {
      className: 'IBase',
      mode: 'implementations',
      limit: 2.9,
    });

    expect(result.content[0].text).toContain('Found 6 implementation(s) (showing first 2)');
  });

  it('returns clear error for invalid mode', async () => {
    const mockIndexer = createMockIndexer();

    const result = await runTraceTypes(mockIndexer as any, {
      className: 'User',
      mode: 'invalid' as any,
    });

    expect(result.content[0].text).toContain('Invalid mode "invalid"');
  });

  it('supports compact output format', async () => {
    const mockIndexer = createMockIndexer({
      typeRelationships: [
        createTestTypeRelationship({
          sourceName: 'UserService',
          targetName: 'BaseService',
          relationshipKind: 'extends',
        }),
      ],
    });

    const result = await runTraceTypes(mockIndexer as any, {
      className: 'UserService',
      mode: 'hierarchy',
      format: 'compact',
    });

    const text = result.content[0].text;
    expect(text).toContain('name\trelationship\ttarget\tfile');
    expect(text).toContain('UserService\textends\tBaseService');
    expect(text).not.toContain('Type Hierarchy for');
  });

  it('returns clear error for invalid hierarchy direction', async () => {
    const mockIndexer = createMockIndexer();

    const result = await runTraceTypes(mockIndexer as any, {
      className: 'User',
      mode: 'hierarchy',
      direction: 'left' as any,
    });

    expect(result.content[0].text).toContain('Invalid direction "left"');
  });

  it('returns clear error for empty class names', async () => {
    const mockIndexer = createMockIndexer();

    const result = await runTraceTypes(mockIndexer as any, {
      className: '   ',
      mode: 'hierarchy',
    });

    expect(result.content[0].text).toContain('Invalid class_name');
  });
});
