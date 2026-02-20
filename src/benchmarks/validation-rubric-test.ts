// @ts-ignore Node --experimental-strip-types supports .ts specifiers at runtime.
import { VALIDATION_EVALUATOR, type QualityScores, type ValidationQualityRaw } from "./validation-rubric.ts";

export {
  VALIDATION_EVALUATOR,
  type QualityScores,
  type ValidationQualityRaw,
};

interface CompletenessRaw {
  passed: boolean;
  required_groups: string[];
  matched_groups: string[];
}

interface AccuracyClaimRaw {
  id: string;
  correct: boolean;
}

interface AccuracyRaw {
  correct_claims: number;
  total_claims: number;
  accuracy_rate: number;
  claims: AccuracyClaimRaw[];
}

interface SpecificityRaw {
  file_paths: string[];
  line_references: string[];
  evidence_count: number;
}

interface ValidationRubricResult {
  quality: QualityScores;
  raw: ValidationQualityRaw;
}

interface PatternGroup {
  id: string;
  mode: "all" | "any";
  patterns: RegExp[];
}

interface ClaimRule {
  id: string;
  kind: "correct" | "incorrect";
  mode: "all" | "any";
  patterns: RegExp[];
}

interface TaskRubricDefinition {
  completenessGroups: PatternGroup[];
  claims: ClaimRule[];
}

const TASK_RUBRICS: Record<number, TaskRubricDefinition> = {
  1: {
    completenessGroups: [
      {
        id: "middleware_file",
        mode: "any",
        patterns: [/\bmiddleware\.ts\b/i],
      },
      {
        id: "protected_paths",
        mode: "any",
        patterns: [/\/editor/i, /\/settings/i, /\/projects/i],
      },
      {
        id: "redirect_behavior",
        mode: "any",
        patterns: [/redirect.*\/login/i, /\/login\?redirect/i],
      },
    ],
    claims: [
      {
        id: "names_all_three_paths",
        kind: "correct",
        mode: "all",
        patterns: [/\/editor/i, /\/settings/i, /\/projects/i],
      },
      {
        id: "redirect_unauthenticated",
        kind: "correct",
        mode: "any",
        patterns: [/redirect.*\/login/i, /\/login\?redirect/i],
      },
      {
        id: "service_unavailable_503",
        kind: "correct",
        mode: "any",
        patterns: [/503/i, /[Ss]ervice [Uu]navailable/i, /supabase.*config/i],
      },
      {
        id: "authenticated_login_redirect",
        kind: "correct",
        mode: "any",
        patterns: [
          /authenticated.*\/login.*redirect/i,
          /\/login.*redirect.*\b\/\b/i,
        ],
      },
    ],
  },
  2: {
    completenessGroups: [
      {
        id: "hook_file",
        mode: "any",
        patterns: [/use-code-generation/i, /useCodeGeneration/i],
      },
      {
        id: "generation_modes",
        mode: "any",
        patterns: [/orchestrat/i, /single/i],
      },
    ],
    claims: [
      {
        id: "identifies_hook",
        kind: "correct",
        mode: "all",
        patterns: [/useCodeGeneration/i],
      },
      {
        id: "default_mode_orchestrated",
        kind: "correct",
        mode: "any",
        patterns: [/default.*orchestrat/i, /orchestrat.*default/i, /"orchestrated"/],
      },
      {
        id: "useChat_single",
        kind: "correct",
        mode: "any",
        patterns: [/useChat/i, /single.*model/i],
      },
      {
        id: "orchestration_non_single",
        kind: "correct",
        mode: "any",
        patterns: [
          /orchestrat.*\.orchestrate/i,
          /\/api\/orchestrate/i,
          /orchestration\.orchestrate/i,
        ],
      },
      {
        id: "materialize_file_update",
        kind: "correct",
        mode: "all",
        patterns: [/materializeFileUpdate/i],
      },
    ],
  },
  3: {
    completenessGroups: [
      {
        id: "type_file",
        mode: "any",
        patterns: [/types\/orchestration/i, /orchestration\.ts/i],
      },
      {
        id: "tasktype_union",
        mode: "all",
        patterns: [/TaskType/i],
      },
      {
        id: "tasktype_breadth",
        mode: "all",
        patterns: [
          /analyze_requirements|design_architecture/i,
          /create_ui_component|create_page|create_api_route/i,
          /review_code|fix_issues/i,
        ],
      },
    ],
    claims: [
      {
        id: "identifies_file",
        kind: "correct",
        mode: "all",
        patterns: [/lib\/orchestration\/types\/orchestration/i],
      },
      {
        id: "lists_common_types",
        kind: "correct",
        mode: "any",
        patterns: [/create_database_schema/i, /create_server_action/i, /integrate_components/i],
      },
      {
        id: "lists_rare_types",
        kind: "correct",
        mode: "any",
        patterns: [
          /intent_revision/i,
          /system_maintenance/i,
          /slot_integration/i,
          /wire_frontend_to_api/i,
        ],
      },
      {
        id: "task_interface_fields",
        kind: "correct",
        mode: "any",
        patterns: [/\bassignedTo\b/i, /\bAgentRole\b/i, /\bTaskStatus\b/i],
      },
      {
        id: "typed_dependencies",
        kind: "correct",
        mode: "any",
        patterns: [/typedDependencies/i, /TypedDependency/i],
      },
      {
        id: "ownership_contract",
        kind: "correct",
        mode: "any",
        patterns: [/TaskOwnershipContract/i, /ownership/i],
      },
    ],
  },
  4: {
    completenessGroups: [
      {
        id: "module_coverage",
        mode: "any",
        patterns: [/\bapp\//i, /\blib\//i, /\bcomponents\//i, /\bhooks\//i, /\borchestration\//i],
      },
      {
        id: "entrypoint_coverage",
        mode: "any",
        patterns: [/\bentry.?point/i, /\bpage\.tsx\b/i, /\blayout\.tsx\b/i, /\bmiddleware\.ts\b/i, /\broute\.ts\b/i],
      },
    ],
    claims: [
      {
        id: "next_app_router",
        kind: "correct",
        mode: "any",
        patterns: [/next\.?js/i, /app.?router/i],
      },
      {
        id: "mentions_modules",
        kind: "correct",
        mode: "any",
        patterns: [/\bmodule/i, /\blib\//i, /\bhooks\//i],
      },
      {
        id: "supabase_auth",
        kind: "correct",
        mode: "all",
        patterns: [/supabase/i],
      },
      {
        id: "e2b_sandbox",
        kind: "correct",
        mode: "any",
        patterns: [/e2b/i, /sandbox/i, /preview/i],
      },
    ],
  },
  5: {
    completenessGroups: [
      {
        id: "route_file",
        mode: "any",
        patterns: [/api\/orchestrate/i, /route\.ts/i],
      },
      {
        id: "auth_flow",
        mode: "any",
        patterns: [/requireAuth/i, /401/i, /unauthoriz/i],
      },
      {
        id: "error_codes",
        mode: "any",
        patterns: [/400/i, /403/i, /503/i],
      },
    ],
    claims: [
      {
        id: "require_auth",
        kind: "correct",
        mode: "all",
        patterns: [/requireAuth/i],
      },
      {
        id: "require_auth_source",
        kind: "correct",
        mode: "any",
        patterns: [/require-auth\.ts/i, /lib\/auth/i],
      },
      {
        id: "verify_ownership",
        kind: "correct",
        mode: "any",
        patterns: [/verifyProjectOwnership/i, /403/i],
      },
      {
        id: "resume_detection",
        kind: "correct",
        mode: "any",
        patterns: [/isResumeRequest/i, /resume/i],
      },
      {
        id: "sse_encoding",
        kind: "correct",
        mode: "any",
        patterns: [/encodeSSE/i, /SSE/i, /[Ss]erver.?[Ss]ent/i],
      },
      {
        id: "session_init",
        kind: "correct",
        mode: "all",
        patterns: [/initializeSessionForRequest/i],
      },
      {
        id: "validation_400",
        kind: "correct",
        mode: "all",
        patterns: [/400/i],
      },
    ],
  },
  6: {
    completenessGroups: [
      {
        id: "all_three_modes",
        mode: "all",
        patterns: [/single/i, /pipeline/i, /orchestrat/i],
      },
      {
        id: "code_flow",
        mode: "any",
        patterns: [/useCodeGeneration/i, /handleSubmit/i, /use-code-generation/i],
      },
    ],
    claims: [
      {
        id: "three_modes_declared",
        kind: "correct",
        mode: "any",
        patterns: [/GenerationMode/i, /three.*mode/i, /models\.ts/i],
      },
      {
        id: "non_single_uses_orchestration",
        kind: "correct",
        mode: "any",
        patterns: [/orchestration\.orchestrate/i, /\/api\/orchestrate/i],
      },
      {
        id: "hook_routes_pipeline_to_api_pipeline",
        kind: "incorrect",
        mode: "all",
        patterns: [/useCodeGeneration/i, /\/api\/pipeline/i],
      },
      {
        id: "file_materialization",
        kind: "correct",
        mode: "all",
        patterns: [/materializeFileUpdate/i],
      },
      {
        id: "e2b_sandbox_sync",
        kind: "correct",
        mode: "any",
        patterns: [/e2b/i, /sandbox/i],
      },
      {
        id: "supabase_persistence",
        kind: "correct",
        mode: "any",
        patterns: [/supabase/i, /projects/i, /persist/i, /JSONB/i],
      },
    ],
  },
  7: {
    completenessGroups: [
      {
        id: "quality_gates_file",
        mode: "any",
        patterns: [/quality.gates/i, /quality-gates\.ts/i],
      },
      {
        id: "gate_types",
        mode: "any",
        patterns: [/HardGate/i, /ScoredGate/i],
      },
    ],
    claims: [
      {
        id: "hard_gate_categories",
        kind: "correct",
        mode: "any",
        patterns: [/routing/i, /alignment/i, /\bbuild\b/i, /runtime/i, /slots/i],
      },
      {
        id: "scored_gate_categories",
        kind: "correct",
        mode: "all",
        patterns: [/\bquality\b/i, /a11y|accessibility/i, /\bperformance\b/i, /\bcoverage\b/i],
      },
      {
        id: "minimum_score_085",
        kind: "correct",
        mode: "any",
        patterns: [/0\.85/i, /minimumScore/i, /85\s*%/i],
      },
      {
        id: "gate_context",
        kind: "correct",
        mode: "any",
        patterns: [/GateContext/i, /\bintent\b.*\bmanifest\b/i],
      },
      {
        id: "fix_suggestions",
        kind: "correct",
        mode: "any",
        patterns: [/FixSuggestion/i, /priority/i],
      },
      {
        id: "protected_file",
        kind: "correct",
        mode: "any",
        patterns: [/[Pp]rotected/i, /system_maintenance/i],
      },
    ],
  },
};

export function evaluateValidationResponse(
  taskId: number,
  response: string,
): ValidationRubricResult {
  const rubric = TASK_RUBRICS[taskId];
  if (!rubric) {
    const emptyRaw: ValidationQualityRaw = {
      task_id: taskId,
      completeness: {
        passed: false,
        required_groups: [],
        matched_groups: [],
      },
      accuracy: {
        correct_claims: 0,
        total_claims: 0,
        accuracy_rate: 0,
        claims: [],
      },
      specificity: {
        file_paths: [],
        line_references: [],
        evidence_count: 0,
      },
      composite_normalized: 0,
    };
    return {
      quality: { completeness: 1, accuracy: 1, specificity: 1 },
      raw: emptyRaw,
    };
  }

  const normalizedText = normalizeResponse(response);

  const matchedGroups = rubric.completenessGroups
    .filter((group) => matchesGroup(group, normalizedText))
    .map((group) => group.id);
  const requiredGroups = rubric.completenessGroups.map((group) => group.id);
  const completenessPassed = requiredGroups.every((groupId) =>
    matchedGroups.includes(groupId),
  );

  const claimResults: AccuracyClaimRaw[] = [];
  for (const claim of rubric.claims) {
    const claimMatched = matchesGroup(
      { id: claim.id, mode: claim.mode, patterns: claim.patterns },
      normalizedText,
    );

    if (!claimMatched) {
      continue;
    }

    claimResults.push({
      id: claim.id,
      correct: claim.kind === "correct",
    });
  }

  const correctClaims = claimResults.filter((claim) => claim.correct).length;
  const totalClaims = claimResults.length;
  const accuracyRate =
    totalClaims > 0
      ? correctClaims / totalClaims
      : completenessPassed
        ? 1
        : 0;

  const specificity = extractSpecificityEvidence(normalizedText);
  const specificityCount =
    specificity.file_paths.length + specificity.line_references.length;

  const completenessBinary = completenessPassed ? 1 : 0;
  const specificityNormalized = Math.min(specificityCount / 8, 1);
  const compositeNormalized = Number(
    (
      completenessBinary * 0.5 +
      accuracyRate * 0.4 +
      specificityNormalized * 0.1
    ).toFixed(4),
  );

  const quality: QualityScores = {
    completeness: completenessPassed ? 5 : 1,
    accuracy: toFivePointScale(accuracyRate),
    specificity: toSpecificityScale(specificityCount),
  };

  const raw: ValidationQualityRaw = {
    task_id: taskId,
    completeness: {
      passed: completenessPassed,
      required_groups: requiredGroups,
      matched_groups: matchedGroups,
    },
    accuracy: {
      correct_claims: correctClaims,
      total_claims: totalClaims,
      accuracy_rate: Number(accuracyRate.toFixed(4)),
      claims: claimResults,
    },
    specificity: {
      file_paths: specificity.file_paths,
      line_references: specificity.line_references,
      evidence_count: specificityCount,
    },
    composite_normalized: compositeNormalized,
  };

  return { quality, raw };
}

function normalizeResponse(response: string): string {
  return response.replace(/\r\n/g, "\n").trim();
}

function matchesGroup(group: PatternGroup, text: string): boolean {
  if (group.mode === "all") {
    return group.patterns.every((pattern) => pattern.test(text));
  }
  return group.patterns.some((pattern) => pattern.test(text));
}

function extractSpecificityEvidence(response: string): {
  file_paths: string[];
  line_references: string[];
} {
  const filePathPattern =
    /\b(?:[A-Za-z]:)?(?:\/|\.\/|\.\.\/)?(?:[\w.-]+\/)*[\w.-]+\.(?:ts|js|tsx|jsx|py|json|md)\b/g;
  const fileWithLinePattern =
    /\b(?:[A-Za-z]:)?(?:\/|\.\/|\.\.\/)?(?:[\w.-]+\/)*[\w.-]+\.(?:ts|js|tsx|jsx|py):\d+(?:-\d+)?\b/g;
  const lineWordPattern = /\blines?\s+\d+(?:\s*-\s*\d+)?\b/gi;

  const filePaths = new Set<string>();
  const lineRefs = new Set<string>();

  for (const match of response.matchAll(filePathPattern)) {
    const value = normalizeEvidenceToken(match[0]);
    if (!value) continue;
    filePaths.add(value);
  }

  for (const match of response.matchAll(fileWithLinePattern)) {
    const value = normalizeEvidenceToken(match[0]);
    if (!value) continue;
    lineRefs.add(value);
  }

  for (const match of response.matchAll(lineWordPattern)) {
    const value = normalizeEvidenceToken(match[0]?.toLowerCase() ?? "");
    if (!value) continue;
    lineRefs.add(value);
  }

  return {
    file_paths: [...filePaths].sort((a, b) => a.localeCompare(b)),
    line_references: [...lineRefs].sort((a, b) => a.localeCompare(b)),
  };
}

function normalizeEvidenceToken(value: string): string {
  return value
    .trim()
    .replace(/^`+|`+$/g, "")
    .replace(/^"+|"+$/g, "")
    .replace(/^'+|'+$/g, "")
    .replace(/[),.;:]+$/g, "")
    .replace(/\\/g, "/");
}

function toFivePointScale(rate: number): number {
  if (!Number.isFinite(rate)) return 1;
  const bounded = Math.max(0, Math.min(1, rate));
  return 1 + Math.round(bounded * 4);
}

function toSpecificityScale(evidenceCount: number): number {
  if (evidenceCount >= 8) return 5;
  if (evidenceCount >= 5) return 4;
  if (evidenceCount >= 3) return 3;
  if (evidenceCount >= 1) return 2;
  return 1;
}
