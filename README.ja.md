# LazyLoadingAI（日本語版）

**AIコーディング支援向けのスマートなコードコンテキスト取得ツール。必要な情報だけを、必要なときに。**

[English README](./README.md)

[![npm](https://img.shields.io/npm/v/lazyloadingai)](https://www.npmjs.com/package/lazyloadingai)
[![license](https://img.shields.io/npm/l/lazyloadingai)](LICENSE)

AIアシスタントは高速ですが、大規模コードベースの理解では不要に広い範囲を読み込んでしまいがちです。  
LazyLoadingAIはコードベースをローカルSQLiteにインデックス化し、13個のMCPツール経由で、必要なシンボル・呼び出し関係・構造情報だけを取得できるようにします。

このリポジトリ（フォーク）: https://github.com/ozekimasaki/LazyLoadingAI

---

## 仕組み

```text
1. Index   →   TypeScript / JavaScript / Python をAST解析
               シンボル、型、呼び出し関係をSQLiteへ格納

2. Serve   →   MCPサーバーを起動
               AIクライアントが13ツールを発見して利用

3. Query   →   search_symbols, get_function, trace_calls などを実行
               低トークンなコンパクト出力で必要情報のみ返す
```

- TypeScript/JavaScript 解析: `ts-morph`
- Python解析: `tree-sitter`
- `suggest_related`: 共起・呼び出しフローを元にしたMarkov chainで関連シンボルを推薦

---

## ベンチマーク結果（README掲載値）

15回の検証ベンチマーク（LazyLoadingAIなし vs あり）:

| タスク | 種別 | トークン削減 | 高速化 | 品質差分 |
|------|------|:---:|:---:|:---:|
| ルートハンドラ探索 | targeted | 57% | 1.69x | 0 |
| 返信文生成 | targeted | -40% | 0.80x | 0 |
| リクエストボディ解析 | targeted | -15% | 1.25x | +3.7 |
| アーキテクチャ概要 | exploration | **92%** | **2.27x** | 0 |
| エラーフロー追跡 | exploration | **68%** | **12x** | -0.3 |
| **平均** | | **32%** | **3.62x** | **+0.7** |

コスト削減（README記載）: モデルトークンで約39%、プロンプトキャッシュ込みで約80%。

---

## MCPツール（13個）

| グループ | ツール | できること |
|-------|-------|-------------|
| **探索** | `list_files`, `list_functions`, `search_symbols` | どこに何があるか把握し、名前や型で候補を探す |
| **読み取り** | `get_function`, `get_class`, `get_related_context` | 関数/クラス本体や周辺コンテキストを取得する |
| **関係追跡** | `find_references`, `trace_calls`, `trace_types`, `get_module_dependencies` | 参照箇所、呼び出し関係、継承、依存関係を追う |
| **構造把握** | `get_architecture_overview` | モジュール構成・依存・公開APIを俯瞰する |
| **補助** | `suggest_related`, `sync_index` | 関連シンボル推薦、編集後の再同期 |

多くのツールは `format` パラメータをサポート（`compact` / `markdown`）。  
`compact` はTSVベースでトークン使用量を抑えやすい出力です。

---

## クイックスタート

```bash
npm install -g lazyloadingai
cd your-project
lazyloadingai init
```

`init` は対話型セットアップです。  
デフォルトで非対話実行する場合:

```bash
lazyloadingai init --yes
```

作成される主なファイル:

- `.mcp.json`（Claude Code向け）
- `.cursor/mcp.json`（Cursor向け）
- `~/.codex/config.toml`（Codex CLI向け）
- `CLAUDE.md` / `AGENTS.md`（利用ガイド挿入）
- `lazyload.config.json`（インデックス設定）
- `.lazyload/index.db`（ローカルインデックスDB）

---

## 対応クライアント

| クライアント | 設定ファイル | 備考 |
|--------|-------------|-------|
| Claude Code | `.mcp.json` | `CLAUDE.md` テンプレート対応 |
| Cursor | `.cursor/mcp.json` | `CLAUDE.md` テンプレート対応 |
| Codex CLI | `~/.codex/config.toml` | `AGENTS.md` テンプレート対応 |

---

## 設定（`lazyload.config.json`）

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

設定変更後の再インデックス:

```bash
lazyloadingai index
```

監視しながら自動反映:

```bash
lazyloadingai watch
```

---

## CLIコマンド

- `lazyloadingai init` セットアップ
- `lazyloadingai index` インデックス作成
- `lazyloadingai serve` MCPサーバー起動
- `lazyloadingai query` シンボル問い合わせ
- `lazyloadingai watch` 変更監視＆再インデックス
- `lazyloadingai stats` インデックス統計表示

---

## 開発

```bash
# Build
npm run build

# Tests
npm test
npm run test:unit
npm run test:integration
npm run test:e2e

# Benchmarks
npm run benchmark:validate
npm run benchmark:validate:quick
```

要件: Node.js 18以上

---

## ライセンス

MIT
