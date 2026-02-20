/**
 * list_functions tool implementation
 */

import fs from 'node:fs';
import type { Indexer } from '../../indexer/index.js';
import type { FileIndex, FunctionSignature, Language } from '../../types/index.js';
import { enforceOutputBudget, formatCompactTable } from './compact-format.js';

const MAX_TOP_IMPLEMENTATIONS = 10;
const SOURCE_TOKEN_BUDGET = 4000;
const SOURCE_CHAR_BUDGET = SOURCE_TOKEN_BUDGET * 4;
const DEFAULT_MAX_BYTES = 4000;
const SMALL_FILE_READ_HINT_LINE_LIMIT = 200;
const MIN_SOURCE_PREVIEW_CHARS = 160;
const TEST_CALLBACK_CONTEXTS = new Set([
  'describe',
  'it',
  'test',
  'beforeEach',
  'afterEach',
  'beforeAll',
  'afterAll',
  'suite',
  'spec',
  'context',
  'before',
  'after',
]);

export interface ListFunctionsInput {
  filePath: string;
  includePrivate?: boolean;
  includeSource?: boolean;
  format?: 'compact' | 'markdown';
}

export async function listFunctionsTool(
  indexer: Indexer,
  input: ListFunctionsInput
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const outputMode = input.format ?? 'compact';

  // First try path resolution to get better error messages
  const resolved = await indexer.resolvePath(input.filePath);

  if (!resolved.success) {
    let errorMessage = `File not found in index: \`${input.filePath}\`\n\n`;

    if (resolved.error.type === 'ambiguous') {
      errorMessage = `Multiple files match "${input.filePath}":\n`;
      if (resolved.error.suggestions) {
        for (const suggestion of resolved.error.suggestions) {
          errorMessage += `  - ${suggestion}\n`;
        }
      }
      errorMessage += '\nPlease specify a more complete path.';
    } else {
      // Show available files in nearest directory for autocomplete
      if (resolved.error.availablePaths && resolved.error.availablePaths.length > 0) {
        errorMessage += `Available files in \`${resolved.error.searchedDirectory}/\`:\n`;
        for (const availablePath of resolved.error.availablePaths.slice(0, 10)) {
          errorMessage += `  - ${availablePath}\n`;
        }
        if (resolved.error.availablePaths.length > 10) {
          errorMessage += `  ... (${resolved.error.availablePaths.length - 10} more)\n`;
        }
        errorMessage += '\n';
      }

      if (resolved.error.suggestions && resolved.error.suggestions.length > 0) {
        errorMessage += 'Did you mean one of these?\n';
        for (const suggestion of resolved.error.suggestions) {
          errorMessage += `  - ${suggestion}\n`;
        }
      } else {
        errorMessage += 'Make sure the file has been indexed with `lazy-load index`.';
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: errorMessage,
        },
      ],
    };
  }

  // Show auto-resolution message if applicable
  let autoResolveNote = '';
  if (resolved.result.autoResolved && resolved.result.originalInput) {
    autoResolveNote = `> Auto-resolved \`${resolved.result.originalInput}\` → \`${resolved.result.relativePath}\`\n\n`;
  }

  const file = await indexer.getFile(resolved.result.resolvedPath);

  if (!file) {
    return {
      content: [
        {
          type: 'text',
          text: `File not indexed: ${input.filePath}. Run \`lazy-load index\`.`,
        },
      ],
    };
  }

  let output = autoResolveNote;
  output += `# Functions in ${file.relativePath}\n\n`;

  // Display parse status warnings if any
  if (file.parseStatus && file.parseStatus !== 'complete') {
    output += `> ⚠️ **Parse Status: ${file.parseStatus.toUpperCase()}**\n`;

    if (file.parseWarnings && file.parseWarnings.length > 0) {
      for (const warning of file.parseWarnings) {
        output += `>\n> **${warning.code}**: ${warning.message}\n`;

        if (warning.details) {
          const details = warning.details;
          if (details.fileSize !== undefined && details.maxSize !== undefined) {
            output += `> - File size: ${formatBytes(details.fileSize)} (limit: ${formatBytes(details.maxSize)})\n`;
          }
          if (details.lineCount !== undefined) {
            output += `> - Line count: ${details.lineCount}\n`;
          }
          if (warning.code === 'FILE_TOO_LARGE') {
            output += `>\n> **Tip**: Use \`--max-file-size 0\` during indexing to disable size limits.\n`;
          }
        }
      }
    }
    output += '\n';
  }

  // Separate regular functions from callbacks
  const allFunctions = input.includePrivate
    ? file.functions
    : file.functions.filter(f => !f.modifiers.isPrivate);

  // Separate top-level functions from nested functions and callbacks
  const topLevelFunctions = allFunctions.filter(f => f.kind !== 'callback' && (f.nestingDepth ?? 0) === 0);
  const nestedFunctions = allFunctions.filter(f => f.kind !== 'callback' && (f.nestingDepth ?? 0) > 0);
  const regularFunctions = topLevelFunctions;
  const callbacks = allFunctions.filter(f => f.kind === 'callback');

  // Build a map of parent functions to their nested children
  const nestedByParent = new Map<string, typeof nestedFunctions>();
  for (const nested of nestedFunctions) {
    const parent = nested.parentFunction ?? '';
    if (!nestedByParent.has(parent)) {
      nestedByParent.set(parent, []);
    }
    nestedByParent.get(parent)!.push(nested);
  }

  // Group callbacks by context
  const testFrameworkContexts = new Set([
    'describe', 'it', 'test', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll',
    'suite', 'spec', 'context', 'before', 'after'
  ]);
  const testCallbacks = callbacks.filter(f =>
    f.modifiers.callbackContext && testFrameworkContexts.has(f.modifiers.callbackContext)
  );
  const eventCallbacks = callbacks.filter(f =>
    f.modifiers.callbackContext && (
      f.modifiers.callbackContext.startsWith('on:') ||
      f.modifiers.callbackContext.startsWith('once:') ||
      f.modifiers.callbackContext.startsWith('addEventListener:')
    )
  );
  const otherCallbacks = callbacks.filter(f =>
    f.kind === 'callback' &&
    !testFrameworkContexts.has(f.modifiers.callbackContext ?? '') &&
    !f.modifiers.callbackContext?.startsWith('on:') &&
    !f.modifiers.callbackContext?.startsWith('once:') &&
    !f.modifiers.callbackContext?.startsWith('addEventListener:')
  );

  if (outputMode === 'compact') {
    const compactOutput = renderCompactFunctionsOutput(
      file,
      regularFunctions,
      nestedByParent,
      testCallbacks,
      eventCallbacks,
      otherCallbacks,
      Boolean(input.includePrivate)
    );
    return {
      content: [
        {
          type: 'text',
          text: enforceOutputBudget(compactOutput, DEFAULT_MAX_BYTES),
        },
      ],
    };
  }

  if (regularFunctions.length > 0) {
    // Count total including nested
    const totalCount = regularFunctions.length + nestedFunctions.length;
    output += `## Functions (${totalCount})\n\n`;

    for (const func of regularFunctions) {
      output += `### ${func.name}\n`;
      output += '```' + file.language + '\n';
      output += func.signature + '\n';
      output += '```\n';
      output += `- **Line**: ${func.location.startLine}-${func.location.endLine}\n`;

      if (func.documentation?.description) {
        output += `- **Description**: ${func.documentation.description}\n`;
      }

      if (func.modifiers.isAsync) output += `- *async*\n`;
      if (func.modifiers.isExported) output += `- *exported*\n`;

      // Show nested functions under this parent
      const nested = nestedByParent.get(func.name);
      if (nested && nested.length > 0) {
        output += `- **Nested Functions**: ${nested.map(n => n.localName).join(', ')}\n`;
      }

      output += '\n';

      // Display nested functions with indentation
      if (nested && nested.length > 0) {
        for (const nestedFunc of nested) {
          output += `#### ${nestedFunc.name}\n`;
          output += '```' + file.language + '\n';
          output += nestedFunc.signature + '\n';
          output += '```\n';
          output += `- **Line**: ${nestedFunc.location.startLine}-${nestedFunc.location.endLine}\n`;
          output += `- **Parent**: ${nestedFunc.parentFunction}\n`;
          output += `- **Nesting Depth**: ${nestedFunc.nestingDepth}\n`;

          if (nestedFunc.documentation?.description) {
            output += `- **Description**: ${nestedFunc.documentation.description}\n`;
          }

          if (nestedFunc.modifiers.isAsync) output += `- *async*\n`;

          // Check for deeper nested functions
          const deeperNested = nestedByParent.get(nestedFunc.name);
          if (deeperNested && deeperNested.length > 0) {
            output += `- **Nested Functions**: ${deeperNested.map(n => n.localName).join(', ')}\n`;
          }

          output += '\n';
        }
      }
    }
  }

  // Test functions
  if (testCallbacks.length > 0) {
    output += `## Test Functions (${testCallbacks.length})\n\n`;

    for (const func of testCallbacks) {
      output += `### ${func.name}\n`;
      output += '```' + file.language + '\n';
      output += func.signature + '\n';
      output += '```\n';
      output += `- **Line**: ${func.location.startLine}-${func.location.endLine}\n`;
      output += `- **Context**: ${func.modifiers.callbackContext}\n`;

      if (func.modifiers.isAsync) output += `- *async*\n`;

      output += '\n';
    }
  }

  // Event handlers
  if (eventCallbacks.length > 0) {
    output += `## Event Handlers (${eventCallbacks.length})\n\n`;

    for (const func of eventCallbacks) {
      output += `### ${func.name}\n`;
      output += '```' + file.language + '\n';
      output += func.signature + '\n';
      output += '```\n';
      output += `- **Line**: ${func.location.startLine}-${func.location.endLine}\n`;
      output += `- **Event**: ${func.modifiers.callbackContext}\n`;

      if (func.modifiers.isAsync) output += `- *async*\n`;

      output += '\n';
    }
  }

  // Other callbacks
  if (otherCallbacks.length > 0) {
    output += `## Callbacks (${otherCallbacks.length})\n\n`;

    for (const func of otherCallbacks) {
      output += `### ${func.name}\n`;
      output += '```' + file.language + '\n';
      output += func.signature + '\n';
      output += '```\n';
      output += `- **Line**: ${func.location.startLine}-${func.location.endLine}\n`;
      if (func.modifiers.callbackContext) {
        output += `- **Context**: ${func.modifiers.callbackContext}\n`;
      }

      if (func.modifiers.isAsync) output += `- *async*\n`;

      output += '\n';
    }
  }

  // Classes and their methods
  if (file.classes.length > 0) {
    for (const cls of file.classes) {
      const methods = input.includePrivate
        ? cls.methods
        : cls.methods.filter(m => !m.modifiers.isPrivate);

      output += `## Class: ${cls.name}\n\n`;
      output += '```' + file.language + '\n';
      output += cls.signature + '\n';
      output += '```\n';
      output += `- **Line**: ${cls.location.startLine}-${cls.location.endLine}\n`;

      if (cls.documentation?.description) {
        output += `- **Description**: ${cls.documentation.description}\n`;
      }

      output += `- **Methods**: ${methods.length}\n`;
      output += `- **Properties**: ${cls.propertyCount}\n\n`;

      if (methods.length > 0) {
        output += `### Methods\n\n`;

        for (const method of methods) {
          output += `#### ${method.name}\n`;
          output += '```' + file.language + '\n';
          output += method.signature + '\n';
          output += '```\n';
          output += `- **Line**: ${method.location.startLine}-${method.location.endLine}\n`;

          if (method.documentation?.description) {
            output += `- **Description**: ${method.documentation.description}\n`;
          }

          const modifiers: string[] = [];
          if (method.modifiers.isAsync) modifiers.push('async');
          if (method.modifiers.isStatic) modifiers.push('static');
          if (method.modifiers.isAbstract) modifiers.push('abstract');
          if (modifiers.length > 0) {
            output += `- *${modifiers.join(', ')}*\n`;
          }

          output += '\n';
        }
      }
    }
  }

  // Interfaces
  if (file.interfaces.length > 0) {
    output += `## Interfaces (${file.interfaces.length})\n\n`;

    for (const iface of file.interfaces) {
      output += `### ${iface.name}\n`;
      output += '```' + file.language + '\n';
      output += iface.signature + '\n';
      output += '```\n';
      output += `- **Line**: ${iface.location.startLine}-${iface.location.endLine}\n`;
      output += `- **Properties**: ${iface.properties.length}\n`;
      output += `- **Methods**: ${iface.methods.length}\n`;

      if (iface.documentation?.description) {
        output += `- **Description**: ${iface.documentation.description}\n`;
      }

      output += '\n';
    }
  }

  // Type aliases
  if (file.typeAliases.length > 0) {
    output += `## Type Aliases (${file.typeAliases.length})\n\n`;

    for (const typeAlias of file.typeAliases) {
      output += `### ${typeAlias.name}\n`;
      output += '```' + file.language + '\n';
      output += typeAlias.signature + '\n';
      output += '```\n';
      output += `- **Line**: ${typeAlias.location.startLine}-${typeAlias.location.endLine}\n`;

      if (typeAlias.documentation?.description) {
        output += `- **Description**: ${typeAlias.documentation.description}\n`;
      }

      output += '\n';
    }
  }

  if (input.includeSource) {
    output += await renderTopImplementationsSection(
      indexer,
      file,
      resolved.result.resolvedPath,
      Boolean(input.includePrivate)
    );
  }

  if (allFunctions.length === 0 && file.classes.length === 0 && file.interfaces.length === 0 && file.typeAliases.length === 0) {
    output += 'No functions, classes, interfaces, or type aliases found in this file.\n';
  }

  return {
    content: [
      {
        type: 'text',
        text: output,
      },
    ],
  };
}

interface SourceCandidate {
  id: string;
  name: string;
  lookupName: string;
  kind: 'function' | 'method' | 'callback';
  lineCount: number;
  startLine: number;
  endLine: number;
  complexityHint: number;
}

interface RankedSourceCandidate extends SourceCandidate {
  referenceCount: number;
  score: number;
}

interface SourceCandidateCollection {
  candidates: SourceCandidate[];
  strategy: 'exported' | 'top_level' | 'callbacks' | 'none';
}

async function renderTopImplementationsSection(
  indexer: Indexer,
  file: FileIndex,
  resolvedPath: string,
  includePrivate: boolean
): Promise<string> {
  let output = '## Top Implementations\n\n';

  const sourceCandidates = collectSourceCandidates(file, includePrivate);
  const candidates = sourceCandidates.candidates;
  if (candidates.length === 0) {
    output += 'No functions, methods, or callback candidates found for source inclusion.\n\n';
    output += maybeRenderSmallFileHint(file);
    return output;
  }

  if (sourceCandidates.strategy === 'top_level') {
    output += '> No exported functions or exported class methods found; using top-level functions instead.\n\n';
  } else if (sourceCandidates.strategy === 'callbacks') {
    output += '> No exported or top-level functions found; using callback implementations instead.\n\n';
  }

  const ranked = await rankSourceCandidates(indexer, file, candidates);
  const topCandidates = ranked.slice(0, MAX_TOP_IMPLEMENTATIONS);

  output += 'Ranked by call-graph reference count, then complexity (method count + line count).\n';
  output += `Source budget: ~${SOURCE_TOKEN_BUDGET} tokens (${SOURCE_CHAR_BUDGET.toLocaleString()} chars).\n\n`;

  let usedChars = 0;
  let includedCount = 0;
  let truncated = false;
  let fileLines: string[] | null = null;

  for (const candidate of topCandidates) {
    const source = await getCandidateSource(indexer, resolvedPath, candidate, fileLines);
    if (source.fileLines) {
      fileLines = source.fileLines;
    }
    if (!source.code) {
      continue;
    }

    const block = renderSourceBlock(candidate, source.code, file.language);
    const remainingBudget = SOURCE_CHAR_BUDGET - usedChars;

    if (block.length <= remainingBudget) {
      output += block;
      usedChars += block.length;
      includedCount++;
      continue;
    }

    const truncatedBlock = renderTruncatedSourceBlock(candidate, source.code, file.language, remainingBudget);
    if (truncatedBlock) {
      output += truncatedBlock;
      usedChars += truncatedBlock.length;
      includedCount++;
    }
    truncated = true;
    break;
  }

  const omittedCount = Math.max(0, topCandidates.length - includedCount);
  if (truncated || omittedCount > 0) {
    output += `> ⚠️ Source budget reached. Included ${includedCount} of ${topCandidates.length} ranked implementations.\n\n`;
  }

  if (includedCount === 0) {
    output += '> ⚠️ Could not extract source for the ranked implementations.\n\n';
  }

  output += maybeRenderSmallFileHint(file);
  return output;
}

function collectSourceCandidates(file: FileIndex, includePrivate: boolean): SourceCandidateCollection {
  const exportedCandidates: SourceCandidate[] = [];

  for (const func of file.functions) {
    if (func.kind === 'callback') continue;
    if ((func.nestingDepth ?? 0) > 0) continue;
    if (!func.modifiers.isExported) continue;

    exportedCandidates.push({
      id: func.id,
      name: func.name,
      lookupName: func.name,
      kind: 'function',
      lineCount: getLineCount(func),
      startLine: func.location.startLine,
      endLine: func.location.endLine,
      complexityHint: getLineCount(func),
    });
  }

  for (const cls of file.classes) {
    if (!cls.isExported) continue;

    const methods = includePrivate ? cls.methods : cls.methods.filter(method => !method.modifiers.isPrivate);
    for (const method of methods) {
      const lineCount = getLineCount(method);
      exportedCandidates.push({
        id: method.id,
        name: `${cls.name}.${method.localName}`,
        lookupName: method.localName,
        kind: 'method',
        lineCount,
        startLine: method.location.startLine,
        endLine: method.location.endLine,
        complexityHint: lineCount + cls.methodCount,
      });
    }
  }

  if (exportedCandidates.length > 0) {
    return {
      candidates: exportedCandidates,
      strategy: 'exported',
    };
  }

  const topLevelCandidates: SourceCandidate[] = [];
  for (const func of file.functions) {
    if (func.kind === 'callback') continue;
    if ((func.nestingDepth ?? 0) > 0) continue;
    if (!includePrivate && func.modifiers.isPrivate) continue;

    topLevelCandidates.push({
      id: func.id,
      name: func.name,
      lookupName: func.name,
      kind: 'function',
      lineCount: getLineCount(func),
      startLine: func.location.startLine,
      endLine: func.location.endLine,
      complexityHint: getLineCount(func),
    });
  }

  if (topLevelCandidates.length > 0) {
    return {
      candidates: topLevelCandidates,
      strategy: 'top_level',
    };
  }

  const callbackCandidates: SourceCandidate[] = [];
  for (const func of file.functions) {
    if (func.kind !== 'callback') continue;
    if (!isIncludeSourceCallback(func)) continue;

    const lineCount = getLineCount(func);
    const callbackContext = func.modifiers.callbackContext;
    callbackCandidates.push({
      id: func.id,
      name: callbackContext ? `${func.name} [${callbackContext}]` : func.name,
      lookupName: func.name,
      kind: 'callback',
      lineCount,
      startLine: func.location.startLine,
      endLine: func.location.endLine,
      complexityHint: lineCount,
    });
  }

  return {
    candidates: callbackCandidates,
    strategy: callbackCandidates.length > 0 ? 'callbacks' : 'none',
  };
}

function isIncludeSourceCallback(func: FunctionSignature): boolean {
  const callbackContext = func.modifiers.callbackContext;
  if (!callbackContext) {
    return false;
  }
  return !TEST_CALLBACK_CONTEXTS.has(callbackContext);
}

async function rankSourceCandidates(
  indexer: Indexer,
  file: FileIndex,
  candidates: SourceCandidate[]
): Promise<RankedSourceCandidate[]> {
  const localReferenceCounts = buildLocalReferenceCounts(file);
  const byNameReferenceCache = new Map<string, number>();

  const ranked = await Promise.all(
    candidates.map(async candidate => {
      const referenceCount = await getReferenceCount(
        indexer,
        candidate,
        localReferenceCounts,
        byNameReferenceCache
      );
      const score = scoreCandidate(candidate, referenceCount);

      return {
        ...candidate,
        referenceCount,
        score,
      };
    })
  );

  return ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.referenceCount !== a.referenceCount) return b.referenceCount - a.referenceCount;
    if (b.lineCount !== a.lineCount) return b.lineCount - a.lineCount;
    return a.name.localeCompare(b.name);
  });
}

function buildLocalReferenceCounts(file: FileIndex): Map<string, number> {
  const counts = new Map<string, number>();

  for (const call of file.calls) {
    const current = counts.get(call.calleeName) ?? 0;
    counts.set(call.calleeName, current + Math.max(call.callCount, 1));
  }

  return counts;
}

async function getReferenceCount(
  indexer: Indexer,
  candidate: SourceCandidate,
  localReferenceCounts: Map<string, number>,
  byNameReferenceCache: Map<string, number>
): Promise<number> {
  let exactCount = 0;

  try {
    const callers = await indexer.getCallers(candidate.id);
    exactCount = callers.reduce((sum, edge) => sum + Math.max(edge.callCount, 1), 0);
  } catch {
    exactCount = 0;
  }

  if (exactCount > 0) {
    return exactCount;
  }

  if (byNameReferenceCache.has(candidate.lookupName)) {
    return byNameReferenceCache.get(candidate.lookupName) ?? 0;
  }

  let byNameCount = 0;
  try {
    const callers = await indexer.getCallersByName(candidate.lookupName);
    byNameCount = callers.reduce((sum, edge) => sum + Math.max(edge.callCount, 1), 0);
  } catch {
    byNameCount = 0;
  }

  const localCount = localReferenceCounts.get(candidate.lookupName) ?? 0;
  const resolvedCount = Math.max(byNameCount, localCount);
  byNameReferenceCache.set(candidate.lookupName, resolvedCount);
  return resolvedCount;
}

function scoreCandidate(candidate: SourceCandidate, referenceCount: number): number {
  const referenceWeight = referenceCount * 100;
  const complexityWeight = Math.min(candidate.complexityHint, 500);
  const lineWeight = Math.min(candidate.lineCount, 200);
  const kindWeight = candidate.kind === 'method' ? 5 : 0;
  return referenceWeight + complexityWeight + lineWeight + kindWeight;
}

async function getCandidateSource(
  indexer: Indexer,
  resolvedPath: string,
  candidate: SourceCandidate,
  fileLines: string[] | null
): Promise<{ code: string | null; fileLines: string[] | null }> {
  let code: string | null = null;
  try {
    code = await indexer.getFunctionSource(resolvedPath, candidate.lookupName);
  } catch {
    code = null;
  }

  if (code) {
    return { code: code.trimEnd(), fileLines };
  }

  let cachedLines = fileLines;
  if (!cachedLines) {
    cachedLines = await readFileLines(resolvedPath);
  }
  if (!cachedLines) {
    return { code: null, fileLines: cachedLines };
  }

  return {
    code: extractSourceFromLines(cachedLines, candidate.startLine, candidate.endLine),
    fileLines: cachedLines,
  };
}

async function readFileLines(filePath: string): Promise<string[] | null> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return content.split('\n');
  } catch {
    return null;
  }
}

function extractSourceFromLines(lines: string[], startLine: number, endLine: number): string | null {
  if (lines.length === 0) return null;

  const safeStart = Math.max(1, startLine);
  const safeEnd = Math.max(safeStart, Math.min(endLine, lines.length));
  if (safeStart > lines.length) {
    return null;
  }

  return lines.slice(safeStart - 1, safeEnd).join('\n').trimEnd();
}

function renderSourceBlock(candidate: RankedSourceCandidate, source: string, language: Language): string {
  let output = `### ${candidate.name}\n`;
  output += `- **Kind**: ${candidate.kind}\n`;
  output += `- **Lines**: ${candidate.startLine}-${candidate.endLine}\n`;
  output += `- **Reference Count**: ${candidate.referenceCount}\n\n`;
  output += '```' + language + '\n';
  output += source + '\n';
  output += '```\n\n';
  return output;
}

function renderTruncatedSourceBlock(
  candidate: RankedSourceCandidate,
  source: string,
  language: Language,
  remainingBudget: number
): string | null {
  const header =
    `### ${candidate.name}\n` +
    `- **Kind**: ${candidate.kind}\n` +
    `- **Lines**: ${candidate.startLine}-${candidate.endLine}\n` +
    `- **Reference Count**: ${candidate.referenceCount}\n` +
    '- **Note**: Truncated to fit source budget\n\n' +
    '```' + language + '\n';
  const footer = '```\n\n';
  const truncationMarker = getTruncationMarker(language);
  const reserved = header.length + footer.length + truncationMarker.length;

  if (remainingBudget <= reserved + MIN_SOURCE_PREVIEW_CHARS) {
    return null;
  }

  const allowedSourceChars = remainingBudget - reserved;
  const sourcePrefix = source.slice(0, allowedSourceChars).trimEnd();
  if (sourcePrefix.length < MIN_SOURCE_PREVIEW_CHARS) {
    return null;
  }

  return header + sourcePrefix + '\n' + truncationMarker + '\n' + footer;
}

function getTruncationMarker(language: Language): string {
  if (language === 'python') {
    return '# ... [truncated due source budget]';
  }
  return '// ... [truncated due source budget]';
}

function maybeRenderSmallFileHint(file: FileIndex): string {
  if (file.lineCount <= 0 || file.lineCount >= SMALL_FILE_READ_HINT_LINE_LIMIT) {
    return '';
  }

  return `> Tip: This file is only ${file.lineCount} lines. A direct \`Read()\` is often cheaper and faster than expanded tool output.\n\n`;
}

function getLineCount(func: FunctionSignature): number {
  return Math.max(1, func.location.endLine - func.location.startLine + 1);
}

function renderCompactFunctionsOutput(
  file: FileIndex,
  regularFunctions: FunctionSignature[],
  nestedByParent: Map<string, FunctionSignature[]>,
  testCallbacks: FunctionSignature[],
  eventCallbacks: FunctionSignature[],
  otherCallbacks: FunctionSignature[],
  includePrivate: boolean
): string {
  const sections: string[] = [
    `[FILE] ${file.relativePath} (${file.language}, ${file.lineCount} lines)`,
  ];

  const rows: Array<Record<string, string | number>> = [];
  const topLevelSorted = [...regularFunctions].sort((a, b) => a.location.startLine - b.location.startLine);
  for (const func of topLevelSorted) {
    rows.push(compactRow(func.name, func.kind, func.location.startLine, func.location.endLine, func.modifiers.isExported, func.modifiers.isAsync, func.signature));

    const nested = [...(nestedByParent.get(func.name) ?? [])]
      .sort((a, b) => a.location.startLine - b.location.startLine);
    for (const nestedFunc of nested) {
      rows.push(compactRow(`  ${nestedFunc.name}`, nestedFunc.kind, nestedFunc.location.startLine, nestedFunc.location.endLine, nestedFunc.modifiers.isExported, nestedFunc.modifiers.isAsync, nestedFunc.signature));
    }
  }

  const classRows: Array<Record<string, string | number>> = [];
  for (const cls of file.classes) {
    classRows.push(compactRow(
      cls.name,
      'class',
      cls.location.startLine,
      cls.location.endLine,
      cls.isExported,
      false,
      cls.signature || `class ${cls.name}`
    ));

    const methods = includePrivate
      ? cls.methods
      : cls.methods.filter(method => !method.modifiers.isPrivate);
    for (const method of methods) {
      classRows.push(compactRow(
        `${cls.name}.${method.localName}`,
        'method',
        method.location.startLine,
        method.location.endLine,
        method.modifiers.isExported || cls.isExported,
        method.modifiers.isAsync,
        method.signature
      ));
    }
  }

  for (const iface of file.interfaces) {
    classRows.push(compactRow(
      iface.name,
      'interface',
      iface.location.startLine,
      iface.location.endLine,
      iface.isExported,
      false,
      iface.signature || `interface ${iface.name}`
    ));
  }

  for (const typeAlias of file.typeAliases) {
    classRows.push(compactRow(
      typeAlias.name,
      'type',
      typeAlias.location.startLine,
      typeAlias.location.endLine,
      typeAlias.isExported,
      false,
      typeAlias.signature || `type ${typeAlias.name}`
    ));
  }

  const allRows = [...rows, ...classRows];
  sections.push(formatCompactTable(allRows, {
    columns: ['name', 'kind', 'line', 'exported', 'async', 'signature'],
  }));

  const callbacks = [...testCallbacks, ...eventCallbacks, ...otherCallbacks]
    .sort((a, b) => a.location.startLine - b.location.startLine);
  if (callbacks.length > 0) {
    const callbackRows = callbacks.map(callback => compactRow(
      callback.modifiers.callbackContext
        ? `${callback.name} [${callback.modifiers.callbackContext}]`
        : callback.name,
      'callback',
      callback.location.startLine,
      callback.location.endLine,
      callback.modifiers.isExported,
      callback.modifiers.isAsync,
      callback.signature
    ));
    sections.push('[CALLBACKS]');
    sections.push(formatCompactTable(callbackRows, {
      columns: ['name', 'kind', 'line', 'exported', 'async', 'signature'],
    }));
  }

  return sections.join('\n\n');
}

function compactRow(
  name: string,
  kind: string,
  startLine: number,
  endLine: number,
  isExported: boolean,
  isAsync: boolean,
  signature: string
): Record<string, string | number> {
  return {
    name,
    kind,
    line: `${startLine}-${endLine}`,
    exported: isExported ? 'Y' : 'N',
    async: isAsync ? 'Y' : 'N',
    signature: signature.replace(/\s+/g, ' ').trim(),
  };
}

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
