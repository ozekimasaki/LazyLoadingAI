import { describe, expect, it } from "vitest";
import {
  evaluateValidationResponse,
  VALIDATION_EVALUATOR,
} from "../../../src/benchmarks/validation-rubric-test.js";

describe("validation deterministic rubric (openhagen/test)", () => {
  it("exposes evaluator metadata", () => {
    expect(VALIDATION_EVALUATOR.type).toBe("deterministic-rubric");
    expect(VALIDATION_EVALUATOR.version).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  it("Task 1 passes completeness and accuracy with concrete middleware details", () => {
    const response = [
      "middleware.ts protects /editor, /settings, and /projects.",
      "Unauthenticated users are redirected to /login?redirect=/editor.",
      "When Supabase config is missing it returns 503 Service Unavailable.",
      "Authenticated users hitting /login are redirected to /.",
    ].join("\n");

    const result = evaluateValidationResponse(1, response);
    expect(result.raw.completeness.passed).toBe(true);
    expect(result.raw.accuracy.total_claims).toBe(4);
    expect(result.raw.accuracy.correct_claims).toBe(4);
  });

  it("Task 1 fails completeness with vague middleware answer", () => {
    const response =
      "There is auth middleware and it checks sessions before protected routes.";

    const result = evaluateValidationResponse(1, response);
    expect(result.raw.completeness.passed).toBe(false);
    expect(result.quality.completeness).toBe(1);
  });

  it("Task 3 passes when TaskType and representative values are provided", () => {
    const response = [
      "TaskType is in lib/orchestration/types/orchestration.ts.",
      'It includes values like "analyze_requirements", "create_page", and "review_code".',
      "Task includes assignedTo: AgentRole and status: TaskStatus.",
    ].join("\n");

    const result = evaluateValidationResponse(3, response);
    expect(result.raw.completeness.passed).toBe(true);
    expect(result.raw.accuracy.total_claims).toBeGreaterThan(0);
  });

  it("Task 5 captures auth source and route error handling details", () => {
    const response = [
      "app/api/orchestrate/route.ts calls requireAuth from lib/auth/require-auth.ts (401/503 come from there).",
      "verifyProjectOwnership can return 403 and payload validation returns 400.",
      "Resume flow is checked via isResumeRequest.",
      "initializeSessionForRequest sets up the session and events stream through encodeSSE.",
    ].join("\n");

    const result = evaluateValidationResponse(5, response);
    expect(result.raw.completeness.passed).toBe(true);
    expect(result.raw.accuracy.total_claims).toBe(7);
    expect(result.raw.accuracy.correct_claims).toBe(7);
  });

  it("Task 7 recognizes gates, score threshold, and protected context", () => {
    const response = [
      "quality-gates.ts defines HardGate and ScoredGate.",
      "Hard gate categories include routing, alignment, build, runtime, and slots.",
      "Scored categories are quality, accessibility (a11y), performance, and coverage.",
      "runGates uses minimumScore 0.85 with GateContext intent/manifest checks.",
      "FixSuggestion includes priority and this is a Protected file tied to system_maintenance.",
    ].join("\n");

    const result = evaluateValidationResponse(7, response);
    expect(result.raw.completeness.passed).toBe(true);
    expect(result.raw.accuracy.total_claims).toBe(6);
    expect(result.raw.accuracy.correct_claims).toBe(6);
  });

  it("returns safe fallback for unknown task ids", () => {
    const result = evaluateValidationResponse(999, "No rubric should match this.");
    expect(result.quality).toEqual({
      completeness: 1,
      accuracy: 1,
      specificity: 1,
    });
    expect(result.raw.task_id).toBe(999);
  });
});
