import { describe, it, expect } from 'vitest';

describe('src/index exports', () => {
  it('can be imported without side effects', async () => {
    const mod = await import('../../../src/index.js');
    // Spot-check a couple of known exports exist
    expect(mod).toHaveProperty('Indexer');
    expect(mod).toHaveProperty('createServer');
  });
});
