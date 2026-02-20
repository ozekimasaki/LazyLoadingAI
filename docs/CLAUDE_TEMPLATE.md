# Claude Code Guidelines for LazyLoadingAI

Copy this file to your project root as `CLAUDE.md` when using LazyLoadingAI MCP tools.

---

## Code Exploration

This retrieval pipeline is product-defining and MUST be followed in order for targeted lookup questions.

### Canonical Retrieval Pipeline (MUST Follow In Order)

1. `Step 1 (Locate candidate symbols/files):` use `search_symbols` and/or `list_functions` (optionally `list_files` when scope is unknown).
2. `Step 2 (Hydrate implementation):` use `get_function` or `get_class` on selected candidate.
3. `Step 3 (Expand immediate context):` use `get_related_context` for types/callees/tests (tests only when needed).
4. `Step 4 (Trace flow):` use `trace_calls` first, then `find_references` for exhaustive usage validation.
5. `Step 5 (High-level architecture only):` use `get_architecture_overview` only for module/entrypoint/public-API questions, not symbol lookup.
6. `Hard rules:` do not use `ask_codebase`; do not jump to Step 5 for targeted lookup; use native `Read/Grep` only as fallback when MCP output is insufficient/ambiguous.

## Tool Selection Guide

### Finding Code
- **`search_symbols`**: Find symbols by name and/or type signatures
- **`list_files`**: Browse indexed files with summaries
- **`list_functions`**: See all functions in a file; use `include_source: true` for top implementations

### Understanding Code
- **`get_function`** / **`get_class`**: Get full implementation of specific symbols
- **`get_related_context`**: Bundle a function with its types, callees, and tests

### Tracing Behavior and Types
- **`find_references`**: Find all usages of a symbol
- **`trace_calls`**: Trace callers, callees, or both with one tool
- **`trace_types`**: Trace inheritance hierarchy or implementations
- **`get_module_dependencies`**: Import/export graph for a file

### Architecture
- **`get_architecture_overview`**: Module map, dependency graph, entry points, and absorbed public API (high-level architecture only)

### AI-Powered Discovery
- **`suggest_related`**: Use after finding one relevant symbol to discover adjacent code you did not know to search for

### Configuration Files
- Config files are usually small; read them directly when needed

## After Making Changes

Call `sync_index` after editing files to keep the index current:
```
sync_index({ files: ["path/to/edited.ts"] })
```
When call/type/import relationships changed significantly, rebuild chains in the same call:
```
sync_index({ rebuild_chains: true })
```

## Why Use LazyLoadingAI Tools?

1. **Token efficiency**: Read only the code you need, not entire files
2. **Semantic understanding**: Find code by meaning, not just text patterns
3. **Context bundling**: Get related code (types, tests, callees) in one call
4. **Fuzzy matching**: Find code even with typos or partial names
