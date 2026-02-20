import { describe, it, expect } from 'vitest';
import { SqliteStorage } from '../../../src/indexer/storage/sqlite.js';

describe('SqliteStorage.searchSymbols - fuzzy fallback', () => {
  it('falls back to Fuse.js when FTS fails and respects type filter', async () => {
    const storage = new SqliteStorage('/dev/null') as any;
    // Simulate initialized DB
    const fakeDb = {
      prepare: (sql: string) => {
        if (sql.includes('symbols_fts')) {
          return {
            all: () => {
              // Simulate FTS engine error
              throw new Error('fts failed');
            },
          };
        }
        if (sql.startsWith('SELECT * FROM symbols')) {
          return {
            all: () => [
              {
                id: '1',
                file_path: '/tmp/x.ts',
                name: 'foo',
                fully_qualified_name: 'mod#foo',
                kind: 'function',
                signature: 'function foo(): void',
                language: 'typescript',
                line_start: 1,
                line_end: 2,
                data: JSON.stringify({}),
              },
            ],
          };
        }
        return { all: () => [] };
      },
    };

    storage.db = fakeDb;
    storage.cacheValid = false;

    const results = await storage.searchSymbols('fo', { type: 'function', language: 'typescript', limit: 10 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.symbol.name).toBe('foo');
    expect(['function', 'method', 'constructor']).toContain(results[0]?.symbol.kind);
  });
});
