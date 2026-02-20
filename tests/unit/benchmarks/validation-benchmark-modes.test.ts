import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("validation benchmark --modes validation", () => {
  it("rejects removed meta mode and shows updated valid modes", () => {
    const repoRoot = path.resolve(__dirname, "../../../");

    let output = "";
    try {
      execFileSync(
        "node",
        [
          "--experimental-strip-types",
          "benchmarks/validation-benchmark.ts",
          "--modes",
          "meta",
        ],
        {
          cwd: repoRoot,
          stdio: "pipe",
        },
      );
    } catch (error: any) {
      output = `${error?.stdout?.toString?.() ?? ""}${error?.stderr?.toString?.() ?? ""}`;
    }

    expect(output).toContain("Invalid mode 'meta' in --modes.");
    expect(output).toContain("Use: without,forced,natural,installed.");
  });

  it("rejects forced+installed because they share the WITH slot", () => {
    const repoRoot = path.resolve(__dirname, "../../../");

    let output = "";
    try {
      execFileSync(
        "node",
        [
          "--experimental-strip-types",
          "benchmarks/validation-benchmark.ts",
          "--modes",
          "forced,installed",
        ],
        {
          cwd: repoRoot,
          stdio: "pipe",
        },
      );
    } catch (error: any) {
      output = `${error?.stdout?.toString?.() ?? ""}${error?.stderr?.toString?.() ?? ""}`;
    }

    expect(output).toContain(
      "Cannot run both 'forced' and 'installed' in the same benchmark",
    );
  });

  it("accepts without,installed mode parsing", () => {
    const repoRoot = path.resolve(__dirname, "../../../");
    const outputPath = path.join(
      os.tmpdir(),
      `validation-modes-installed-${Date.now()}.json`,
    );

    try {
      execFileSync(
        "node",
        [
          "--experimental-strip-types",
          "benchmarks/validation-benchmark.ts",
          "--modes",
          "without,installed",
          "--dry-run",
          "--rescore",
          "benchmarks/results/validation-2026-02-15.json",
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
    } finally {
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
      }
    }
  });
});
