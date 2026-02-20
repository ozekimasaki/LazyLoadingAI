import { describe, it, expect } from 'vitest';
import { listFilesTool } from '../../../src/server/tools/list-files.js';

describe('list_files tool - empty index', () => {
  it('returns helpful message when no files indexed', async () => {
    const indexer = {
      listFiles: async () => [],
    } as any;

    const result = await listFilesTool(indexer, {});
    expect(result.content[0]?.text).toMatch(/No indexed files found/i);
  });
});
