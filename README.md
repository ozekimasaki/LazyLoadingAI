# LazyLoadingAI

**Smart code context for AI assistants — fetch exactly what you need, nothing more.**
[Japanese README](./README.ja.md)

[![npm](https://img.shields.io/npm/v/lazyloadingai)](https://www.npmjs.com/package/lazyloadingai)
[![license](https://img.shields.io/npm/l/lazyloadingai)](LICENSE)

AI coding assistants are fast, but they're often slow to understand large codebases — dumping entire files into context when a single function would do. LazyLoadingAI indexes your codebase into a local SQLite database and exposes 13 MCP tools that let AI assistants fetch *exactly* the symbols, call graphs, and architecture maps they need, when they need them.

---

## How it works

```
1. Index   →   AST-parse your TypeScript, JavaScript, and Python files
               Store symbols, types, call graphs, and relationships in SQLite

2. Serve   →   Start the MCP server (once per project)
               AI assistants connect and discover the 13 available tools

3. Query   →   Assistant calls search_symbols, get_function, trace_calls, etc.
               Gets back compact TSV output — relevant context, minimal tokens
```

The TypeScript/JavaScript parser uses [ts-morph](https://ts-morph.com/) for full type resolution. Python is parsed via [tree-sitter](https://tree-sitter.github.io/tree-sitter/). `suggest_related` uses Markov chains trained on co-occurrence and call-flow patterns to surface symbols you didn't know to ask for.

---

## Benchmark results

15-run validation benchmark comparing AI task performance without vs. with LazyLoadingAI installed:

| Task | Type | Token savings | Speedup | Quality Δ |
|------|------|:---:|:---:|:---:|
| Find route handler | targeted | 57% | 1.69× | 0 |
| Generate reply | targeted | −40% | 0.80× | 0 |
| Parse request body | targeted | −15% | 1.25× | +3.7 |
| Architecture overview | exploration | **92%** | **2.27×** | 0 |
| Trace error flow | exploration | **68%** | **12×** | −0.3 |
| **Average** | | **32%** | **3.62×** | **+0.7** |

Cost savings: ~39% on model tokens, ~80% including prompt cache hits.

LazyLoadingAI shines on exploration tasks — architecture questions and call-flow tracing — where the alternative is loading many files. For simple targeted lookups on small files, the overhead can outweigh the savings.

---

## Tools

13 MCP tools grouped by purpose:

| Group | Tools | What they do |
|-------|-------|-------------|
| **Discovery** | `list_files`, `list_functions`, `search_symbols` | Orient in the codebase; find symbols by name or type signature |
| **Reading** | `get_function`, `get_class`, `get_related_context` | Fetch full source for a symbol; bundle source + types + callees in one call |
| **Relationship tracing** | `find_references`, `trace_calls`, `trace_types`, `get_module_dependencies` | Call graphs, inheritance hierarchies, import/reverse-import graphs |
| **Architecture** | `get_architecture_overview` | Module map, entry points, and public API for broad structural questions |
| **Intelligence** | `suggest_related`, `sync_index` | Markov-chain symbol recommendations; re-index after edits |

All tools support a `format` parameter (`compact` / `markdown`). Compact mode returns TSV sections and `===SOURCE===` blocks — dense output that keeps token usage low.

---

## Quick start

```bash
npm install -g lazyloadingai
cd your-project
lazyloadingai init
```

`init` is interactive: it asks which AI clients you use and runs the initial index. To accept all defaults non-interactively:

```bash
lazyloadingai init --yes
```

This creates:
- `.mcp.json` — MCP server config for Claude Code
- `.cursor/mcp.json` — MCP server config for Cursor
- `~/.codex/config.toml` — MCP server config for Codex CLI
- `CLAUDE.md` / `AGENTS.md` — usage instructions injected into AI context
- `lazyload.config.json` — indexing configuration
- `.lazyload/index.db` — the index (added to `.gitignore` automatically)

### `.mcp.json` (Claude Code)

```json
{
  "mcpServers": {
    "lazyloadingai": {
      "command": "npx",
      "args": ["lazyloadingai", "serve", "--root", "."]
    }
  }
}
```

---

## Supported environments

| Client | Config file | Notes |
|--------|-------------|-------|
| [Claude Code](https://claude.ai/code) | `.mcp.json` | `CLAUDE.md` template included |
| [Cursor](https://cursor.sh) | `.cursor/mcp.json` | `CLAUDE.md` template included |
| [Codex CLI](https://github.com/openai/codex) | `~/.codex/config.toml` | `AGENTS.md` template included |

---

## Configuration

`lazyload.config.json` controls what gets indexed:

```json
{
  "directories": ["."],
  "include": [
    "**/*.ts", "**/*.tsx",
    "**/*.js", "**/*.jsx",
    "**/*.py"
  ],
  "exclude": [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/.git/**",
    "**/venv/**",
    "**/__pycache__/**",
    "**/coverage/**"
  ]
}
```

Re-index after changing this file:

```bash
lazyloadingai index
```

Or keep the index live while you develop:

```bash
lazyloadingai watch
```

---

## Development

```bash
# Build
npm run build

# Run tests
npm test
npm run test:unit
npm run test:integration

# Benchmarks
npm run benchmark:validate           # full 15-run validation (without vs installed)
npm run benchmark:validate:quick     # quick 2-task smoke test
```

Requirements: Node.js ≥ 18

---

## License

MIT

