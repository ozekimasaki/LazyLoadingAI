import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("validation benchmark --rescore", () => {
  it("rescored output runs offline without query invocations", () => {
    const repoRoot = path.resolve(__dirname, "../../../");
    const inputPath = path.join(
      repoRoot,
      "benchmarks/results/validation-2026-02-15.json",
    );
    const outputPath = path.join(
      os.tmpdir(),
      `validation-rescore-${Date.now()}.json`,
    );

    try {
      execFileSync(
        "node",
        [
          "--experimental-strip-types",
          "benchmarks/validation-benchmark.ts",
          "--rescore",
          inputPath,
          "--output",
          outputPath,
        ],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            VALIDATION_BENCHMARK_FORBID_QUERY: "1",
          },
          stdio: "pipe",
        },
      );

      expect(fs.existsSync(outputPath)).toBe(true);
      const parsed = JSON.parse(fs.readFileSync(outputPath, "utf-8"));
      expect(parsed.evaluator?.type).toBe("deterministic-rubric");
      expect(parsed.summary).toHaveProperty("avg_elapsed_ms_without");
      expect(parsed.summary).toHaveProperty("avg_elapsed_ms_with");
      expect(parsed.summary).toHaveProperty("avg_speedup_x");
      expect(parsed.tasks[0]).toHaveProperty("speedup_x");
      expect(parsed.tasks[0].without).toHaveProperty("quality_raw");
      expect(parsed.tasks[0].with).toHaveProperty("quality_raw");
    } finally {
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
      }
    }
  });
});
