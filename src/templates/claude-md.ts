/**
 * Template for CLAUDE.md file content
 *
 * Canonical pipeline text is shared with agents-md via
 * CANONICAL_RETRIEVAL_PIPELINE_BLOCK.
 */

import { CANONICAL_RETRIEVAL_PIPELINE_BLOCK } from './canonical-retrieval-pipeline.js';

export const CLAUDE_MD_SECTION_MARKER = '# LazyLoadingAI Code Exploration';

export const CANONICAL_PIPELINE_BLOCK = CANONICAL_RETRIEVAL_PIPELINE_BLOCK;

export const CLAUDE_MD_TEMPLATE = `# LazyLoadingAI Development Guidelines

## Code Exploration

This project uses LazyLoadingAI MCP tools for code exploration. The rules below are product-defining and **MUST** be followed exactly.

### Route the Question First (MUST Do Before Any Tool Call)

Classify every code question into one of three categories before calling any tool:

| Question type | Example | Action |
|---|---|---|
| **Simple lookup** — "What is X?", "Show me X", "Find function X" | "What is the Reply class?" | Steps 1–2 only. Stop and answer. |
| **Relationship/flow** — "What calls X?", "How does X reach Y?", "Trace the error flow" | "How does error handling work from throw to response?" | Steps 1–4. Start synthesizing around 8 unique lookups. |
| **Architecture/overview** — "How is this organized?", "What are the main modules?" | "Give me an architectural overview" | Step 5 only. One \`get_architecture_overview\` call. Stop and answer. |

**This routing step is mandatory.** Do not start with Step 1 for architecture questions. Do not run Steps 3–5 for simple lookups.

**Call budget by question type:**
- **Simple lookup**: 2–3 calls (\`search_symbols\` → \`get_function\` → answer). You MUST answer after Step 2. Do NOT proceed to Steps 3–5.
- **Relationship/flow**: 4–8 calls (add \`trace_calls\`, \`get_related_context\`). Start synthesizing at 6 unique lookups.
- **Architecture**: 1 call (\`get_architecture_overview\` → answer).

Exceeding these budgets signals you are over-exploring. Stop and synthesize your answer.

${CANONICAL_RETRIEVAL_PIPELINE_BLOCK}

### Critical: Never Read After MCP (MUST Follow)

If an MCP tool (\`get_function\`, \`get_class\`, \`get_related_context\`, etc.) returned source code for a file or symbol, do **NOT** call \`Read\` on that same file. The MCP output already contains the full source with line numbers. Calling \`Read\` afterward doubles your token usage with zero quality benefit.

**Example of violation**: calling \`get_function("foo", "bar.ts")\` and then \`Read("bar.ts")\` — the second call is pure waste.

### Efficiency Rules (MUST Follow)

These rules prevent the three failure modes observed in benchmarking:

1. **Stop early.** For simple-lookup questions, Steps 1–2 are sufficient. Write your answer as soon as you have the symbol's source code. Do NOT continue to Steps 3–5 unless the question explicitly asks about relationships, callers, or architecture. Example: if the question is "Find function X" or "Show me X", use \`search_symbols\` → \`get_function\` → ANSWER. Two tool calls maximum.

2. **Synthesis budget.** The system tracks novelty per (tool, target) pair. Budgets are question-type-aware:
   - Simple lookup: synthesize after 2–3 unique targets.
   - Relationship/flow: synthesize after 6–8 unique targets.
   - Architecture: synthesize after 1 target.
   Lookups for genuinely new symbols are always allowed up to a generous limit, but exceeding the budget for your question type means you should answer now.

3. **Compact format.** Always use \`format: "compact"\` (this is the default). Never request \`format: "markdown"\` unless the user explicitly asks for detailed/formatted output.

4. **Fallback only.** Use native \`Read\`, \`Grep\`, and \`Glob\` only when MCP tool output is insufficient, ambiguous, or when you need a file that is not indexed (e.g., config files, package.json). Do not use them to verify or supplement MCP results.

## Tool Selection Guide

### Finding Code
- **\`search_symbols\`** — Find symbols by name and/or type signatures. Start here for any targeted question.
- **\`list_files\`** — Browse indexed files with summaries. Use when you don't know which file to look in.
- **\`list_functions\`** — Inspect file-level signatures; use \`include_source: true\` for top implementations.

### Reading Code
- **\`get_function\`** / **\`get_class\`** — Retrieve full source for a specific symbol. This is your primary source-code tool.
- **\`get_related_context\`** — Bundle source, types, callees, and tests in one call. Use only when the question requires understanding relationships.

### Tracing Behavior and Types
- **\`find_references\`** — Find all usages of a symbol across the codebase.
- **\`trace_calls\`** — Trace incoming/outgoing call chains. Prefer this over multiple \`find_references\` calls for flow questions.
- **\`trace_types\`** — Trace inheritance hierarchy or interface implementations.
- **\`get_module_dependencies\`** — Inspect import/reverse-import relationships for a file.

### Architecture and Discovery
- **\`get_architecture_overview\`** — High-level module, entrypoint, and public-API overview. **Use as the sole tool for architecture questions** — do not combine with symbol-level tools unless the user asks a follow-up about a specific module.
- **\`suggest_related\`** — After finding one useful symbol, discover adjacent code you did not know to search for.

### Configuration Files
- Config files (package.json, tsconfig.json, etc.) are usually small. Read them directly with \`Read\` — they are often not indexed.

## After Making Changes

Always call \`sync_index\` after editing files to keep the index current:
- With specific files: \`sync_index({ files: ["path/to/edited.ts"] })\`
- Full incremental sync: \`sync_index({})\`
- Rebuild relationship chains when needed: \`sync_index({ rebuild_chains: true })\`
`;

export function generateClaudeMdContent(): string {
  return CLAUDE_MD_TEMPLATE;
}

export function hasLazyLoadingSection(content: string): boolean {
  return content.includes(CLAUDE_MD_SECTION_MARKER) ||
         content.includes('LazyLoadingAI') ||
         content.includes('lazyloadingai');
}
