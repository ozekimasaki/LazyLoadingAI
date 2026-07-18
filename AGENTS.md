# AGENTS.md

Guidelines for coding agents working in the **LazyLoadingAI** repository.

LazyLoadingAI is an MCP (Model Context Protocol) server, written in TypeScript, that
indexes a codebase into a local SQLite database and exposes 13 tools so AI assistants
can fetch symbols, call graphs, and architecture maps on demand. See [README.md](./README.md)
for the user-facing overview.

## Project layout

- `src/` — all source (compiled with `tsc` to `dist/`)
  - `cli/` — `commander`-based CLI. Entry point `src/cli/index.ts`; subcommands in `cli/commands/` (`init`, `index-cmd`, `serve`, `query`, `watch`, `stats`).
  - `server/` — MCP server. `server/index.ts` wires up the server; `server/tools/index.ts` registers all 13 tools (`registerTools`), and each tool has its own module in `server/tools/`.
  - `indexer/` — indexing pipeline: `parsers/` (`typescript.ts` via ts-morph, `python.ts` via tree-sitter, `registry.ts`), `storage/` (`sqlite.ts` via better-sqlite3), `watcher.ts` (chokidar), `path-resolver.ts`, `import-resolver.ts`, `type-extractor.ts`.
  - `config/` — zod config schema (`schema.ts`) and loader (`loader.ts`).
  - `markov/` — Markov-chain relationship modeling powering `suggest_related`.
  - `synonyms/` — synonym expansion used by symbol search.
  - `templates/` — generators for the `CLAUDE.md` / `AGENTS.md` files that `init` writes into a **target** project (not this repo's own docs).
  - `types/` — shared type definitions.
  - `index.ts` — library entry point re-exporting the public API (`Indexer`, `Watcher`, parsers, storage, server, config).
- `tests/` — vitest suites: `unit/`, `integration/`, `e2e/`, plus `helpers/`, `fixtures/`, and `vitest.setup.ts`.
- `benchmarks/` — token-comparison and validation benchmark scripts.
- `docs/` — `CLAUDE_TEMPLATE.md`.
- `lazyload.config.example.json` — sample indexing config.

## Package entry points (`package.json`)

- `main`: `dist/index.js`, `types`: `dist/index.d.ts`
- `bin`: `lazy-load` and `lazyloadingai` → `dist/cli/index.js`
- `type: module` — the package is ESM.

## Setup

```bash
npm install
```

Requires Node.js ≥ 18 (development here uses Node 20). Native dependencies
(`better-sqlite3`, `tree-sitter`, `tree-sitter-python`) compile on install, so a working
C/C++ toolchain must be available.

## Build / test / typecheck commands

| Task | Command |
|------|---------|
| Build (emit `dist/`) | `npm run build` (runs `tsc`) |
| Watch build | `npm run dev` |
| Typecheck (no emit) | `npx tsc --noEmit` |
| Run all tests (watch) | `npm test` |
| Unit tests | `npm run test:unit` |
| Integration tests | `npm run test:integration` |
| E2E tests | `npm run test:e2e` |
| Clean build output | `npm run clean` |

`npm run build` performs a full typecheck as a side effect. Testing uses **vitest**
(`vitest.config.ts`); tests live under `tests/**/*.test.ts`, run with `globals: true`,
the `forks` pool, and coverage thresholds of 80% statements/functions/lines and 75%
branches. Run a single file with `npx vitest run tests/unit/config/schema.test.ts`.

### Linting

`package.json` defines `npm run lint` (`eslint src --ext .ts`), but **ESLint is not
currently installed and there is no ESLint config in the repo**, so the script fails as-is.
Do not assume lint runs; rely on `tsc` (strict mode) for static checking. If you add
linting, add both the `eslint` dependency and a config file.

## Coding conventions

- **TypeScript strict mode.** `tsconfig.json` enables `strict`, `noImplicitReturns`,
  `noFallthroughCasesInSwitch`, `noUncheckedIndexedAccess`, and
  `noPropertyAccessFromIndexSignature`. Honor these — e.g. index-signature properties
  must be read with bracket notation (`process.env['LAZYLOAD_ROOT']`), and indexed access
  yields `T | undefined`.
- **ESM with NodeNext resolution.** Relative imports MUST include the `.js` extension
  (e.g. `import { Indexer } from '../../indexer/index.js';`) even though the source is
  `.ts`. Keep all imports at the top of the file.
- **Config validation is zod-first.** Add or change configuration in `src/config/schema.ts`;
  types are inferred via `z.infer`.
- **MCP tool naming.** Tools use `snake_case` names and `snake_case` parameters at the MCP
  boundary (see `server/tools/index.ts`); internal tool functions take `camelCase` options.
  Most tools accept a `format` parameter (`compact` | `markdown`, default `compact`).
- Follow the existing style in neighboring files: 2-space indentation, single quotes,
  semicolons, `node:`-prefixed builtin imports.

## Gotchas

- **`serve` uses stdout for the MCP protocol.** Never `console.log` to stdout from the
  server path; log diagnostics to stderr (`console.error`), as the existing code does.
- The index database defaults to `.lazyload/index.db` and is git-ignored; `*.db` files and
  `.lazyload/` are excluded via `.gitignore`.
- The `serve` command falls back to `LAZYLOAD_DATABASE` and `LAZYLOAD_ROOT` env vars when
  `--database` / `--root` are not passed.
- `src/templates/*` generate docs for **consumer** projects; they are unrelated to this
  repo's own `README.md` / `AGENTS.md`.
- There are no git pre-commit hooks configured in this repo.

## Before opening a PR

1. `npm run build` (must pass — this is the effective typecheck gate).
2. Run the relevant test suites (`npm run test:unit`, and integration/e2e when touching
   those areas); keep coverage above the configured thresholds.
3. Keep changes focused and match surrounding conventions.
