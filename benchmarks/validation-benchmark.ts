#!/usr/bin/env node
/**
 * Post-Implementation Validation Benchmark
 *
 * Runs Claude Code programmatically against fastify/fastify (~30k lines TS),
 * executing identical tasks in WITHOUT, WITH, and NATURAL modes, then
 * compares token usage and response quality side-by-side.
 *
 * Usage:
 *   npm run benchmark:validate                  # Full run (5 tasks)
 *   npm run benchmark:validate -- --dry-run     # Setup only, no API calls
 *   npm run benchmark:validate -- --tasks 1,4   # Run specific tasks
 *   npm run benchmark:validate -- --session-only --session-queries 5
 *   npm run benchmark:validate -- --dry-run --reindex
 *   npm run benchmark:validate -- --max-tool-calls 10 --format markdown
 *   npm run benchmark:validate -- --modes without,forced,natural --runs 10 --format compact
 *   npm run benchmark:validate -- --without-vs-natural    # Preset: --modes without,natural --runs 5
 *   npm run benchmark:validate -- --without-vs-installed  # Preset: --modes without,installed --runs 5
 *   npm run benchmark:validate -- --runs 4
 *   npm run benchmark:validate -- --rescore benchmarks/results/validation-2026-02-15.json
 *   npm run benchmark:validate -- --rescore <input.json> --output <output.json>
 */

import { query, type CanUseTool } from "@anthropic-ai/claude-code";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { Indexer } from "../dist/indexer/index.js";
import { generateClaudeMdContent } from "../dist/templates/claude-md.js";
import {
  calculateCostFromUsage,
  getPricingForModel,
  type CostBreakdown,
} from "../src/benchmarks/pricing.ts";
import {
  evaluateValidationResponse,
  VALIDATION_EVALUATOR,
  type QualityScores,
  type ValidationQualityRaw,
} from "../src/benchmarks/validation-rubric.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MODEL = "claude-sonnet-4-5-20250929";
const MAX_TURNS = 15;
const RATE_LIMIT_MS = 10_000;
const FASTIFY_REPO = "https://github.com/fastify/fastify.git";
const REPOS_DIR = path.join(__dirname, ".repos");
const FASTIFY_DIR = path.join(REPOS_DIR, "fastify");
const RESULTS_DIR = path.join(__dirname, "results");
const PRICING = getPricingForModel(MODEL);
const FORCED_PROMPT_PREFIX =
  "You have LazyLoading MCP tools available. Use LazyLoading MCP tools first for discovery and retrieval, and only use direct file reads as fallback.";
type ToolResponseFormat = "compact" | "markdown";
const NATIVE_TOOLS = ["Read", "Glob", "Grep", "Bash(read-only)"] as const;
const ALL_LAZYLOADING_MCP_TOOLS = [
  "mcp__lazyloadingai__list_files",
  "mcp__lazyloadingai__list_functions",
  "mcp__lazyloadingai__get_function",
  "mcp__lazyloadingai__get_class",
  "mcp__lazyloadingai__search_symbols",
  "mcp__lazyloadingai__find_references",
  "mcp__lazyloadingai__trace_calls",
  "mcp__lazyloadingai__trace_types",
  "mcp__lazyloadingai__suggest_related",
  "mcp__lazyloadingai__get_related_context",
  "mcp__lazyloadingai__get_architecture_overview",
  "mcp__lazyloadingai__get_module_dependencies",
  "mcp__lazyloadingai__sync_index",
] as const;

const MCP_TOOLS_BY_TASK: Record<number, string[]> = {
  1: [
    "mcp__lazyloadingai__search_symbols",
    "mcp__lazyloadingai__list_functions",
    "mcp__lazyloadingai__get_function",
  ],
  2: [
    "mcp__lazyloadingai__search_symbols",
    "mcp__lazyloadingai__get_class",
    "mcp__lazyloadingai__get_related_context",
  ],
  3: [
    "mcp__lazyloadingai__search_symbols",
    "mcp__lazyloadingai__get_function",
    "mcp__lazyloadingai__trace_calls",
    "mcp__lazyloadingai__get_related_context",
  ],
  4: [
    "mcp__lazyloadingai__get_architecture_overview",
    "mcp__lazyloadingai__list_files",
    "mcp__lazyloadingai__get_module_dependencies",
    "mcp__lazyloadingai__suggest_related",
  ],
  5: [
    "mcp__lazyloadingai__search_symbols",
    "mcp__lazyloadingai__trace_calls",
    "mcp__lazyloadingai__find_references",
    "mcp__lazyloadingai__get_function",
    "mcp__lazyloadingai__get_related_context",
  ],
};

const ARCHITECTURE_OVERVIEW_TOOL = "mcp__lazyloadingai__get_architecture_overview";
const DEFAULT_TOOL_BUDGET_BY_MODE: Record<TaskDef["mode"], number> = {
  targeted: 6,
  exploration: 8,
};
const TOOL_BUDGET_OVERRIDES: Partial<Record<number, number>> = {
  4: 4,
  5: 8,
};
const READ_BUDGET_BY_MODE: Record<TaskDef["mode"], number> = {
  targeted: 1,
  exploration: 2,
};

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface RunResult {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  model_tokens: number;
  cache_tokens: number;
  total_tokens: number;
  sdk_cost_usd: number;
  cost_usd: number;
  cost_breakdown: CostBreakdown;
  tool_calls: string[];
  tool_response_bytes: Record<string, number>;
  final_response: string;
  elapsed_ms: number;
  quality: QualityScores;
  quality_raw: ValidationQualityRaw;
}

interface TaskResult {
  id: number;
  prompt: string;
  mode: string;
  without: RunResult;
  with: RunResult;
  natural: RunResult;
  savings_percent_total: number;
  savings_percent_cost: number;
  savings_percent: number;
  speedup_x: number;
  quality_delta: number;
  natural_savings_percent_total: number;
  natural_savings_percent_cost: number;
  natural_savings_percent: number;
  natural_speedup_x: number;
  natural_quality_delta: number;
  natural_vs_forced_model_delta_percent: number;
  natural_vs_forced_total_delta_percent: number;
  natural_vs_forced_cost_delta_percent: number;
  natural_vs_forced_quality_delta: number;
  run_summary?: TaskRunSummary;
  run_results?: TaskRunSample[];
}

interface MetricSummary {
  min: number;
  median: number;
  max: number;
}

interface TaskRunSummary {
  run_count: number;
  representative_run: number;
  savings_percent: MetricSummary;
  savings_percent_total: MetricSummary;
  savings_percent_cost: MetricSummary;
  speedup_x: MetricSummary;
  quality_delta: MetricSummary;
  natural_savings_percent: MetricSummary;
  natural_savings_percent_total: MetricSummary;
  natural_savings_percent_cost: MetricSummary;
  natural_speedup_x: MetricSummary;
  natural_quality_delta: MetricSummary;
  natural_vs_forced_model_delta_percent: MetricSummary;
  natural_vs_forced_total_delta_percent: MetricSummary;
  natural_vs_forced_cost_delta_percent: MetricSummary;
  natural_vs_forced_quality_delta: MetricSummary;
  without_model_tokens: MetricSummary;
  with_model_tokens: MetricSummary;
  natural_model_tokens: MetricSummary;
  without_total_tokens: MetricSummary;
  with_total_tokens: MetricSummary;
  natural_total_tokens: MetricSummary;
  without_cost_usd: MetricSummary;
  with_cost_usd: MetricSummary;
  natural_cost_usd: MetricSummary;
  without_elapsed_ms: MetricSummary;
  with_elapsed_ms: MetricSummary;
  natural_elapsed_ms: MetricSummary;
}

interface TaskRunSample {
  run: number;
  without: {
    model_tokens: number;
    total_tokens: number;
    cost_usd: number;
    elapsed_ms: number;
    quality_avg: number;
  };
  with: {
    model_tokens: number;
    total_tokens: number;
    cost_usd: number;
    elapsed_ms: number;
    quality_avg: number;
  };
  natural: {
    model_tokens: number;
    total_tokens: number;
    cost_usd: number;
    elapsed_ms: number;
    quality_avg: number;
  };
  savings_percent_total: number;
  savings_percent_cost: number;
  savings_percent: number;
  speedup_x: number;
  quality_delta: number;
  natural_savings_percent_total: number;
  natural_savings_percent_cost: number;
  natural_savings_percent: number;
  natural_speedup_x: number;
  natural_quality_delta: number;
  natural_vs_forced_model_delta_percent: number;
  natural_vs_forced_total_delta_percent: number;
  natural_vs_forced_cost_delta_percent: number;
  natural_vs_forced_quality_delta: number;
}

interface BenchmarkOutput {
  benchmark: string;
  timestamp: string;
  target_codebase: string;
  model: string;
  with_mode: "forced" | "installed";
  evaluator: {
    type: string;
    version: string;
  };
  tasks: TaskResult[];
  session_comparison?: SessionComparison;
  summary: {
    avg_tokens_without: number;
    avg_tokens_with: number;
    avg_tokens_natural: number;
    avg_total_tokens_without: number;
    avg_total_tokens_with: number;
    avg_total_tokens_natural: number;
    avg_savings_percent: number;
    avg_savings_total_percent: number;
    avg_savings_cost_percent: number;
    avg_natural_savings_percent: number;
    avg_natural_savings_total_percent: number;
    avg_natural_savings_cost_percent: number;
    avg_cost_without_usd: number;
    avg_cost_with_usd: number;
    avg_cost_natural_usd: number;
    avg_sdk_cost_without_usd: number;
    avg_sdk_cost_with_usd: number;
    avg_sdk_cost_natural_usd: number;
    avg_quality_without: number;
    avg_quality_with: number;
    avg_quality_natural: number;
    avg_elapsed_ms_without: number;
    avg_elapsed_ms_with: number;
    avg_elapsed_ms_natural: number;
    avg_speedup_x: number;
    avg_natural_speedup_x: number;
    avg_natural_vs_forced_model_delta_percent: number;
    avg_natural_vs_forced_total_delta_percent: number;
    avg_natural_vs_forced_cost_delta_percent: number;
    avg_natural_vs_forced_quality_delta: number;
  };
}

interface SessionTurnResult {
  turn: number;
  task_id: number;
  task_name: string;
  without: Omit<RunResult, "quality" | "quality_raw">;
  with: Omit<RunResult, "quality" | "quality_raw">;
  natural?: Omit<RunResult, "quality" | "quality_raw">;
  cumulative_without_cost_usd: number;
  cumulative_with_cost_usd: number;
  cumulative_natural_cost_usd?: number;
  cumulative_cost_savings_percent: number;
  cumulative_natural_cost_savings_percent?: number;
  cumulative_natural_vs_forced_cost_delta_percent?: number;
}

interface SessionComparison {
  query_count: number;
  breakeven_query: number | null;
  natural_breakeven_query?: number | null;
  final_cost_without_usd: number;
  final_cost_with_usd: number;
  final_cost_natural_usd?: number;
  final_savings_percent: number;
  final_natural_savings_percent?: number;
  final_natural_vs_forced_delta_percent?: number;
  turns: SessionTurnResult[];
}

// ---------------------------------------------------------------------------
// Task definitions
// ---------------------------------------------------------------------------

interface TaskDef {
  id: number;
  mode: "targeted" | "exploration";
  shortName: string;
  prompt: string;
}

type BenchmarkMode = "without" | "forced" | "natural" | "installed";
const DEFAULT_BENCHMARK_MODES: readonly BenchmarkMode[] = [
  "without",
  "forced",
  "natural",
];
const VALID_BENCHMARK_MODES: readonly BenchmarkMode[] = [
  "without",
  "forced",
  "natural",
  "installed",
];

const TASKS: TaskDef[] = [
  {
    id: 1,
    mode: "targeted",
    shortName: "Route",
    prompt:
      "Find the function that registers a new route in fastify. Show me its full implementation and explain its parameters.",
  },
  {
    id: 2,
    mode: "targeted",
    shortName: "Reply",
    prompt:
      "What is the `Reply` class? Show me its implementation and list its most important methods.",
  },
  {
    id: 3,
    mode: "targeted",
    shortName: "Body Parse",
    prompt:
      "Find the function responsible for parsing incoming request bodies. Start from the highest-level entry point that initiates parsing, not the low-level implementation. Show its implementation and trace what functions it calls.",
  },
  {
    id: 4,
    mode: "exploration",
    shortName: "Architecture",
    prompt:
      "Give me an architectural overview of this codebase. What are the main modules, how do they connect, and what are the key entry points?",
  },
  {
    id: 5,
    mode: "exploration",
    shortName: "Error Flow",
    prompt:
      "How does error handling work in this codebase? Trace the flow from when a route handler throws an error to when the error response is sent to the client.",
  },
];

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const WITHOUT_VS_NATURAL_PRESET = argv.includes("--without-vs-natural");
const WITHOUT_VS_INSTALLED_PRESET = argv.includes("--without-vs-installed");

function parseBenchmarkModes(rawValue: string | null): BenchmarkMode[] {
  if (!rawValue) {
    return [...DEFAULT_BENCHMARK_MODES];
  }

  const tokens = rawValue
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    throw new Error(
      "Invalid --modes value. Use comma-separated modes: without,forced,natural,installed.",
    );
  }

  const normalized = tokens.map((token) => {
    const canonical =
      token === "with"
        ? "forced"
        : token === "real"
          ? "installed"
        : token === "baseline"
          ? "without"
          : token;

    if ((VALID_BENCHMARK_MODES as readonly string[]).includes(canonical)) {
      return canonical as BenchmarkMode;
    }

    throw new Error(
      `Invalid mode '${token}' in --modes. Use: without,forced,natural,installed.`,
    );
  });

  return VALID_BENCHMARK_MODES.filter((mode) => normalized.includes(mode));
}

const DRY_RUN = argv.includes("--dry-run");
const SESSION_ONLY = argv.includes("--session-only");
const FORCE_REINDEX = argv.includes("--reindex");
const modesIdx = argv.indexOf("--modes");
const APPLY_WITHOUT_VS_NATURAL_PRESET =
  WITHOUT_VS_NATURAL_PRESET && modesIdx === -1;
const APPLY_WITHOUT_VS_INSTALLED_PRESET =
  WITHOUT_VS_INSTALLED_PRESET && modesIdx === -1;
const BENCHMARK_MODES = parseBenchmarkModes(
  modesIdx !== -1 && argv[modesIdx + 1]
    ? argv[modesIdx + 1]!
    : APPLY_WITHOUT_VS_INSTALLED_PRESET
      ? "without,installed"
      : APPLY_WITHOUT_VS_NATURAL_PRESET
      ? "without,natural"
      : null,
);
const RUN_WITHOUT = BENCHMARK_MODES.includes("without");
const RUN_FORCED = BENCHMARK_MODES.includes("forced");
const RUN_INSTALLED = BENCHMARK_MODES.includes("installed");
const RUN_WITH = RUN_FORCED || RUN_INSTALLED;
const RUN_NATURAL = BENCHMARK_MODES.includes("natural");
if (RUN_FORCED && RUN_INSTALLED) {
  throw new Error(
    "Cannot run both 'forced' and 'installed' in the same benchmark - they share the WITH comparison slot. Pick one.",
  );
}
const WITH_LABEL = RUN_INSTALLED ? "INSTALLED" : "FORCED";
const COMPARISON_BASELINE_MODE: BenchmarkMode = RUN_WITHOUT
  ? "without"
  : BENCHMARK_MODES[0]!;
const rescoreIdx = argv.indexOf("--rescore");
const RESCORE_INPUT =
  rescoreIdx !== -1 && argv[rescoreIdx + 1]
    ? path.resolve(argv[rescoreIdx + 1]!)
    : null;
const outputIdx = argv.indexOf("--output");
const RESCORE_OUTPUT_PATH =
  outputIdx !== -1 && argv[outputIdx + 1]
    ? path.resolve(argv[outputIdx + 1]!)
    : null;
const sessionQueriesIdx = argv.indexOf("--session-queries");
const SESSION_QUERY_COUNT = (() => {
  if (sessionQueriesIdx === -1 || !argv[sessionQueriesIdx + 1]) return 5;
  const parsed = Number(argv[sessionQueriesIdx + 1]);
  if (!Number.isFinite(parsed) || parsed <= 0) return 5;
  return Math.min(Math.max(Math.floor(parsed), 1), 10);
})();
const runsIdx = argv.indexOf("--runs");
const RUN_COUNT = (() => {
  if (runsIdx === -1 || !argv[runsIdx + 1]) {
    return APPLY_WITHOUT_VS_NATURAL_PRESET || APPLY_WITHOUT_VS_INSTALLED_PRESET
      ? 5
      : 1;
  }
  const parsed = Number(argv[runsIdx + 1]);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.min(Math.max(Math.floor(parsed), 1), 20);
})();
const maxToolCallsIdx = argv.indexOf("--max-tool-calls");
const MAX_TOOL_CALLS = (() => {
  if (maxToolCallsIdx === -1 || !argv[maxToolCallsIdx + 1]) return 10;
  const parsed = Number(argv[maxToolCallsIdx + 1]);
  if (!Number.isFinite(parsed) || parsed <= 0) return 10;
  return Math.min(Math.max(Math.floor(parsed), 1), 50);
})();
const formatIdx = argv.indexOf("--format");
const TOOL_RESPONSE_FORMAT: ToolResponseFormat = (() => {
  if (formatIdx === -1 || !argv[formatIdx + 1]) return "compact";
  const format = argv[formatIdx + 1];
  if (format === "compact" || format === "markdown") {
    return format;
  }
  return "compact";
})();
const tasksIdx = argv.indexOf("--tasks");
const SELECTED_IDS: number[] | null =
  tasksIdx !== -1 && argv[tasksIdx + 1]
    ? argv[tasksIdx + 1]!.split(",").map(Number)
    : null;

const tasksToRun = SELECTED_IDS
  ? TASKS.filter((t) => SELECTED_IDS.includes(t.id))
  : TASKS;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
type RunMetrics = Omit<RunResult, "quality" | "quality_raw">;

function runQuery(
  args: Parameters<typeof query>[0],
): AsyncIterable<any> {
  if (process.env.VALIDATION_BENCHMARK_FORBID_QUERY === "1") {
    throw new Error(
      "Query calls are forbidden in this process (VALIDATION_BENCHMARK_FORBID_QUERY=1).",
    );
  }
  return query(args);
}

function getEffectiveToolBudget(task: TaskDef): number {
  const modeBudget = DEFAULT_TOOL_BUDGET_BY_MODE[task.mode];
  const taskOverride = TOOL_BUDGET_OVERRIDES[task.id];
  return Math.min(MAX_TOOL_CALLS, taskOverride ?? modeBudget);
}

function buildWithSystemPrompt(task: TaskDef, toolBudget: number): string {
  const maxCallsBeforeSynthesis = Math.max(toolBudget - 2, 1);
  const lines = [
    FORCED_PROMPT_PREFIX,
    `Hard budget: max ${toolBudget} total tool calls. Calls above this are denied. After call ${maxCallsBeforeSynthesis}, stop calling tools and synthesize your answer from what you have. Always reserve at least 2000 output tokens for your final answer.`,
    "Use the minimum number of tool calls needed to produce a complete answer.",
    `When using LazyLoading MCP tools, always pass format: '${TOOL_RESPONSE_FORMAT}' to every tool call.`,
  ];

  if (task.id === 4) {
    lines.push(
      "For this architecture task, call get_architecture_overview once with focus: 'full', then synthesize. Avoid repetitive architecture calls.",
    );
  }

  if (task.id === 5) {
    lines.push(
      "Do not end with a planning stub. Deliver the full traced error flow in the final answer.",
    );
  }

  return lines.join("\n");
}

function createWithToolGuard(
  task: TaskDef,
  mcpTools: string[],
  toolBudget: number,
): CanUseTool {
  const allowedTools = new Set(["Read", ...mcpTools]);
  const maxReadCalls = Math.min(READ_BUDGET_BY_MODE[task.mode], toolBudget);
  const callsByTool = new Map<string, number>();
  let totalCalls = 0;

  return async (toolName, input) => {
    if (!allowedTools.has(toolName)) {
      return {
        behavior: "deny",
        message: `Tool '${toolName}' is disabled for this FORCED benchmark run. Use only the configured MCP tools and Read.`,
      };
    }

    if (totalCalls >= toolBudget) {
      return {
        behavior: "deny",
        message: `Tool budget reached (${toolBudget} calls). Stop using tools and provide the final answer now.`,
      };
    }

    const currentCallsForTool = callsByTool.get(toolName) ?? 0;

    if (toolName === "Read" && currentCallsForTool >= maxReadCalls) {
      return {
        behavior: "deny",
        message: `Read budget reached (${maxReadCalls} calls). Continue with MCP results and synthesize your answer.`,
      };
    }

    if (task.id === 4 && toolName === ARCHITECTURE_OVERVIEW_TOOL) {
      const requestedFocus =
        typeof input.focus === "string" ? input.focus.toLowerCase() : "";
      if (currentCallsForTool === 0 && requestedFocus !== "full") {
        return {
          behavior: "deny",
          message:
            "For this architecture task, call get_architecture_overview exactly once with focus: 'full'.",
        };
      }
      if (currentCallsForTool >= 1) {
        return {
          behavior: "deny",
          message:
            "You already called get_architecture_overview. Reuse that result and synthesize the architecture answer.",
        };
      }
    }

    totalCalls += 1;
    callsByTool.set(toolName, currentCallsForTool + 1);
    return {
      behavior: "allow",
      updatedInput: input,
    };
  };
}

function createWithoutToolGuard(): CanUseTool {
  return async (toolName, input) => {
    if (toolName.startsWith("mcp__")) {
      return {
        behavior: "deny",
        message: "MCP tools are disabled in WITHOUT mode.",
      };
    }
    return {
      behavior: "allow",
      updatedInput: input,
    };
  };
}

function dedupeTools(tools: readonly string[]): string[] {
  return [...new Set(tools)];
}

function buildNaturalAllowedTools(): string[] {
  return dedupeTools([...NATIVE_TOOLS, ...ALL_LAZYLOADING_MCP_TOOLS]);
}

function buildLazyLoadingMcpServerConfig(): Record<string, { command: string; args: string[] }> {
  const serverScript = path.resolve(__dirname, "../dist/cli/index.js");
  const dbPath = path.join(FASTIFY_DIR, ".lazyload/index.db");

  return {
    lazyloadingai: {
      command: "node",
      args: [
        serverScript,
        "serve",
        "--root",
        FASTIFY_DIR,
        "--database",
        dbPath,
      ],
    },
  };
}

function estimateToolResultBytes(content: unknown): number {
  if (typeof content === "string") return content.length;

  if (Array.isArray(content)) {
    return content.reduce((sum, block) => {
      if (typeof block === "string") return sum + block.length;
      if (block && typeof block === "object" && "text" in block) {
        const text = (block as { text?: unknown }).text;
        if (typeof text === "string") {
          return sum + text.length;
        }
      }

      try {
        return sum + JSON.stringify(block).length;
      } catch {
        return sum;
      }
    }, 0);
  }

  if (content == null) return 0;

  try {
    return JSON.stringify(content).length;
  } catch {
    return 0;
  }
}

function formatToolResponseBytes(toolBytes: Record<string, number>): string {
  const entries = Object.entries(toolBytes).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return "none";

  return entries
    .map(([tool, bytes]) => `${tool}=${bytes.toLocaleString()}B`)
    .join(", ");
}

function getTaskById(taskId: number): TaskDef {
  const task = TASKS.find((candidate) => candidate.id === taskId);
  if (!task) {
    throw new Error(`Unknown task id ${taskId}.`);
  }
  return task;
}

/**
 * Collect all messages from a Claude Code SDK query.
 * The Claude Code process may exit with code 1 after the conversation completes;
 * if we already captured a result message, keep the messages, otherwise rethrow.
 */
async function collectMessages(queryIter: AsyncIterable<any>): Promise<any[]> {
  const messages: any[] = [];
  try {
    for await (const msg of queryIter) {
      messages.push(msg);
    }
  } catch (err) {
    const hasResultMessage = messages.some((m) => m?.type === "result");
    if (!hasResultMessage) {
      throw err;
    }
  }
  return messages;
}

function avgQuality(q: QualityScores): number {
  return (q.completeness + q.accuracy + q.specificity) / 3;
}

function buildMetricSummary(values: number[]): MetricSummary {
  if (values.length === 0) {
    return { min: 0, median: 0, max: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1
      ? sorted[mid]!
      : (sorted[mid - 1]! + sorted[mid]!) / 2;

  return {
    min: sorted[0]!,
    median,
    max: sorted[sorted.length - 1]!,
  };
}

function pickRepresentativeRunIndex(taskRuns: TaskResult[]): number {
  const indexedRuns = taskRuns.map((result, index) => ({ result, index }));
  indexedRuns.sort((a, b) => {
    if (a.result.savings_percent_total !== b.result.savings_percent_total) {
      return a.result.savings_percent_total - b.result.savings_percent_total;
    }
    return a.index - b.index;
  });

  return indexedRuns[Math.floor((indexedRuns.length - 1) / 2)]!.index;
}

function toTaskRunSample(taskResult: TaskResult, run: number): TaskRunSample {
  return {
    run,
    without: {
      model_tokens: taskResult.without.model_tokens,
      total_tokens: taskResult.without.total_tokens,
      cost_usd: taskResult.without.cost_usd,
      elapsed_ms: taskResult.without.elapsed_ms,
      quality_avg: Number(avgQuality(taskResult.without.quality).toFixed(1)),
    },
    with: {
      model_tokens: taskResult.with.model_tokens,
      total_tokens: taskResult.with.total_tokens,
      cost_usd: taskResult.with.cost_usd,
      elapsed_ms: taskResult.with.elapsed_ms,
      quality_avg: Number(avgQuality(taskResult.with.quality).toFixed(1)),
    },
    natural: {
      model_tokens: taskResult.natural.model_tokens,
      total_tokens: taskResult.natural.total_tokens,
      cost_usd: taskResult.natural.cost_usd,
      elapsed_ms: taskResult.natural.elapsed_ms,
      quality_avg: Number(avgQuality(taskResult.natural.quality).toFixed(1)),
    },
    savings_percent_total: taskResult.savings_percent_total,
    savings_percent_cost: taskResult.savings_percent_cost,
    savings_percent: taskResult.savings_percent,
    speedup_x: taskResult.speedup_x,
    quality_delta: taskResult.quality_delta,
    natural_savings_percent_total: taskResult.natural_savings_percent_total,
    natural_savings_percent_cost: taskResult.natural_savings_percent_cost,
    natural_savings_percent: taskResult.natural_savings_percent,
    natural_speedup_x: taskResult.natural_speedup_x,
    natural_quality_delta: taskResult.natural_quality_delta,
    natural_vs_forced_model_delta_percent:
      taskResult.natural_vs_forced_model_delta_percent,
    natural_vs_forced_total_delta_percent:
      taskResult.natural_vs_forced_total_delta_percent,
    natural_vs_forced_cost_delta_percent:
      taskResult.natural_vs_forced_cost_delta_percent,
    natural_vs_forced_quality_delta:
      taskResult.natural_vs_forced_quality_delta,
  };
}

function aggregateTaskRuns(taskRuns: TaskResult[]): TaskResult {
  if (taskRuns.length === 0) {
    throw new Error("Cannot aggregate empty task runs.");
  }

  if (taskRuns.length === 1) {
    return taskRuns[0]!;
  }

  const representativeRunIndex = pickRepresentativeRunIndex(taskRuns);
  const representative = taskRuns[representativeRunIndex]!;

  return {
    ...representative,
    run_summary: {
      run_count: taskRuns.length,
      representative_run: representativeRunIndex + 1,
      savings_percent: buildMetricSummary(
        taskRuns.map((run) => run.savings_percent),
      ),
      savings_percent_total: buildMetricSummary(
        taskRuns.map((run) => run.savings_percent_total),
      ),
      savings_percent_cost: buildMetricSummary(
        taskRuns.map((run) => run.savings_percent_cost),
      ),
      speedup_x: buildMetricSummary(taskRuns.map((run) => run.speedup_x)),
      quality_delta: buildMetricSummary(
        taskRuns.map((run) => run.quality_delta),
      ),
      natural_savings_percent: buildMetricSummary(
        taskRuns.map((run) => run.natural_savings_percent),
      ),
      natural_savings_percent_total: buildMetricSummary(
        taskRuns.map((run) => run.natural_savings_percent_total),
      ),
      natural_savings_percent_cost: buildMetricSummary(
        taskRuns.map((run) => run.natural_savings_percent_cost),
      ),
      natural_speedup_x: buildMetricSummary(
        taskRuns.map((run) => run.natural_speedup_x),
      ),
      natural_quality_delta: buildMetricSummary(
        taskRuns.map((run) => run.natural_quality_delta),
      ),
      natural_vs_forced_model_delta_percent: buildMetricSummary(
        taskRuns.map((run) => run.natural_vs_forced_model_delta_percent),
      ),
      natural_vs_forced_total_delta_percent: buildMetricSummary(
        taskRuns.map((run) => run.natural_vs_forced_total_delta_percent),
      ),
      natural_vs_forced_cost_delta_percent: buildMetricSummary(
        taskRuns.map((run) => run.natural_vs_forced_cost_delta_percent),
      ),
      natural_vs_forced_quality_delta: buildMetricSummary(
        taskRuns.map((run) => run.natural_vs_forced_quality_delta),
      ),
      without_model_tokens: buildMetricSummary(
        taskRuns.map((run) => run.without.model_tokens),
      ),
      with_model_tokens: buildMetricSummary(
        taskRuns.map((run) => run.with.model_tokens),
      ),
      natural_model_tokens: buildMetricSummary(
        taskRuns.map((run) => run.natural.model_tokens),
      ),
      without_total_tokens: buildMetricSummary(
        taskRuns.map((run) => run.without.total_tokens),
      ),
      with_total_tokens: buildMetricSummary(
        taskRuns.map((run) => run.with.total_tokens),
      ),
      natural_total_tokens: buildMetricSummary(
        taskRuns.map((run) => run.natural.total_tokens),
      ),
      without_cost_usd: buildMetricSummary(
        taskRuns.map((run) => run.without.cost_usd),
      ),
      with_cost_usd: buildMetricSummary(taskRuns.map((run) => run.with.cost_usd)),
      natural_cost_usd: buildMetricSummary(
        taskRuns.map((run) => run.natural.cost_usd),
      ),
      without_elapsed_ms: buildMetricSummary(
        taskRuns.map((run) => run.without.elapsed_ms),
      ),
      with_elapsed_ms: buildMetricSummary(
        taskRuns.map((run) => run.with.elapsed_ms),
      ),
      natural_elapsed_ms: buildMetricSummary(
        taskRuns.map((run) => run.natural.elapsed_ms),
      ),
    },
    run_results: taskRuns.map((run, index) => toTaskRunSample(run, index + 1)),
  };
}

function getMessageContentBlocks(msg: any): any[] {
  const content = msg?.message?.content;
  if (Array.isArray(content)) {
    return content.filter((block) => block && typeof block === "object");
  }
  return [];
}

function getToolUseId(block: any): string | null {
  if (typeof block?.tool_use_id === "string") {
    return block.tool_use_id;
  }
  if (typeof block?.toolUseId === "string") {
    return block.toolUseId;
  }
  return null;
}

function getToolNameFromBlock(block: any): string | null {
  if (typeof block?.name === "string") {
    return block.name;
  }
  if (typeof block?.tool_name === "string") {
    return block.tool_name;
  }
  return null;
}

/**
 * Extract token usage, tool calls, and final response text from SDK messages.
 *
 * SDK message types:
 *   - type:"assistant" → content in msg.message.content (APIAssistantMessage)
 *   - type:"user"      → tool_result blocks for prior tool_use calls
 *   - type:"result"    → aggregated usage in msg.usage, final text in msg.result
 *   - type:"system"    → metadata (ignored)
 */
function extractMetrics(
  messages: any[],
  elapsed_ms: number,
): RunMetrics {
  let input_tokens = 0;
  let output_tokens = 0;
  let cache_read_tokens = 0;
  let cache_creation_tokens = 0;
  let model_tokens = 0;
  let cache_tokens = 0;
  let sdk_cost_usd = 0;
  let cost_usd = 0;
  let cost_breakdown = calculateCostFromUsage(
    {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
    },
    PRICING,
  );
  const tool_calls: string[] = [];
  const toolNameById = new Map<string, string>();
  const tool_response_bytes: Record<string, number> = {};
  let final_response = "";

  for (const msg of messages) {
    // Assistant + user messages: gather tool calls/results and text.
    if (
      (msg.type === "assistant" || msg.type === "user") &&
      msg.message
    ) {
      const contentBlocks = getMessageContentBlocks(msg);
      for (const block of contentBlocks) {
        if (msg.type === "assistant" && block.type === "tool_use") {
          const toolName = getToolNameFromBlock(block);
          if (toolName) {
            tool_calls.push(toolName);
            if (typeof block.id === "string") {
              toolNameById.set(block.id, toolName);
            }
          }
        }

        if (block.type === "tool_result") {
          const toolUseId =
            getToolUseId(block) ??
            (typeof msg.parent_tool_use_id === "string"
              ? msg.parent_tool_use_id
              : null);
          const explicitToolName = getToolNameFromBlock(block);
          const toolName =
            explicitToolName ??
            (toolUseId ? toolNameById.get(toolUseId) : null) ??
            "unknown";
          const bytes = estimateToolResultBytes(block.content);
          tool_response_bytes[toolName] =
            (tool_response_bytes[toolName] ?? 0) + bytes;

        }

        if (msg.type === "assistant" && block.type === "text" && block.text) {
          final_response = block.text as string;
        }
      }
    }

    // Result message: aggregated token usage and final answer
    if (msg.type === "result") {
      if (msg.usage) {
        input_tokens = msg.usage.input_tokens ?? 0;
        output_tokens = msg.usage.output_tokens ?? 0;
        cache_read_tokens = msg.usage.cache_read_input_tokens ?? 0;
        cache_creation_tokens = msg.usage.cache_creation_input_tokens ?? 0;
        model_tokens = input_tokens + output_tokens;
        cache_tokens = cache_read_tokens + cache_creation_tokens;
      }
      sdk_cost_usd = msg.total_cost_usd ?? 0;
      if (msg.result) {
        final_response = msg.result as string;
      }
    }
  }

  const total_tokens =
    input_tokens + cache_read_tokens + cache_creation_tokens + output_tokens;
  cost_breakdown = calculateCostFromUsage(
    {
      input_tokens,
      output_tokens,
      cache_read_tokens,
      cache_creation_tokens,
    },
    PRICING,
  );
  cost_usd = cost_breakdown.total_cost_usd;

  return {
    input_tokens,
    output_tokens,
    cache_read_tokens,
    cache_creation_tokens,
    model_tokens,
    cache_tokens,
    total_tokens,
    sdk_cost_usd,
    cost_usd,
    cost_breakdown,
    tool_calls,
    tool_response_bytes,
    final_response,
    elapsed_ms,
  };
}

// ---------------------------------------------------------------------------
// Phase 1: Setup - clone & index fastify
// ---------------------------------------------------------------------------

async function setup(): Promise<void> {
  if (!fs.existsSync(FASTIFY_DIR)) {
    console.log("Cloning fastify/fastify (shallow)...");
    fs.mkdirSync(REPOS_DIR, { recursive: true });
    execSync(`git clone --depth 1 ${FASTIFY_REPO} "${FASTIFY_DIR}"`, {
      stdio: "inherit",
    });
  } else {
    console.log("fastify/fastify already present.");
  }

  console.log("Indexing fastify codebase...");
  const dbDir = path.join(FASTIFY_DIR, ".lazyload");
  fs.mkdirSync(dbDir, { recursive: true });
  const dbPath = path.join(dbDir, "index.db");

  if (FORCE_REINDEX && fs.existsSync(dbPath)) {
    fs.rmSync(dbPath);
    console.log("  Cleared existing index database (--reindex).");
  }

  const indexer = new Indexer({
    rootDirectory: FASTIFY_DIR,
    databasePath: dbPath,
    include: ["**/*.ts", "**/*.js"],
    exclude: ["**/node_modules/**", "**/*.test.*", "**/*.spec.*"],
  });

  await indexer.initialize();
  try {
    const result = await indexer.indexDirectory();
    const stats = await indexer.getStats();

    console.log(`  Total files found:   ${result.totalFiles}`);
    console.log(`  Indexed (changed):   ${result.indexedFiles}`);
    console.log(`  Skipped (unchanged): ${result.skippedFiles}`);
    console.log(`  Errors:              ${result.errors.length}`);
    console.log(`  Symbols in DB:       ${stats.totalSymbols}`);
    for (const [lang, langStats] of Object.entries(stats.byLanguage)) {
      if (langStats.files > 0) {
        console.log(
          `    ${lang}: ${langStats.files} files, ${langStats.functions} functions, ${langStats.classes} classes`,
        );
      }
    }

    if (stats.totalSymbols === 0) {
      throw new Error(
        "ABORT: Index is empty after indexing. Check include patterns.",
      );
    }
  } finally {
    await indexer.close();
  }

  console.log("  Setup complete.\n");
}

// ---------------------------------------------------------------------------
// Phase 2: Run task WITHOUT LazyLoading
// ---------------------------------------------------------------------------

async function runWithout(
  task: TaskDef,
): Promise<RunMetrics> {
  console.log(`  [WITHOUT] Task ${task.id}: ${task.shortName}...`);
  const start = Date.now();
  const messages = await collectMessages(
    runQuery({
      prompt: task.prompt,
      options: {
        cwd: FASTIFY_DIR,
        model: MODEL,
        allowedTools: [...NATIVE_TOOLS],
        mcpServers: {},
        canUseTool: createWithoutToolGuard(),
        maxTurns: MAX_TURNS,
      },
    }),
  );

  return extractMetrics(messages, Date.now() - start);
}

// ---------------------------------------------------------------------------
// Phase 3: Run task FORCED (current WITH behavior)
// ---------------------------------------------------------------------------

async function runWith(
  task: TaskDef,
): Promise<RunMetrics> {
  console.log(`  [FORCED]  Task ${task.id}: ${task.shortName}...`);
  const start = Date.now();
  const mcpTools = MCP_TOOLS_BY_TASK[task.id] ?? [];
  const toolBudget = getEffectiveToolBudget(task);

  const messages = await collectMessages(
    runQuery({
      prompt: task.prompt,
      options: {
        cwd: FASTIFY_DIR,
        model: MODEL,
        allowedTools: ["Read", ...mcpTools],
        appendSystemPrompt: buildWithSystemPrompt(task, toolBudget),
        canUseTool: createWithToolGuard(task, mcpTools, toolBudget),
        mcpServers: buildLazyLoadingMcpServerConfig(),
        maxTurns: MAX_TURNS,
      },
    }),
  );

  return extractMetrics(messages, Date.now() - start);
}

// ---------------------------------------------------------------------------
// Phase 4: Run task NATURAL (native + MCP, no guidance)
// ---------------------------------------------------------------------------

async function runNatural(
  task: TaskDef,
): Promise<RunMetrics> {
  console.log(`  [NATURAL] Task ${task.id}: ${task.shortName}...`);
  const start = Date.now();
  const messages = await collectMessages(
    runQuery({
      prompt: task.prompt,
      options: {
        cwd: FASTIFY_DIR,
        model: MODEL,
        allowedTools: buildNaturalAllowedTools(),
        mcpServers: buildLazyLoadingMcpServerConfig(),
        maxTurns: MAX_TURNS,
      },
    }),
  );

  return extractMetrics(messages, Date.now() - start);
}

// ---------------------------------------------------------------------------
// Phase 4b: Run task INSTALLED (realistic install prompt + all MCP tools)
// ---------------------------------------------------------------------------

async function runInstalled(
  task: TaskDef,
): Promise<RunMetrics> {
  console.log(`  [INSTALLED] Task ${task.id}: ${task.shortName}...`);
  const start = Date.now();
  const messages = await collectMessages(
    runQuery({
      prompt: task.prompt,
      options: {
        cwd: FASTIFY_DIR,
        model: MODEL,
        allowedTools: buildNaturalAllowedTools(),
        appendSystemPrompt: generateClaudeMdContent(),
        mcpServers: buildLazyLoadingMcpServerConfig(),
        maxTurns: MAX_TURNS,
      },
    }),
  );

  return extractMetrics(messages, Date.now() - start);
}

function extractSessionId(messages: any[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const sessionId = messages[i]?.session_id;
    if (typeof sessionId === "string" && sessionId.length > 0) {
      return sessionId;
    }
  }
  return null;
}

function buildSessionTaskSequence(tasks: TaskDef[], queryCount: number): TaskDef[] {
  if (tasks.length === 0) {
    throw new Error("No tasks selected for session benchmark.");
  }

  const sequence: TaskDef[] = [];
  for (let i = 0; i < queryCount; i += 1) {
    sequence.push(tasks[i % tasks.length]!);
  }
  return sequence;
}

type SessionRunMode = "without" | "forced" | "natural" | "installed";

async function runSequentialSession(
  tasks: TaskDef[],
  mode: SessionRunMode,
): Promise<RunMetrics[]> {
  const runs: RunMetrics[] = [];
  let resumeSessionId: string | null = null;

  for (let i = 0; i < tasks.length; i += 1) {
    const task = tasks[i]!;
    const start = Date.now();

    const options: any = {
      cwd: FASTIFY_DIR,
      model: MODEL,
      maxTurns: MAX_TURNS,
    };

    if (mode === "forced") {
      const taskTools = MCP_TOOLS_BY_TASK[task.id] ?? [];
      const toolBudget = getEffectiveToolBudget(task);
      options.allowedTools = ["Read", ...taskTools];
      options.appendSystemPrompt = buildWithSystemPrompt(task, toolBudget);
      options.canUseTool = createWithToolGuard(task, taskTools, toolBudget);
      options.mcpServers = buildLazyLoadingMcpServerConfig();
    } else if (mode === "installed") {
      options.allowedTools = buildNaturalAllowedTools();
      options.appendSystemPrompt = generateClaudeMdContent();
      options.mcpServers = buildLazyLoadingMcpServerConfig();
    } else if (mode === "natural") {
      options.allowedTools = buildNaturalAllowedTools();
      options.mcpServers = buildLazyLoadingMcpServerConfig();
    } else {
      options.allowedTools = [...NATIVE_TOOLS];
      options.mcpServers = {};
      options.canUseTool = createWithoutToolGuard();
    }

    if (resumeSessionId) {
      options.resume = resumeSessionId;
      options.continue = true;
    }

    const prompt =
      mode === "without"
        ? task.prompt
        : `Session query ${i + 1}/${tasks.length}\nTask:\n${task.prompt}`;

    const messages = await collectMessages(runQuery({ prompt, options }));
    const metrics = extractMetrics(messages, Date.now() - start);
    runs.push(metrics);

    const nextSessionId = extractSessionId(messages);
    if (!nextSessionId) {
      throw new Error(
        `Missing session_id for ${mode.toUpperCase()} run at turn ${i + 1}.`,
      );
    }
    resumeSessionId = nextSessionId;

    if (i < tasks.length - 1) {
      await sleep(RATE_LIMIT_MS);
    }
  }

  return runs;
}

async function runSessionComparison(queryCount: number): Promise<SessionComparison> {
  const sessionTasks = buildSessionTaskSequence(tasksToRun, queryCount);
  console.log(
    `\n[SESSION] Query sequence: ${sessionTasks
      .map((task, idx) => `${idx + 1}:${task.shortName}`)
      .join(" | ")}`,
  );

  console.log("\n[SESSION] Running WITHOUT LazyLoading...");
  const withoutRuns = await runSequentialSession(sessionTasks, "without");
  await sleep(RATE_LIMIT_MS);

  const withMode: SessionRunMode = RUN_INSTALLED ? "installed" : "forced";
  console.log(`\n[SESSION] Running ${WITH_LABEL} LazyLoading...`);
  const withRuns = await runSequentialSession(sessionTasks, withMode);
  await sleep(RATE_LIMIT_MS);

  console.log("\n[SESSION] Running NATURAL LazyLoading...");
  const naturalRuns = await runSequentialSession(sessionTasks, "natural");

  const turns: SessionTurnResult[] = [];
  let cumulativeWithoutCost = 0;
  let cumulativeWithCost = 0;
  let cumulativeNaturalCost = 0;
  let breakevenQuery: number | null = null;
  let naturalBreakevenQuery: number | null = null;

  for (let i = 0; i < sessionTasks.length; i += 1) {
    const task = sessionTasks[i]!;
    const without = withoutRuns[i]!;
    const withLazy = withRuns[i]!;
    const natural = naturalRuns[i]!;

    cumulativeWithoutCost += without.cost_usd;
    cumulativeWithCost += withLazy.cost_usd;
    cumulativeNaturalCost += natural.cost_usd;

    const cumulativeSavings =
      cumulativeWithoutCost > 0
        ? Number(
            (
              (1 - cumulativeWithCost / cumulativeWithoutCost) *
              100
            ).toFixed(1),
          )
        : 0;
    const cumulativeNaturalSavings =
      cumulativeWithoutCost > 0
        ? Number(
            (
              (1 - cumulativeNaturalCost / cumulativeWithoutCost) *
              100
            ).toFixed(1),
          )
        : 0;
    const cumulativeNaturalVsForcedDelta =
      cumulativeWithCost > 0
        ? Number(
            (
              (1 - cumulativeNaturalCost / cumulativeWithCost) *
              100
            ).toFixed(1),
          )
        : 0;

    if (breakevenQuery === null && cumulativeWithCost <= cumulativeWithoutCost) {
      breakevenQuery = i + 1;
    }
    if (
      naturalBreakevenQuery === null &&
      cumulativeNaturalCost <= cumulativeWithoutCost
    ) {
      naturalBreakevenQuery = i + 1;
    }

    turns.push({
      turn: i + 1,
      task_id: task.id,
      task_name: task.shortName,
      without,
      with: withLazy,
      natural,
      cumulative_without_cost_usd: cumulativeWithoutCost,
      cumulative_with_cost_usd: cumulativeWithCost,
      cumulative_natural_cost_usd: cumulativeNaturalCost,
      cumulative_cost_savings_percent: cumulativeSavings,
      cumulative_natural_cost_savings_percent: cumulativeNaturalSavings,
      cumulative_natural_vs_forced_cost_delta_percent:
        cumulativeNaturalVsForcedDelta,
    });
  }

  const finalSavings =
    cumulativeWithoutCost > 0
      ? Number(
          ((1 - cumulativeWithCost / cumulativeWithoutCost) * 100).toFixed(1),
        )
      : 0;
  const finalNaturalSavings =
    cumulativeWithoutCost > 0
      ? Number(
          (
            (1 - cumulativeNaturalCost / cumulativeWithoutCost) *
            100
          ).toFixed(1),
        )
      : 0;
  const finalNaturalVsForcedDelta =
    cumulativeWithCost > 0
      ? Number(
          ((1 - cumulativeNaturalCost / cumulativeWithCost) * 100).toFixed(1),
        )
      : 0;

  return {
    query_count: sessionTasks.length,
    breakeven_query: breakevenQuery,
    natural_breakeven_query: naturalBreakevenQuery,
    final_cost_without_usd: cumulativeWithoutCost,
    final_cost_with_usd: cumulativeWithCost,
    final_cost_natural_usd: cumulativeNaturalCost,
    final_savings_percent: finalSavings,
    final_natural_savings_percent: finalNaturalSavings,
    final_natural_vs_forced_delta_percent: finalNaturalVsForcedDelta,
    turns,
  };
}

// ---------------------------------------------------------------------------
// Phase 5: Deterministic quality evaluation
// ---------------------------------------------------------------------------

function buildTaskResult(
  task: TaskDef,
  withoutRun: RunMetrics,
  withRun: RunMetrics,
  naturalRunInput?: RunMetrics,
  promptOverride?: string,
  modeOverride?: string,
): TaskResult {
  const naturalRun = naturalRunInput ?? withRun;
  const withoutEvaluation = evaluateValidationResponse(
    task.id,
    withoutRun.final_response,
  );
  const withEvaluation = evaluateValidationResponse(task.id, withRun.final_response);
  const naturalEvaluation = evaluateValidationResponse(
    task.id,
    naturalRun.final_response,
  );

  const savingsModel =
    withoutRun.model_tokens > 0
      ? Math.round((1 - withRun.model_tokens / withoutRun.model_tokens) * 100)
      : 0;
  const savingsTotal =
    withoutRun.total_tokens > 0
      ? Math.round((1 - withRun.total_tokens / withoutRun.total_tokens) * 100)
      : 0;
  const savingsCost =
    withoutRun.cost_usd > 0
      ? Math.round((1 - withRun.cost_usd / withoutRun.cost_usd) * 100)
      : 0;
  const speedup_x =
    withRun.elapsed_ms > 0
      ? Number((withoutRun.elapsed_ms / withRun.elapsed_ms).toFixed(2))
      : 0;

  const qualityDelta = Number(
    (
      avgQuality(withEvaluation.quality) - avgQuality(withoutEvaluation.quality)
    ).toFixed(1),
  );
  const naturalSavingsModel =
    withoutRun.model_tokens > 0
      ? Math.round((1 - naturalRun.model_tokens / withoutRun.model_tokens) * 100)
      : 0;
  const naturalSavingsTotal =
    withoutRun.total_tokens > 0
      ? Math.round((1 - naturalRun.total_tokens / withoutRun.total_tokens) * 100)
      : 0;
  const naturalSavingsCost =
    withoutRun.cost_usd > 0
      ? Math.round((1 - naturalRun.cost_usd / withoutRun.cost_usd) * 100)
      : 0;
  const naturalSpeedup =
    naturalRun.elapsed_ms > 0
      ? Number((withoutRun.elapsed_ms / naturalRun.elapsed_ms).toFixed(2))
      : 0;
  const naturalQualityDelta = Number(
    (
      avgQuality(naturalEvaluation.quality) - avgQuality(withoutEvaluation.quality)
    ).toFixed(1),
  );
  const naturalVsForcedModelDelta =
    withRun.model_tokens > 0
      ? Math.round((1 - naturalRun.model_tokens / withRun.model_tokens) * 100)
      : 0;
  const naturalVsForcedTotalDelta =
    withRun.total_tokens > 0
      ? Math.round((1 - naturalRun.total_tokens / withRun.total_tokens) * 100)
      : 0;
  const naturalVsForcedCostDelta =
    withRun.cost_usd > 0
      ? Math.round((1 - naturalRun.cost_usd / withRun.cost_usd) * 100)
      : 0;
  const naturalVsForcedQualityDelta = Number(
    (
      avgQuality(naturalEvaluation.quality) - avgQuality(withEvaluation.quality)
    ).toFixed(1),
  );

  return {
    id: task.id,
    prompt: promptOverride ?? task.prompt,
    mode: modeOverride ?? task.mode,
    without: {
      ...withoutRun,
      quality: withoutEvaluation.quality,
      quality_raw: withoutEvaluation.raw,
    },
    with: {
      ...withRun,
      quality: withEvaluation.quality,
      quality_raw: withEvaluation.raw,
    },
    natural: {
      ...naturalRun,
      quality: naturalEvaluation.quality,
      quality_raw: naturalEvaluation.raw,
    },
    savings_percent_total: savingsTotal,
    savings_percent_cost: savingsCost,
    savings_percent: savingsModel,
    speedup_x,
    quality_delta: qualityDelta,
    natural_savings_percent_total: naturalSavingsTotal,
    natural_savings_percent_cost: naturalSavingsCost,
    natural_savings_percent: naturalSavingsModel,
    natural_speedup_x: naturalSpeedup,
    natural_quality_delta: naturalQualityDelta,
    natural_vs_forced_model_delta_percent: naturalVsForcedModelDelta,
    natural_vs_forced_total_delta_percent: naturalVsForcedTotalDelta,
    natural_vs_forced_cost_delta_percent: naturalVsForcedCostDelta,
    natural_vs_forced_quality_delta: naturalVsForcedQualityDelta,
  };
}

// ---------------------------------------------------------------------------
// Phase 6: Output
// ---------------------------------------------------------------------------

function fmtTokens(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return n.toLocaleString();
}

function fmtSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function printConsoleTable(results: TaskResult[]): void {
  const output = buildOutput(results);
  const n = results.length;
  if (n === 0) {
    console.log("\nNo task results to display.");
    return;
  }

  if (!RUN_WITHOUT || !RUN_WITH || !RUN_NATURAL) {
    console.log(
      `[NOTE] Subset mode run (${BENCHMARK_MODES.join(", ")}). Columns for unselected modes mirror the comparison baseline (${COMPARISON_BASELINE_MODE.toUpperCase()}) for schema compatibility.`,
    );
  }

  const avgWithout = Math.round(
    results.reduce((s, t) => s + t.without.model_tokens, 0) / n,
  );
  const avgWith = Math.round(
    results.reduce((s, t) => s + t.with.model_tokens, 0) / n,
  );
  const avgNatural = Math.round(
    results.reduce((s, t) => s + t.natural.model_tokens, 0) / n,
  );
  const avgWithoutTotal = Math.round(
    results.reduce((s, t) => s + t.without.total_tokens, 0) / n,
  );
  const avgWithTotal = Math.round(
    results.reduce((s, t) => s + t.with.total_tokens, 0) / n,
  );
  const avgNaturalTotal = Math.round(
    results.reduce((s, t) => s + t.natural.total_tokens, 0) / n,
  );
  const avgSavings = Math.round(
    results.reduce((s, t) => s + t.savings_percent, 0) / n,
  );
  const avgSavingsTotal = Math.round(
    results.reduce((s, t) => s + t.savings_percent_total, 0) / n,
  );
  const avgSavingsCost = Math.round(
    results.reduce((s, t) => s + t.savings_percent_cost, 0) / n,
  );
  const avgNaturalSavings = Math.round(
    results.reduce((s, t) => s + t.natural_savings_percent, 0) / n,
  );
  const avgNaturalSavingsTotal = Math.round(
    results.reduce((s, t) => s + t.natural_savings_percent_total, 0) / n,
  );
  const avgNaturalSavingsCost = Math.round(
    results.reduce((s, t) => s + t.natural_savings_percent_cost, 0) / n,
  );
  const avgQDelta = (
    results.reduce((s, t) => s + t.quality_delta, 0) / n
  ).toFixed(1);
  const avgNaturalQDelta = (
    results.reduce((s, t) => s + t.natural_quality_delta, 0) / n
  ).toFixed(1);
  const avgNaturalVsForcedQDelta = (
    results.reduce((s, t) => s + t.natural_vs_forced_quality_delta, 0) / n
  ).toFixed(1);
  const totalCostWithout = results.reduce((s, t) => s + t.without.cost_usd, 0);
  const totalCostWith = results.reduce((s, t) => s + t.with.cost_usd, 0);
  const totalCostNatural = results.reduce((s, t) => s + t.natural.cost_usd, 0);
  const totalSdkCostWithout = results.reduce(
    (s, t) => s + t.without.sdk_cost_usd,
    0,
  );
  const totalSdkCostWith = results.reduce((s, t) => s + t.with.sdk_cost_usd, 0);
  const totalSdkCostNatural = results.reduce(
    (s, t) => s + t.natural.sdk_cost_usd,
    0,
  );

  console.log("\n=== POST-IMPLEMENTATION VALIDATION BENCHMARK ===");
  console.log(
    `Task | WITHOUT model(time) | ${WITH_LABEL} model(time) | NATURAL model(time) | Savings(model) ${WITH_LABEL}/NATURAL | Gap NATURAL-${WITH_LABEL} (model) | Quality Δ ${WITH_LABEL}/NATURAL`,
  );
  console.log(
    "-----|---------------------|--------------------|--------------------|-------------------------------|---------------------------|--------------------------",
  );

  for (const t of results) {
    const task = TASKS.find((td) => td.id === t.id)!;
    const qForced = t.quality_delta >= 0 ? `+${t.quality_delta}` : `${t.quality_delta}`;
    const qNatural =
      t.natural_quality_delta >= 0
        ? `+${t.natural_quality_delta}`
        : `${t.natural_quality_delta}`;

    console.log(
      `${t.id}. ${task.shortName} | ` +
        `${fmtTokens(t.without.model_tokens)} (${fmtSeconds(t.without.elapsed_ms)}) | ` +
        `${fmtTokens(t.with.model_tokens)} (${fmtSeconds(t.with.elapsed_ms)}) | ` +
        `${fmtTokens(t.natural.model_tokens)} (${fmtSeconds(t.natural.elapsed_ms)}) | ` +
        `${t.savings_percent}%/${t.natural_savings_percent}% | ` +
        `${t.natural_vs_forced_model_delta_percent}% | ` +
        `${qForced}/${qNatural}`,
    );
    console.log(
      `    Costs calc ${WITH_LABEL}/NATURAL/WITHOUT: $${t.with.cost_usd.toFixed(2)}/$${t.natural.cost_usd.toFixed(2)}/$${t.without.cost_usd.toFixed(2)} | ` +
        `Total tok savings ${WITH_LABEL}/NATURAL: ${t.savings_percent_total}%/${t.natural_savings_percent_total}% | ` +
        `Speedup ${WITH_LABEL}/NATURAL: ${t.speedup_x.toFixed(2)}x/${t.natural_speedup_x.toFixed(2)}x`,
    );

    if (t.run_summary && t.run_summary.run_count > 1) {
      const summary = t.run_summary;
      console.log(
        `    Runs=${summary.run_count}, rep=${summary.representative_run} | ` +
          `Savings(model) ${WITH_LABEL} median/min/max: ${summary.savings_percent.median.toFixed(1)}%/${summary.savings_percent.min.toFixed(1)}%/${summary.savings_percent.max.toFixed(1)}% | ` +
          `Savings(model) NATURAL median/min/max: ${summary.natural_savings_percent.median.toFixed(1)}%/${summary.natural_savings_percent.min.toFixed(1)}%/${summary.natural_savings_percent.max.toFixed(1)}% | ` +
          `NATURAL-${WITH_LABEL} model gap median/min/max: ${summary.natural_vs_forced_model_delta_percent.median.toFixed(1)}%/${summary.natural_vs_forced_model_delta_percent.min.toFixed(1)}%/${summary.natural_vs_forced_model_delta_percent.max.toFixed(1)}%`,
      );
    }
  }

  const qDStr = Number(avgQDelta) >= 0 ? `+${avgQDelta}` : avgQDelta;
  const qNaturalStr =
    Number(avgNaturalQDelta) >= 0 ? `+${avgNaturalQDelta}` : avgNaturalQDelta;
  const qNaturalVsForcedStr =
    Number(avgNaturalVsForcedQDelta) >= 0
      ? `+${avgNaturalVsForcedQDelta}`
      : avgNaturalVsForcedQDelta;

  console.log(
    `AVERAGE | ` +
      `${fmtTokens(avgWithout)} (${fmtSeconds(output.summary.avg_elapsed_ms_without)}) | ` +
      `${fmtTokens(avgWith)} (${fmtSeconds(output.summary.avg_elapsed_ms_with)}) | ` +
      `${fmtTokens(avgNatural)} (${fmtSeconds(output.summary.avg_elapsed_ms_natural)}) | ` +
      `${avgSavings}%/${avgNaturalSavings}% | ` +
      `${output.summary.avg_natural_vs_forced_model_delta_percent}% | ` +
      `${qDStr}/${qNaturalStr}`,
  );
  console.log(
    `\nTotals incl cache avg ${WITH_LABEL}/NATURAL: ${fmtTokens(avgWithoutTotal)} → ${fmtTokens(avgWithTotal)} (${avgSavingsTotal}% savings) / ` +
      `${fmtTokens(avgNaturalTotal)} (${avgNaturalSavingsTotal}% savings)`,
  );
  console.log(
    `Cost savings avg ${WITH_LABEL}/NATURAL: ${avgSavingsCost}%/${avgNaturalSavingsCost}% | ` +
      `NATURAL-${WITH_LABEL} cost delta: ${output.summary.avg_natural_vs_forced_cost_delta_percent}%`,
  );
  console.log(
    `Avg elapsed speedup ${WITH_LABEL}/NATURAL: ${output.summary.avg_speedup_x.toFixed(2)}x/${output.summary.avg_natural_speedup_x.toFixed(2)}x | ` +
      `NATURAL-${WITH_LABEL} quality delta: ${qNaturalVsForcedStr}`,
  );
  console.log(
    `SDK reported cost totals ${WITH_LABEL}/NATURAL/WITHOUT: $${totalSdkCostWith.toFixed(2)}/$${totalSdkCostNatural.toFixed(2)}/$${totalSdkCostWithout.toFixed(2)}`,
  );
  console.log(
    `Calculated cost totals ${WITH_LABEL}/NATURAL/WITHOUT: $${totalCostWith.toFixed(2)}/$${totalCostNatural.toFixed(2)}/$${totalCostWithout.toFixed(2)}`,
  );

  const forcedToolBytes: Record<string, number> = {};
  const naturalToolBytes: Record<string, number> = {};
  for (const task of results) {
    for (const [tool, bytes] of Object.entries(task.with.tool_response_bytes)) {
      forcedToolBytes[tool] = (forcedToolBytes[tool] ?? 0) + bytes;
    }
    for (const [tool, bytes] of Object.entries(task.natural.tool_response_bytes)) {
      naturalToolBytes[tool] = (naturalToolBytes[tool] ?? 0) + bytes;
    }
  }
  if (Object.keys(forcedToolBytes).length > 0) {
    console.log(
      `${WITH_LABEL} per-tool response bytes: ${formatToolResponseBytes(forcedToolBytes)}`,
    );
  }
  if (Object.keys(naturalToolBytes).length > 0) {
    console.log(
      `NATURAL per-tool response bytes: ${formatToolResponseBytes(naturalToolBytes)}`,
    );
  }
}

interface BuildOutputOptions {
  benchmark?: string;
  target_codebase?: string;
  model?: string;
  timestamp?: string;
  with_mode?: "forced" | "installed";
}

function buildOutput(
  results: TaskResult[],
  sessionComparison?: SessionComparison,
  options: BuildOutputOptions = {},
): BenchmarkOutput {
  const n = results.length;
  const divisor = n === 0 ? 1 : n;
  return {
    benchmark: options.benchmark ?? "validation",
    timestamp: options.timestamp ?? new Date().toISOString(),
    target_codebase: options.target_codebase ?? "fastify/fastify",
    model: options.model ?? MODEL,
    with_mode: options.with_mode ?? (RUN_INSTALLED ? "installed" : "forced"),
    evaluator: {
      type: VALIDATION_EVALUATOR.type,
      version: VALIDATION_EVALUATOR.version,
    },
    tasks: results,
    session_comparison: sessionComparison,
    summary: {
      avg_tokens_without: Math.round(
        results.reduce((s, t) => s + t.without.model_tokens, 0) / divisor,
      ),
      avg_tokens_with: Math.round(
        results.reduce((s, t) => s + t.with.model_tokens, 0) / divisor,
      ),
      avg_tokens_natural: Math.round(
        results.reduce((s, t) => s + t.natural.model_tokens, 0) / divisor,
      ),
      avg_total_tokens_without: Math.round(
        results.reduce((s, t) => s + t.without.total_tokens, 0) / divisor,
      ),
      avg_total_tokens_with: Math.round(
        results.reduce((s, t) => s + t.with.total_tokens, 0) / divisor,
      ),
      avg_total_tokens_natural: Math.round(
        results.reduce((s, t) => s + t.natural.total_tokens, 0) / divisor,
      ),
      avg_savings_percent: Math.round(
        results.reduce((s, t) => s + t.savings_percent, 0) / divisor,
      ),
      avg_savings_total_percent: Math.round(
        results.reduce((s, t) => s + t.savings_percent_total, 0) / divisor,
      ),
      avg_savings_cost_percent: Math.round(
        results.reduce((s, t) => s + t.savings_percent_cost, 0) / divisor,
      ),
      avg_natural_savings_percent: Math.round(
        results.reduce((s, t) => s + t.natural_savings_percent, 0) / divisor,
      ),
      avg_natural_savings_total_percent: Math.round(
        results.reduce((s, t) => s + t.natural_savings_percent_total, 0) / divisor,
      ),
      avg_natural_savings_cost_percent: Math.round(
        results.reduce((s, t) => s + t.natural_savings_percent_cost, 0) / divisor,
      ),
      avg_cost_without_usd: Number(
        (
          results.reduce((s, t) => s + t.without.cost_usd, 0) / divisor
        ).toFixed(6),
      ),
      avg_cost_with_usd: Number(
        (
          results.reduce((s, t) => s + t.with.cost_usd, 0) / divisor
        ).toFixed(6),
      ),
      avg_cost_natural_usd: Number(
        (
          results.reduce((s, t) => s + t.natural.cost_usd, 0) / divisor
        ).toFixed(6),
      ),
      avg_sdk_cost_without_usd: Number(
        (
          results.reduce((s, t) => s + t.without.sdk_cost_usd, 0) / divisor
        ).toFixed(6),
      ),
      avg_sdk_cost_with_usd: Number(
        (
          results.reduce((s, t) => s + t.with.sdk_cost_usd, 0) / divisor
        ).toFixed(6),
      ),
      avg_sdk_cost_natural_usd: Number(
        (
          results.reduce((s, t) => s + t.natural.sdk_cost_usd, 0) / divisor
        ).toFixed(6),
      ),
      avg_quality_without: Number(
        (
          results.reduce(
            (s, t) => s + avgQuality(t.without.quality),
            0,
          ) / divisor
        ).toFixed(1),
      ),
      avg_quality_with: Number(
        (
          results.reduce(
            (s, t) => s + avgQuality(t.with.quality),
            0,
          ) / divisor
        ).toFixed(1),
      ),
      avg_quality_natural: Number(
        (
          results.reduce(
            (s, t) => s + avgQuality(t.natural.quality),
            0,
          ) / divisor
        ).toFixed(1),
      ),
      avg_elapsed_ms_without: Math.round(
        results.reduce((s, t) => s + t.without.elapsed_ms, 0) / divisor,
      ),
      avg_elapsed_ms_with: Math.round(
        results.reduce((s, t) => s + t.with.elapsed_ms, 0) / divisor,
      ),
      avg_elapsed_ms_natural: Math.round(
        results.reduce((s, t) => s + t.natural.elapsed_ms, 0) / divisor,
      ),
      avg_speedup_x: Number(
        (
          results.reduce((s, t) => s + t.speedup_x, 0) / divisor
        ).toFixed(2),
      ),
      avg_natural_speedup_x: Number(
        (
          results.reduce((s, t) => s + t.natural_speedup_x, 0) / divisor
        ).toFixed(2),
      ),
      avg_natural_vs_forced_model_delta_percent: Number(
        (
          results.reduce(
            (s, t) => s + t.natural_vs_forced_model_delta_percent,
            0,
          ) / divisor
        ).toFixed(1),
      ),
      avg_natural_vs_forced_total_delta_percent: Number(
        (
          results.reduce(
            (s, t) => s + t.natural_vs_forced_total_delta_percent,
            0,
          ) / divisor
        ).toFixed(1),
      ),
      avg_natural_vs_forced_cost_delta_percent: Number(
        (
          results.reduce(
            (s, t) => s + t.natural_vs_forced_cost_delta_percent,
            0,
          ) / divisor
        ).toFixed(1),
      ),
      avg_natural_vs_forced_quality_delta: Number(
        (
          results.reduce(
            (s, t) => s + t.natural_vs_forced_quality_delta,
            0,
          ) / divisor
        ).toFixed(1),
      ),
    },
  };
}

function writeJsonOutput(
  results: TaskResult[],
  sessionComparison?: SessionComparison,
  explicitOutputPath?: string,
  options: BuildOutputOptions = {},
): string {
  const output = buildOutput(results, sessionComparison, options);
  const filePath =
    explicitOutputPath ??
    path.join(
      RESULTS_DIR,
      `validation-${new Date().toISOString().split("T")[0]}.json`,
    );
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(output, null, 2) + "\n");
  console.log(`\nResults written to ${filePath}`);
  return filePath;
}

function printMarkdownTable(results: TaskResult[]): void {
  const output = buildOutput(results);

  console.log("\nMarkdown table (copy-paste ready):\n");
  if (!RUN_WITHOUT || !RUN_WITH || !RUN_NATURAL) {
    console.log(
      `> NOTE: Subset mode run (${BENCHMARK_MODES.join(", ")}). Unselected mode columns mirror baseline ${COMPARISON_BASELINE_MODE.toUpperCase()}.`,
    );
  }
  console.log(
    `| # | Mode | Task | WITHOUT (model tok) | ${WITH_LABEL} (model tok) | NATURAL (model tok) | WITHOUT (s) | ${WITH_LABEL} (s) | NATURAL (s) | Savings ${WITH_LABEL}/NATURAL (model) | NATURAL-${WITH_LABEL} (model) | Quality Δ ${WITH_LABEL}/NATURAL |`,
  );
  console.log(
    "|---|------|------|---------------------|--------------------|---------------------|-------------|------------|-------------|-------------------------------|-------------------------|--------------------------|",
  );

  for (const t of results) {
    const task = TASKS.find((td) => td.id === t.id)!;
    const qForced =
      t.quality_delta >= 0 ? `+${t.quality_delta}` : `${t.quality_delta}`;
    const qNatural =
      t.natural_quality_delta >= 0
        ? `+${t.natural_quality_delta}`
        : `${t.natural_quality_delta}`;
    console.log(
      `| ${t.id} | ${task.mode} | ${task.shortName} ` +
        `| ${t.without.model_tokens.toLocaleString()} ` +
        `| ${t.with.model_tokens.toLocaleString()} ` +
        `| ${t.natural.model_tokens.toLocaleString()} ` +
        `| ${(t.without.elapsed_ms / 1000).toFixed(1)} ` +
        `| ${(t.with.elapsed_ms / 1000).toFixed(1)} ` +
        `| ${(t.natural.elapsed_ms / 1000).toFixed(1)} ` +
        `| **${t.savings_percent}%/${t.natural_savings_percent}%** ` +
        `| ${t.natural_vs_forced_model_delta_percent}% ` +
        `| ${qForced}/${qNatural} |`,
    );
  }

  const forcedQDelta = output.summary.avg_quality_with - output.summary.avg_quality_without;
  const naturalQDelta = output.summary.avg_quality_natural - output.summary.avg_quality_without;
  const forcedQDeltaStr =
    forcedQDelta >= 0 ? `+${forcedQDelta.toFixed(1)}` : forcedQDelta.toFixed(1);
  const naturalQDeltaStr =
    naturalQDelta >= 0 ? `+${naturalQDelta.toFixed(1)}` : naturalQDelta.toFixed(1);
  console.log(
    `| | | **AVERAGE** ` +
      `| **${output.summary.avg_tokens_without.toLocaleString()}** ` +
      `| **${output.summary.avg_tokens_with.toLocaleString()}** ` +
      `| **${output.summary.avg_tokens_natural.toLocaleString()}** ` +
      `| **${(output.summary.avg_elapsed_ms_without / 1000).toFixed(1)}** ` +
      `| **${(output.summary.avg_elapsed_ms_with / 1000).toFixed(1)}** ` +
      `| **${(output.summary.avg_elapsed_ms_natural / 1000).toFixed(1)}** ` +
      `| **${output.summary.avg_savings_percent}%/${output.summary.avg_natural_savings_percent}%** ` +
      `| **${output.summary.avg_natural_vs_forced_model_delta_percent}%** ` +
      `| **${forcedQDeltaStr}/${naturalQDeltaStr}** |`,
  );
  console.log(
    `\nCost savings avg ${WITH_LABEL}/NATURAL: **${output.summary.avg_savings_cost_percent}%/${output.summary.avg_natural_savings_cost_percent}%** ` +
      `| Total token savings incl cache avg ${WITH_LABEL}/NATURAL: **${output.summary.avg_savings_total_percent}%/${output.summary.avg_natural_savings_total_percent}%** ` +
      `| Avg speedup ${WITH_LABEL}/NATURAL: **${output.summary.avg_speedup_x.toFixed(2)}x/${output.summary.avg_natural_speedup_x.toFixed(2)}x**`,
  );
}

function printSessionComparisonTable(comparison: SessionComparison): void {
  const pad = (value: string, width: number) =>
    value + " ".repeat(Math.max(0, width - value.length));

  const columns = [7, 13, 13, 13, 13, 13, 13, 13];
  const header =
    `${pad("Query", columns[0]!)} ` +
    `${pad("Task", columns[1]!)} ` +
    `${pad("W/O Cost", columns[2]!)} ` +
    `${pad(WITH_LABEL, columns[3]!)} ` +
    `${pad("NATURAL", columns[4]!)} ` +
    `${pad("Cum W/O", columns[5]!)} ` +
    `${pad(`Cum ${WITH_LABEL}`, columns[6]!)} ` +
    `${pad("Cum NATURAL", columns[7]!)} ` +
    `Savings ${WITH_LABEL[0]}/N`;

  console.log("\n=== MULTI-TURN SESSION COST COMPARISON ===");
  console.log(header);
  console.log("-".repeat(header.length + 2));

  for (const turn of comparison.turns) {
    const line =
      `${pad(String(turn.turn), columns[0]!)} ` +
      `${pad(turn.task_name, columns[1]!)} ` +
      `${pad(`$${turn.without.cost_usd.toFixed(4)}`, columns[2]!)} ` +
      `${pad(`$${turn.with.cost_usd.toFixed(4)}`, columns[3]!)} ` +
      `${pad(`$${(turn.natural?.cost_usd ?? 0).toFixed(4)}`, columns[4]!)} ` +
      `${pad(`$${turn.cumulative_without_cost_usd.toFixed(4)}`, columns[5]!)} ` +
      `${pad(`$${turn.cumulative_with_cost_usd.toFixed(4)}`, columns[6]!)} ` +
      `${pad(`$${(turn.cumulative_natural_cost_usd ?? 0).toFixed(4)}`, columns[7]!)} ` +
      `${turn.cumulative_cost_savings_percent.toFixed(1)}%/${(turn.cumulative_natural_cost_savings_percent ?? 0).toFixed(1)}%`;
    console.log(line);
  }

  const forcedBreakevenText =
    comparison.breakeven_query === null
      ? `${WITH_LABEL}: no breakeven`
      : `${WITH_LABEL} breakeven at query ${comparison.breakeven_query}`;
  const naturalBreakevenText =
    comparison.natural_breakeven_query == null
      ? "NATURAL: no breakeven"
      : `NATURAL breakeven at query ${comparison.natural_breakeven_query}`;
  const finalNaturalCost = comparison.final_cost_natural_usd ?? 0;
  const finalNaturalSavings = comparison.final_natural_savings_percent ?? 0;
  const finalNaturalVsForced = comparison.final_natural_vs_forced_delta_percent ?? 0;
  console.log(
    `\nSession total cost: ` +
      `$${comparison.final_cost_without_usd.toFixed(4)} (WITHOUT) vs ` +
      `$${comparison.final_cost_with_usd.toFixed(4)} (${WITH_LABEL}) vs ` +
      `$${finalNaturalCost.toFixed(4)} (NATURAL)`,
  );
  console.log(
    `Final session savings ${WITH_LABEL}/NATURAL: ${comparison.final_savings_percent.toFixed(1)}%/${finalNaturalSavings.toFixed(1)}% | ` +
      `NATURAL-${WITH_LABEL} delta: ${finalNaturalVsForced.toFixed(1)}% | ${forcedBreakevenText} | ${naturalBreakevenText}`,
  );
}

interface HistoricalTaskResult {
  id: number;
  prompt?: string;
  mode?: string;
  without: Partial<RunMetrics>;
  with: Partial<RunMetrics>;
  natural?: Partial<RunMetrics>;
  meta?: Partial<RunMetrics>;
}

interface HistoricalBenchmarkOutput {
  benchmark?: string;
  timestamp?: string;
  target_codebase?: string;
  model?: string;
  with_mode?: "forced" | "installed";
  tasks?: HistoricalTaskResult[];
  session_comparison?: SessionComparison;
}

function toNumber(value: unknown, fallback: number = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeRunMetrics(raw: Partial<RunMetrics>): RunMetrics {
  const input_tokens = toNumber(raw.input_tokens);
  const output_tokens = toNumber(raw.output_tokens);
  const cache_read_tokens = toNumber(raw.cache_read_tokens);
  const cache_creation_tokens = toNumber(raw.cache_creation_tokens);
  const model_tokens = input_tokens + output_tokens;
  const cache_tokens = cache_read_tokens + cache_creation_tokens;
  const total_tokens =
    input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens;
  const cost_breakdown = calculateCostFromUsage(
    {
      input_tokens,
      output_tokens,
      cache_read_tokens,
      cache_creation_tokens,
    },
    PRICING,
  );

  const tool_calls = Array.isArray(raw.tool_calls)
    ? raw.tool_calls.filter((tool): tool is string => typeof tool === "string")
    : [];
  const tool_response_bytes =
    raw.tool_response_bytes && typeof raw.tool_response_bytes === "object"
      ? Object.fromEntries(
          Object.entries(raw.tool_response_bytes).map(([key, value]) => [
            key,
            toNumber(value),
          ]),
        )
      : {};

  return {
    input_tokens,
    output_tokens,
    cache_read_tokens,
    cache_creation_tokens,
    model_tokens,
    cache_tokens,
    total_tokens,
    sdk_cost_usd: toNumber(raw.sdk_cost_usd),
    cost_usd:
      typeof raw.cost_usd === "number" && Number.isFinite(raw.cost_usd)
        ? raw.cost_usd
        : cost_breakdown.total_cost_usd,
    cost_breakdown,
    tool_calls,
    tool_response_bytes,
    final_response: typeof raw.final_response === "string" ? raw.final_response : "",
    elapsed_ms: toNumber(raw.elapsed_ms),
  };
}

function toRescoredOutputPath(inputPath: string): string {
  const parsed = path.parse(inputPath);
  const extension = parsed.ext || ".json";
  return path.join(parsed.dir, `${parsed.name}-rescored${extension}`);
}

function rescoreValidationFile(
  inputPath: string,
  explicitOutputPath?: string,
): string {
  const rawInput = fs.readFileSync(inputPath, "utf-8");
  const parsed = JSON.parse(rawInput) as HistoricalBenchmarkOutput;
  const storedTasks = parsed.tasks ?? [];
  const rescoredResults: TaskResult[] = storedTasks.map((storedTask) => {
    const taskDef = getTaskById(storedTask.id);
    return buildTaskResult(
      taskDef,
      normalizeRunMetrics(storedTask.without),
      normalizeRunMetrics(storedTask.with),
      storedTask.natural ? normalizeRunMetrics(storedTask.natural) : undefined,
      storedTask.prompt,
      storedTask.mode,
    );
  });

  if (rescoredResults.length > 0) {
    printConsoleTable(rescoredResults);
    printMarkdownTable(rescoredResults);
  } else {
    console.log("No task results found in input JSON.");
  }

  const outputPath = explicitOutputPath ?? toRescoredOutputPath(inputPath);
  return writeJsonOutput(
    rescoredResults,
    parsed.session_comparison,
    outputPath,
    {
      benchmark: parsed.benchmark ?? "validation",
      target_codebase: parsed.target_codebase ?? "fastify/fastify",
      model: parsed.model ?? MODEL,
      with_mode: parsed.with_mode ?? "forced",
    },
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (rescoreIdx !== -1 && !RESCORE_INPUT) {
    throw new Error("Missing path after --rescore.");
  }

  if (outputIdx !== -1 && !RESCORE_OUTPUT_PATH) {
    throw new Error("Missing path after --output.");
  }

  if (RESCORE_INPUT) {
    if (!fs.existsSync(RESCORE_INPUT)) {
      throw new Error(`Rescore input file not found: ${RESCORE_INPUT}`);
    }
    const outputPath = rescoreValidationFile(RESCORE_INPUT, RESCORE_OUTPUT_PATH ?? undefined);
    console.log(`Deterministic rescoring complete (${VALIDATION_EVALUATOR.version}).`);
    console.log(`Rescored file: ${outputPath}`);
    return;
  }

  const effectiveTargetedBudget = Math.min(
    MAX_TOOL_CALLS,
    DEFAULT_TOOL_BUDGET_BY_MODE.targeted,
  );
  const effectiveExplorationBudget = Math.min(
    MAX_TOOL_CALLS,
    DEFAULT_TOOL_BUDGET_BY_MODE.exploration,
  );
  const effectiveTask4Budget = Math.min(
    MAX_TOOL_CALLS,
    TOOL_BUDGET_OVERRIDES[4] ?? DEFAULT_TOOL_BUDGET_BY_MODE.exploration,
  );

  console.log("=== POST-IMPLEMENTATION VALIDATION BENCHMARK ===");
  console.log(`Target: fastify/fastify | Model: ${MODEL}`);
  console.log(
    `Tasks:  ${tasksToRun.map((t) => `${t.id}(${t.shortName})`).join(", ")}`,
  );
  console.log(
    `Pricing: input $${PRICING.input_usd_per_mtok.toFixed(2)} / cache write $${PRICING.cache_write_usd_per_mtok.toFixed(2)} / cache read $${PRICING.cache_read_usd_per_mtok.toFixed(2)} / output $${PRICING.output_usd_per_mtok.toFixed(2)} per MTok`,
  );
  if (RUN_INSTALLED) {
    console.log(
      `INSTALLED mode settings: native benchmark tools + all LazyLoading MCP tools, append generated CLAUDE.md system prompt, no forced tool budgets`,
    );
  } else {
    console.log(
      `FORCED mode settings: max-tool-calls=${MAX_TOOL_CALLS} (effective caps: targeted=${effectiveTargetedBudget}, exploration=${effectiveExplorationBudget}, task4=${effectiveTask4Budget}), format=${TOOL_RESPONSE_FORMAT}`,
    );
  }
  console.log(
    "NATURAL mode settings: native tools + all LazyLoading MCP tools, no MCP-first system prompt, no tool guard",
  );
  console.log(`Execution modes: ${BENCHMARK_MODES.join(", ")} (WITH slot: ${WITH_LABEL})`);
  if (!RUN_WITHOUT) {
    console.log(
      `Comparison baseline: ${COMPARISON_BASELINE_MODE.toUpperCase()} (WITHOUT mode not selected)`,
    );
  }
  console.log(
    `Evaluator: ${VALIDATION_EVALUATOR.type}@${VALIDATION_EVALUATOR.version}`,
  );
  console.log(`Runs per task: ${RUN_COUNT}`);
  console.log(`Dry run: ${DRY_RUN}\n`);

  // Phase 1: Setup
  await setup();

  if (DRY_RUN) {
    console.log("[DRY RUN] Setup complete. Tasks that would run:\n");
    for (const task of tasksToRun) {
      console.log(`  ${task.id}. [${task.mode}] ${task.shortName}`);
      console.log(`     ${task.prompt}\n`);
    }
    if (SESSION_ONLY) {
      const sequence = buildSessionTaskSequence(tasksToRun, SESSION_QUERY_COUNT);
      console.log(
        `  Session-only sequence (${SESSION_QUERY_COUNT} queries): ${sequence
          .map((task, idx) => `${idx + 1}:${task.shortName}`)
          .join(" | ")}`,
      );
      if (RUN_COUNT > 1) {
        console.log("  Note: --runs is ignored in --session-only mode.");
      }
    } else if (RUN_COUNT > 1) {
      console.log(`  Each selected task will run ${RUN_COUNT} times.`);
    }
    return;
  }

  if (SESSION_ONLY) {
    const sessionSupportsModes = RUN_WITHOUT && RUN_WITH && RUN_NATURAL;
    if (!sessionSupportsModes) {
      throw new Error(
        "--session-only currently requires --modes without,natural plus one of forced or installed.",
      );
    }
    if (RUN_COUNT > 1) {
      console.warn("[WARN] --runs is ignored in --session-only mode.");
    }
    const sessionComparison = await runSessionComparison(SESSION_QUERY_COUNT);
    printSessionComparisonTable(sessionComparison);
    writeJsonOutput([], sessionComparison);
    return;
  }

  // Phases 2-4: Run tasks and evaluate
  const results: TaskResult[] = [];

  for (const task of tasksToRun) {
    console.log(`\nTask ${task.id}: ${task.shortName} (${task.mode})`);
    const taskRuns: TaskResult[] = [];

    for (let run = 1; run <= RUN_COUNT; run += 1) {
      // Each run starts a new query() invocation with no resume token, preventing session bleed.
      const runPrefix = RUN_COUNT > 1 ? `  [RUN ${run}/${RUN_COUNT}] ` : "  ";
      let withoutRun: RunMetrics | null = null;
      let withRun: RunMetrics | null = null;
      let naturalRun: RunMetrics | null = null;

      if (RUN_WITHOUT) {
        withoutRun = await runWithout(task);
        await sleep(RATE_LIMIT_MS);
      }

      if (RUN_WITH) {
        withRun = RUN_INSTALLED
          ? await runInstalled(task)
          : await runWith(task);
        await sleep(RATE_LIMIT_MS);
      }

      if (RUN_NATURAL) {
        naturalRun = await runNatural(task);
        await sleep(RATE_LIMIT_MS);
      }

      const baselineRun =
        COMPARISON_BASELINE_MODE === "without"
          ? withoutRun
          : COMPARISON_BASELINE_MODE === "forced" ||
              COMPARISON_BASELINE_MODE === "installed"
            ? withRun
            : naturalRun;
      const effectiveWithoutRun =
        baselineRun ?? withoutRun ?? withRun ?? naturalRun;
      const effectiveWithRun =
        withRun ?? baselineRun ?? naturalRun ?? withoutRun;
      const effectiveNaturalRun =
        naturalRun ?? baselineRun ?? withRun ?? withoutRun;

      if (!effectiveWithoutRun || !effectiveWithRun || !effectiveNaturalRun) {
        throw new Error("Missing run metrics for selected --modes configuration.");
      }

      console.log(`${runPrefix}[RUBRIC] Evaluating quality deterministically...`);
      const taskResult = buildTaskResult(
        task,
        effectiveWithoutRun,
        effectiveWithRun,
        effectiveNaturalRun,
      );

      taskRuns.push(taskResult);

      if (RUN_WITH && withRun) {
        const forcedMcpCallCount = withRun.tool_calls.filter((name) =>
          name.startsWith("mcp__lazyloadingai__"),
        ).length;
        if (forcedMcpCallCount === 0) {
          console.warn(`${runPrefix}[WARN]   ${WITH_LABEL} run did not use MCP tools.`);
        }

        console.log(
          `${runPrefix}${WITH_LABEL}: model ${fmtTokens(effectiveWithoutRun.model_tokens)} → ${fmtTokens(withRun.model_tokens)} ` +
            `(${taskResult.savings_percent}%); total ${fmtTokens(effectiveWithoutRun.total_tokens)} → ${fmtTokens(withRun.total_tokens)} ` +
            `(${taskResult.savings_percent_total}%); calc $${effectiveWithoutRun.cost_usd.toFixed(2)}→$${withRun.cost_usd.toFixed(2)} (${taskResult.savings_percent_cost}%), ` +
            `elapsed ${fmtSeconds(effectiveWithoutRun.elapsed_ms)}→${fmtSeconds(withRun.elapsed_ms)} (${taskResult.speedup_x.toFixed(2)}x), ` +
            `quality Δ ${taskResult.quality_delta >= 0 ? "+" : ""}${taskResult.quality_delta}`,
        );
        console.log(
          `${runPrefix}Tool response bytes (${WITH_LABEL}): ${formatToolResponseBytes(withRun.tool_response_bytes)}`,
        );
      }

      if (RUN_NATURAL && naturalRun) {
        const naturalMcpCallCount = naturalRun.tool_calls.filter((name) =>
          name.startsWith("mcp__lazyloadingai__"),
        ).length;
        if (naturalMcpCallCount === 0) {
          console.warn(`${runPrefix}[WARN]   NATURAL run did not use MCP tools.`);
        }

        console.log(
          `${runPrefix}NATURAL: model ${fmtTokens(effectiveWithoutRun.model_tokens)} → ${fmtTokens(naturalRun.model_tokens)} ` +
            `(${taskResult.natural_savings_percent}%); total ${fmtTokens(effectiveWithoutRun.total_tokens)} → ${fmtTokens(naturalRun.total_tokens)} ` +
            `(${taskResult.natural_savings_percent_total}%); calc $${effectiveWithoutRun.cost_usd.toFixed(2)}→$${naturalRun.cost_usd.toFixed(2)} (${taskResult.natural_savings_percent_cost}%), ` +
            `elapsed ${fmtSeconds(effectiveWithoutRun.elapsed_ms)}→${fmtSeconds(naturalRun.elapsed_ms)} (${taskResult.natural_speedup_x.toFixed(2)}x), ` +
            `quality Δ ${taskResult.natural_quality_delta >= 0 ? "+" : ""}${taskResult.natural_quality_delta}`,
        );
        console.log(
          `${runPrefix}Tool response bytes (NATURAL): ${formatToolResponseBytes(naturalRun.tool_response_bytes)}`,
        );
      }

      if (RUN_WITH && RUN_NATURAL) {
        console.log(
          `${runPrefix}NATURAL vs ${WITH_LABEL} gaps: model ${taskResult.natural_vs_forced_model_delta_percent}%, total ${taskResult.natural_vs_forced_total_delta_percent}%, ` +
            `cost ${taskResult.natural_vs_forced_cost_delta_percent}%, quality ${taskResult.natural_vs_forced_quality_delta >= 0 ? "+" : ""}${taskResult.natural_vs_forced_quality_delta}`,
        );
      }
    }

    const aggregatedTaskResult = aggregateTaskRuns(taskRuns);
    results.push(aggregatedTaskResult);

    if (aggregatedTaskResult.run_summary) {
      const summary = aggregatedTaskResult.run_summary;
      const summaryParts = [`  [AGG]    Runs=${summary.run_count}`];
      if (RUN_WITH) {
        summaryParts.push(
          `savings(model) ${WITH_LABEL} median/min/max=${summary.savings_percent.median.toFixed(1)}%/${summary.savings_percent.min.toFixed(1)}%/${summary.savings_percent.max.toFixed(1)}%`,
        );
      }
      if (RUN_NATURAL) {
        summaryParts.push(
          `savings(model) NATURAL median/min/max=${summary.natural_savings_percent.median.toFixed(1)}%/${summary.natural_savings_percent.min.toFixed(1)}%/${summary.natural_savings_percent.max.toFixed(1)}%`,
        );
      }
      if (RUN_WITH && RUN_NATURAL) {
        summaryParts.push(
          `NATURAL-${WITH_LABEL} model gap median/min/max=${summary.natural_vs_forced_model_delta_percent.median.toFixed(1)}%/${summary.natural_vs_forced_model_delta_percent.min.toFixed(1)}%/${summary.natural_vs_forced_model_delta_percent.max.toFixed(1)}%`,
        );
      }
      console.log(summaryParts.join("; "));
    }
  }

  // Phase 6: Output results
  printConsoleTable(results);
  printMarkdownTable(results);
  writeJsonOutput(results);
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
