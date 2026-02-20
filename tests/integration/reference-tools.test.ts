/**
 * Integration tests for reference tracking tools
 * Tests the full pipeline from indexing to tool execution
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { Indexer } from '../../src/indexer/index.js';
import { findReferencesTool } from '../../src/server/tools/find-references.js';
import { traceCallsTool } from '../../src/server/tools/trace-calls.js';
import { traceTypesTool } from '../../src/server/tools/trace-types.js';
import { getFixturePath } from '../helpers/fixtures.js';
import { createTestDatabase, type TestDatabaseResult } from '../helpers/database.js';


async function runFindReferences(indexer: Indexer, input: Record<string, unknown> = {}) {
  return findReferencesTool(indexer, { format: 'markdown', ...input } as any);
}

async function runTraceCalls(indexer: Indexer, input: Record<string, unknown> = {}) {
  return traceCallsTool(indexer, { format: 'markdown', ...input } as any);
}

async function runTraceTypes(indexer: Indexer, input: Record<string, unknown> = {}) {
  return traceTypesTool(indexer, { format: 'markdown', ...input } as any);
}

describe('Reference Tools Integration', () => {
  let indexer: Indexer;
  let testDb: TestDatabaseResult;

  beforeAll(async () => {
    testDb = await createTestDatabase();

    const fixtureDir = getFixturePath('typescript');

    indexer = new Indexer({
      rootDirectory: fixtureDir,
      databasePath: testDb.dbPath,
      include: ['**/*.ts'],
      exclude: [],
    });

    await indexer.initialize();
    await indexer.indexDirectory();
  });

  afterAll(async () => {
    await indexer.close();
    testDb.cleanup();
  });

  describe('find_references tool', () => {
    it('returns response for validateUser function query', async () => {
      const result = await runFindReferences(indexer, {
        symbolName: 'validateUser',
      });

      const text = result.content[0].text;
      // Tool should return a response containing the symbol name
      expect(text.toLowerCase()).toContain('validateuser');
    });

    it('returns response for User class query', async () => {
      const result = await runFindReferences(indexer, {
        symbolName: 'User',
      });

      const text = result.content[0].text;
      // Tool should return a response containing the symbol name
      expect(text).toContain('User');
    });
  });

  describe('trace_calls tool', () => {
    it('returns caller trace when direction is callers', async () => {
      const result = await runTraceCalls(indexer, {
        functionName: 'validateUser',
        direction: 'callers',
      });

      const text = result.content[0].text;
      expect(text.toLowerCase()).toContain('validateuser');
    });

    it('returns callee trace when direction is callees', async () => {
      const result = await runTraceCalls(indexer, {
        functionName: 'processUsers',
        direction: 'callees',
      });

      const text = result.content[0].text;
      expect(text.toLowerCase()).toContain('processusers');
    });

    it('returns merged trace when direction is both', async () => {
      const result = await runTraceCalls(indexer, {
        functionName: 'processUsers',
        direction: 'both',
        depth: 99,
      });

      const text = result.content[0].text;
      expect(text).toContain('# Call Trace for "processUsers"');
      expect(text).toContain('Depth: 3');
      expect(text).toContain('## Callers');
      expect(text).toContain('## Callees');
    });
  });

  describe('trace_types tool', () => {
    it('returns hierarchy response when mode is hierarchy', async () => {
      const result = await runTraceTypes(indexer, {
        className: 'User',
        mode: 'hierarchy',
        direction: 'both',
      });

      const text = result.content[0].text;
      expect(text).toContain('User');
    });

    it('returns implementations response when mode is implementations', async () => {
      const result = await runTraceTypes(indexer, {
        className: 'IRepository',
        mode: 'implementations',
      });

      const text = result.content[0].text;
      expect(text).toContain('IRepository');
    });
  });
});
