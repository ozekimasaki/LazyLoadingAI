import { describe, expect, it } from 'vitest';
import { generateAgentsMdContent } from '../../../src/templates/agents-md.js';
import { generateClaudeMdContent } from '../../../src/templates/claude-md.js';
import { CANONICAL_RETRIEVAL_PIPELINE_BLOCK } from '../../../src/templates/canonical-retrieval-pipeline.js';

const CANONICAL_ORDER_MARKERS = [
  'Step 1 (Locate candidate symbols/files)',
  'Step 2 (Hydrate implementation)',
  'Step 3 (Expand immediate context)',
  'Step 4 (Trace flow)',
  'Step 5 (High-level architecture only)',
  'Hard rules',
] as const;

function assertCanonicalOrder(content: string): void {
  let previousIndex = -1;
  for (const marker of CANONICAL_ORDER_MARKERS) {
    const markerIndex = content.indexOf(marker);
    expect(markerIndex, `missing marker: ${marker}`).toBeGreaterThan(-1);
    expect(markerIndex, `marker out of order: ${marker}`).toBeGreaterThan(previousIndex);
    previousIndex = markerIndex;
  }
}

describe('template canonical pipeline parity', () => {
  it('keeps the exact same canonical pipeline block in both templates', () => {
    const claude = generateClaudeMdContent();
    const agents = generateAgentsMdContent();

    expect(claude).toContain(CANONICAL_RETRIEVAL_PIPELINE_BLOCK);
    expect(agents).toContain(CANONICAL_RETRIEVAL_PIPELINE_BLOCK);

    assertCanonicalOrder(claude);
    assertCanonicalOrder(agents);
  });

  it('does not allow ask_codebase outside the hard-rule prohibition block', () => {
    const claude = generateClaudeMdContent().replace(CANONICAL_RETRIEVAL_PIPELINE_BLOCK, '');
    const agents = generateAgentsMdContent().replace(CANONICAL_RETRIEVAL_PIPELINE_BLOCK, '');

    expect(claude).not.toContain('ask_codebase');
    expect(agents).not.toContain('ask_codebase');
  });

  it('contains required fallback and architecture-scope constraints', () => {
    const requiredFallbackConstraint =
      'use native `Read/Grep` only as fallback when MCP output is insufficient/ambiguous.';
    const requiredArchitectureScope =
      'use `get_architecture_overview` only for module/entrypoint/public-API questions, not symbol lookup.';

    const claude = generateClaudeMdContent();
    const agents = generateAgentsMdContent();

    expect(claude).toContain(requiredFallbackConstraint);
    expect(agents).toContain(requiredFallbackConstraint);
    expect(claude).toContain(requiredArchitectureScope);
    expect(agents).toContain(requiredArchitectureScope);
  });
});
