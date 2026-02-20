/**
 * Session-level tool call awareness helpers.
 * Drives exploration toward synthesis and applies tool-aware finalize controls.
 */

export type AwarenessState = 'explore' | 'synthesize' | 'finalize';

export interface AwarenessConfig {
  /** Novel (tool,target) pairs allowed before synthesis nudges begin */
  novelExploreLimit: number;
  /** Novel (tool,target) pairs allowed before hard finalize */
  novelSynthesizeLimit: number;
  /** Absolute total call hard-cap safety valve */
  totalHardCap: number;
}

export const DEFAULT_CONFIG: AwarenessConfig = {
  novelExploreLimit: 8,
  novelSynthesizeLimit: 15,
  totalHardCap: 25,
};

const SYNTHESIZE_NOTES = [
  '[Note: {novel} unique lookups across {total} total calls. Plan to synthesize soon. New symbol lookups are still available.]',
  '[Warning: {novel} unique lookups across {total} total calls. Synthesize NOW. Only look up a new symbol if critical.]',
] as const;

const CACHE_HIT_MESSAGE =
  '[Cached call reused] Reusing previous result for this equivalent request (no budget consumed).';

const FINALIZE_MESSAGE =
  '[LazyLoadingAI BUDGET EXHAUSTED] {novel} unique lookups across {total} total calls. Synthesize your answer with the information gathered.';

export const TOOL_CALL_AWARENESS_THRESHOLD = DEFAULT_CONFIG.novelSynthesizeLimit + 1;
export const TOOL_CALL_AWARENESS_NOTE = FINALIZE_MESSAGE
  .replace('{novel}', `${TOOL_CALL_AWARENESS_THRESHOLD}+`)
  .replace('{total}', `${DEFAULT_CONFIG.totalHardCap}+`);

type TextContentBlock = {
  type?: string;
  text?: string;
  [key: string]: unknown;
};

export interface ToolResponseLike {
  content?: TextContentBlock[];
  [key: string]: unknown;
}

export function getAwarenessState(
  novelCount: number,
  totalCount: number,
  config: AwarenessConfig = DEFAULT_CONFIG
): AwarenessState {
  if (totalCount > config.totalHardCap) {
    return 'finalize';
  }
  if (novelCount > config.novelSynthesizeLimit) {
    return 'finalize';
  }
  if (novelCount > config.novelExploreLimit) {
    return 'synthesize';
  }
  return 'explore';
}

function formatMessage(template: string, novelCount: number | string, totalCount: number | string): string {
  return template
    .replace('{novel}', String(novelCount))
    .replace('{total}', String(totalCount));
}

function getSynthesizeNote(
  novelCount: number,
  totalCount: number,
  config: AwarenessConfig
): string {
  const midpoint =
    config.novelExploreLimit
    + Math.ceil((config.novelSynthesizeLimit - config.novelExploreLimit) / 2);
  const template = novelCount <= midpoint ? SYNTHESIZE_NOTES[0] : SYNTHESIZE_NOTES[1];
  return formatMessage(template, novelCount, totalCount);
}

function appendNote<T extends ToolResponseLike>(response: T, note: string): T {
  if (!Array.isArray(response.content) || response.content.length === 0) {
    return response;
  }

  const textIndex = response.content.findIndex(
    block => block.type === 'text' && typeof block.text === 'string'
  );

  if (textIndex === -1) {
    return response;
  }

  const existingBlock = response.content[textIndex];
  if (!existingBlock || typeof existingBlock.text !== 'string') {
    return response;
  }

  if (existingBlock.text.includes(note)) {
    return response;
  }

  const separator = existingBlock.text.length > 0 ? '\n\n' : '';
  const content = [...response.content];
  content[textIndex] = {
    ...existingBlock,
    text: `${existingBlock.text}${separator}${note}`,
  };

  return {
    ...response,
    content,
  };
}

function createTextResponse<T extends ToolResponseLike>(text: string): T {
  return {
    content: [
      {
        type: 'text',
        text,
      },
    ],
  } as T;
}

function createFinalizeResponse<T extends ToolResponseLike>(
  novelCount: number,
  totalCount: number
): T {
  return createTextResponse<T>(formatMessage(FINALIZE_MESSAGE, novelCount, totalCount));
}

function normalizeForStableKey(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => normalizeForStableKey(item));
  }

  if (value && typeof value === 'object') {
    const normalized: Record<string, unknown> = {};
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    for (const key of keys) {
      normalized[key] = normalizeForStableKey(record[key]);
    }
    return normalized;
  }

  return value;
}

function stableInputKey(input: unknown): string {
  return JSON.stringify(normalizeForStableKey(input));
}

function normalizeSearchQueryInput(input: unknown): unknown {
  if (!input || typeof input !== 'object') {
    return input;
  }

  const normalized = {
    ...(input as Record<string, unknown>),
  };

  for (const key of ['query', 'return_type', 'param_type'] as const) {
    const value = normalized[key];
    if (typeof value === 'string') {
      normalized[key] = value.trim().replace(/\s+/g, ' ').toLowerCase();
    }
  }

  return normalized;
}

function normalizeTarget(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value as Record<string, unknown>;
}

export function extractTarget(toolName: string | undefined, input: unknown): string | null {
  if (!toolName || toolName === 'sync_index') {
    return null;
  }

  const payload = asRecord(input);
  if (!payload) {
    return toolName === 'list_files' ? '*' : null;
  }

  switch (toolName) {
    case 'search_symbols': {
      const query = normalizeTarget(payload['query']);
      const returnType = normalizeTarget(payload['return_type']);
      const paramType = normalizeTarget(payload['param_type']);
      const parts: string[] = [];
      if (query) {
        parts.push(`query:${query}`);
      }
      if (returnType) {
        parts.push(`return_type:${returnType}`);
      }
      if (paramType) {
        parts.push(`param_type:${paramType}`);
      }
      return parts.length > 0 ? parts.join('||') : null;
    }
    case 'get_function':
    case 'trace_calls':
      return normalizeTarget(payload['function_name']);
    case 'get_class':
    case 'trace_types':
      return normalizeTarget(payload['class_name']);
    case 'find_references':
    case 'suggest_related':
    case 'get_related_context':
      return normalizeTarget(payload['symbol_name']);
    case 'list_functions':
    case 'get_module_dependencies':
      return normalizeTarget(payload['file_path']);
    case 'list_files':
      return normalizeTarget(payload['directory']) ?? '*';
    case 'get_architecture_overview':
      return normalizeTarget(payload['focus']) ?? '*';
    default:
      return null;
  }
}

function getStableKeys(toolName: string | undefined, input: unknown): string[] {
  const prefix = toolName ? `${toolName}::` : '';
  const keys = [`${prefix}${stableInputKey(input)}`];

  if (toolName === 'search_symbols') {
    const normalizedSearchInput = normalizeSearchQueryInput(input);
    const normalizedKey = `${prefix}${stableInputKey(normalizedSearchInput)}`;
    if (!keys.includes(normalizedKey)) {
      keys.push(normalizedKey);
    }
  }

  return keys;
}

export function appendToolCallAwarenessNote<T extends ToolResponseLike>(
  response: T,
  callCount: number,
  threshold: number = TOOL_CALL_AWARENESS_THRESHOLD,
  note: string = TOOL_CALL_AWARENESS_NOTE
): T {
  if (callCount < threshold) {
    return response;
  }

  return appendNote(response, note);
}

export function createToolCallAwarenessWrapper(
  config: AwarenessConfig = DEFAULT_CONFIG
): <TInput, TResult extends ToolResponseLike>(
  handler: (input: TInput) => Promise<TResult>,
  toolName?: string
) => (input: TInput) => Promise<TResult> {
  let novelCallCount = 0;
  let totalCallCount = 0;
  const cachedResponses = new Map<string, ToolResponseLike>();
  const seenToolTargetPairs = new Set<string>();

  return function withToolCallAwareness<TInput, TResult extends ToolResponseLike>(
    handler: (input: TInput) => Promise<TResult>,
    toolName?: string
  ): (input: TInput) => Promise<TResult> {
    return async (input: TInput): Promise<TResult> => {
      const stableKeys = getStableKeys(toolName, input);
      const cachedKey = stableKeys.find(key => cachedResponses.has(key));
      if (cachedKey) {
        return appendNote(cachedResponses.get(cachedKey) as TResult, CACHE_HIT_MESSAGE);
      }

      if (toolName === 'sync_index') {
        const response = await handler(input);
        cachedResponses.clear();
        return response;
      }

      const target = extractTarget(toolName, input);
      const pairKey = toolName && target ? `${toolName}::${target}` : null;
      const isNovel = pairKey ? !seenToolTargetPairs.has(pairKey) : false;

      totalCallCount += 1;
      if (isNovel && pairKey) {
        novelCallCount += 1;
        seenToolTargetPairs.add(pairKey);
      }

      const state = getAwarenessState(novelCallCount, totalCallCount, config);
      if (state === 'finalize') {
        return createFinalizeResponse<TResult>(novelCallCount, totalCallCount);
      }

      const response = await handler(input);
      for (const key of stableKeys) {
        cachedResponses.set(key, response);
      }

      if (state === 'synthesize') {
        return appendNote(response, getSynthesizeNote(novelCallCount, totalCallCount, config));
      }

      return response;
    };
  };
}
