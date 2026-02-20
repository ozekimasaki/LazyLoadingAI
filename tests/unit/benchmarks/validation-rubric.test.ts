import { describe, expect, it } from "vitest";
import {
  evaluateValidationResponse,
  VALIDATION_EVALUATOR,
} from "../../../src/benchmarks/validation-rubric.js";

describe("validation deterministic rubric", () => {
  it("exposes evaluator metadata", () => {
    expect(VALIDATION_EVALUATOR.type).toBe("deterministic-rubric");
    expect(VALIDATION_EVALUATOR.version).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  it("scores Task 3 completeness from high-level entrypoint, not rawBody alone", () => {
    const lowLevelOnly = evaluateValidationResponse(
      3,
      [
        "The main function responsible is rawBody in lib/content-type-parser.js:233.",
        "It parses stream chunks and calls parser.fn.",
      ].join("\n"),
    );

    expect(lowLevelOnly.raw.completeness.passed).toBe(false);
    expect(lowLevelOnly.quality.completeness).toBe(1);

    const highLevel = evaluateValidationResponse(
      3,
      [
        "The high-level entry point is ContentTypeParser.prototype.run in lib/content-type-parser.js:185.",
        "It delegates to rawBody and then invokes handler(request, reply).",
      ].join("\n"),
    );

    expect(highLevel.raw.completeness.passed).toBe(true);
    expect(highLevel.quality.completeness).toBe(5);
    expect(highLevel.raw.accuracy.total_claims).toBeGreaterThan(0);
  });

  it("counts specificity evidence from file paths and line references", () => {
    const result = evaluateValidationResponse(
      1,
      [
        "See lib/route.js:203 and lib/route.js:452.",
        "Also compare src/server/index.ts line 18 and lines 42-58.",
      ].join("\n"),
    );

    expect(result.raw.specificity.file_paths).toContain("lib/route.js");
    expect(result.raw.specificity.evidence_count).toBeGreaterThanOrEqual(3);
    expect(result.quality.specificity).toBeGreaterThan(1);
  });

  it("returns a safe fallback for unknown tasks", () => {
    const result = evaluateValidationResponse(999, "No rubric should match this.");
    expect(result.quality).toEqual({
      completeness: 1,
      accuracy: 1,
      specificity: 1,
    });
    expect(result.raw.task_id).toBe(999);
  });
});
