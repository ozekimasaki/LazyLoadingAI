/**
 * Canonical retrieval pipeline text shared across generated guidance docs.
 */

export const CANONICAL_RETRIEVAL_PIPELINE_BLOCK = `### Canonical Retrieval Pipeline (MUST Follow In Order)

1. \`Step 1 (Locate candidate symbols/files):\` use \`search_symbols\` and/or \`list_functions\` (optionally \`list_files\` when scope is unknown).
2. \`Step 2 (Hydrate implementation):\` use \`get_function\` or \`get_class\` on selected candidate.
3. \`Step 3 (Expand immediate context):\` use \`get_related_context\` for types/callees/tests (tests only when needed).
4. \`Step 4 (Trace flow):\` use \`trace_calls\` first, then \`find_references\` for exhaustive usage validation.
5. \`Step 5 (High-level architecture only):\` use \`get_architecture_overview\` only for module/entrypoint/public-API questions, not symbol lookup.
6. \`Hard rules:\` do not use \`ask_codebase\`; do not jump to Step 5 for targeted lookup; use native \`Read/Grep\` only as fallback when MCP output is insufficient/ambiguous.`;
