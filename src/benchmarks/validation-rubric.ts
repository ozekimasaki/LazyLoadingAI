export interface QualityScores {
  completeness: number;
  accuracy: number;
  specificity: number;
}

export interface CompletenessRaw {
  passed: boolean;
  required_groups: string[];
  matched_groups: string[];
}

export interface AccuracyClaimRaw {
  id: string;
  correct: boolean;
}

export interface AccuracyRaw {
  correct_claims: number;
  total_claims: number;
  accuracy_rate: number;
  claims: AccuracyClaimRaw[];
}

export interface SpecificityRaw {
  file_paths: string[];
  line_references: string[];
  evidence_count: number;
}

export interface ValidationQualityRaw {
  task_id: number;
  completeness: CompletenessRaw;
  accuracy: AccuracyRaw;
  specificity: SpecificityRaw;
  composite_normalized: number;
}

export interface ValidationRubricResult {
  quality: QualityScores;
  raw: ValidationQualityRaw;
}

export const VALIDATION_EVALUATOR = {
  type: 'deterministic-rubric',
  version: '2026-02-15.1',
} as const;

interface PatternGroup {
  id: string;
  mode: 'all' | 'any';
  patterns: RegExp[];
}

interface ClaimRule {
  id: string;
  kind: 'correct' | 'incorrect';
  mode: 'all' | 'any';
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
        id: 'route_registration_entry',
        mode: 'all',
        patterns: [/\broute\b/i, /lib\/route\.js/i],
      },
    ],
    claims: [
      {
        id: 'names_route_function',
        kind: 'correct',
        mode: 'all',
        patterns: [/\broute\b/i, /lib\/route\.js/i],
      },
      {
        id: 'describes_route_parameters',
        kind: 'correct',
        mode: 'any',
        patterns: [/\boptions\b/i, /\bisFastify\b/i, /\bRouteOptions\b/],
      },
    ],
  },
  2: {
    completenessGroups: [
      {
        id: 'reply_class_anchor',
        mode: 'all',
        patterns: [/\bReply\b/i, /lib\/reply\.js/i],
      },
    ],
    claims: [
      {
        id: 'identifies_reply_class',
        kind: 'correct',
        mode: 'all',
        patterns: [/\bReply\b/i, /lib\/reply\.js/i],
      },
      {
        id: 'mentions_core_reply_methods',
        kind: 'correct',
        mode: 'any',
        patterns: [/\bsend\s*\(/i, /\bcode\s*\(/i, /\bstatus\s*\(/i, /\bheader\s*\(/i],
      },
    ],
  },
  3: {
    completenessGroups: [
      {
        id: 'high_level_parser_entrypoint',
        mode: 'any',
        patterns: [
          /\bContentTypeParser\.prototype\.run\b/i,
          /\bcontenttypeparser\.prototype\.run\b/i,
          /\bContentTypeParser\b[\s\S]{0,40}\.run\b/i,
        ],
      },
    ],
    claims: [
      {
        id: 'identifies_run_entrypoint',
        kind: 'correct',
        mode: 'any',
        patterns: [
          /\bContentTypeParser\.prototype\.run\b/i,
          /\bcontenttypeparser\.prototype\.run\b/i,
          /\bContentTypeParser\b[\s\S]{0,40}\.run\b/i,
        ],
      },
      {
        id: 'references_parser_file',
        kind: 'correct',
        mode: 'any',
        patterns: [/lib\/content-type-parser\.js/i, /content-type-parser\.js/i],
      },
      {
        id: 'rawbody_as_primary_entrypoint',
        kind: 'incorrect',
        mode: 'any',
        patterns: [
          /(main|primary)\s+function[^.\n]{0,120}\brawBody\b/i,
          /responsible[^.\n]{0,120}\brawBody\b/i,
          /\brawBody\b[^.\n]{0,80}\bmain\b/i,
        ],
      },
    ],
  },
  4: {
    completenessGroups: [
      {
        id: 'module_coverage',
        mode: 'any',
        patterns: [/\blib\//i, /\bsrc\//i, /\btypes\//i, /\bserver\//i, /\bindexer\//i],
      },
      {
        id: 'entrypoint_coverage',
        mode: 'any',
        patterns: [/\bentry point/i, /\bfastify\.js\b/i, /\bsrc\/index\.(ts|js)\b/i, /\bindex\.(ts|js)\b/i],
      },
    ],
    claims: [
      {
        id: 'mentions_modules',
        kind: 'correct',
        mode: 'any',
        patterns: [/\bmain modules?\b/i, /\bmodule/i, /\blib\//i],
      },
      {
        id: 'mentions_connections',
        kind: 'correct',
        mode: 'any',
        patterns: [/\bconnect/i, /\bdependenc/i, /\bimports?\b/i, /\b->\b/],
      },
      {
        id: 'mentions_entrypoints',
        kind: 'correct',
        mode: 'any',
        patterns: [/\bentry point/i, /\bfastify\.js\b/i, /\bsrc\/index\.(ts|js)\b/i],
      },
    ],
  },
  5: {
    completenessGroups: [
      {
        id: 'error_hook_chain',
        mode: 'any',
        patterns: [/\bonErrorHook\b/i, /\bhandleError\b/i, /\bfallbackErrorHandler\b/i],
      },
      {
        id: 'response_terminal',
        mode: 'any',
        patterns: [/\breply\.send\b/i, /\bwriteHead\b/i, /\berror response\b/i],
      },
    ],
    claims: [
      {
        id: 'mentions_onerrorhook',
        kind: 'correct',
        mode: 'any',
        patterns: [/\bonErrorHook\b/i],
      },
      {
        id: 'mentions_handleerror_chain',
        kind: 'correct',
        mode: 'any',
        patterns: [/\bhandleError\b/i, /\bfallbackErrorHandler\b/i],
      },
      {
        id: 'mentions_response_send',
        kind: 'correct',
        mode: 'any',
        patterns: [/\breply\.send\b/i, /\bwriteHead\b/i, /\bend\s*\(/i],
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
      correct: claim.kind === 'correct',
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
  return response.replace(/\r\n/g, '\n').trim();
}

function matchesGroup(group: PatternGroup, text: string): boolean {
  if (group.mode === 'all') {
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
    const value = normalizeEvidenceToken(match[0]?.toLowerCase() ?? '');
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
    .replace(/^`+|`+$/g, '')
    .replace(/^"+|"+$/g, '')
    .replace(/^'+|'+$/g, '')
    .replace(/[),.;:]+$/g, '')
    .replace(/\\/g, '/');
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
