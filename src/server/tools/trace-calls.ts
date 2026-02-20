/**
 * trace_calls tool implementation
 * Find callers, callees, or both for a function.
 */

import path from 'node:path';
import type { Indexer } from '../../indexer/index.js';
import type { CallGraphEdge } from '../../types/symbols.js';
import { enforceOutputBudget, formatCompactTable } from './compact-format.js';

export type TraceCallDirection = 'callers' | 'callees' | 'both';
type OutputMode = 'compact' | 'markdown';

export interface TraceCallsInput {
  functionName: string;
  direction?: TraceCallDirection;
  filePath?: string;
  depth?: number;
  format?: OutputMode;
  compact?: boolean; // Backward compatibility
}

type ToolResponse = { content: Array<{ type: 'text'; text: string }> };

const MIN_DEPTH = 1;
const MAX_DEPTH = 3;
const DEFAULT_MAX_BYTES = 3000;

interface CompactCallRow {
  name: string;
  file: string;
  calls: number;
  async: 'Y' | 'N';
  conditional: 'Y' | 'N';
  [key: string]: string | number;
}

function normalizeDepth(depth?: number): number {
  if (typeof depth !== 'number' || !Number.isFinite(depth)) {
    return MIN_DEPTH;
  }

  return Math.max(MIN_DEPTH, Math.min(MAX_DEPTH, Math.trunc(depth)));
}

function normalizeOutputMode(input: TraceCallsInput): OutputMode {
  if (input.format === 'compact' || input.format === 'markdown') {
    return input.format;
  }

  if (input.compact === true) {
    return 'compact';
  }

  return 'compact';
}

async function getCallersWithFallback(
  indexer: Indexer,
  functionName: string
): Promise<{ callers: CallGraphEdge[]; usedFallback: boolean }> {
  const storage = indexer.getStorage();

  let callers = await indexer.getCallersByName(functionName);
  let usedFallback = false;

  // Fallback when call graph is sparse: infer callers from call references.
  if (callers.length === 0) {
    const refs = await storage.getReferencesByName(functionName);
    const callRefs = refs.filter((ref) => ref.referenceKind === 'call');

    if (callRefs.length > 0) {
      usedFallback = true;
      const seenCallers = new Set<string>();
      callers = callRefs
        .filter((ref) => {
          if (!ref.referencingSymbolName || seenCallers.has(ref.referencingSymbolName)) {
            return false;
          }
          seenCallers.add(ref.referencingSymbolName);
          return true;
        })
        .map((ref) => ({
          id: ref.id,
          callerSymbolId: ref.referencingSymbolId ?? '',
          callerName: ref.referencingSymbolName ?? `(anonymous in ${ref.referencingFile})`,
          calleeName: functionName,
          callCount: 1,
          isAsync: false,
          isConditional: false,
        }));
    }
  }

  return { callers, usedFallback };
}

async function getCallerReport(
  indexer: Indexer,
  functionName: string,
  depth: number,
  compact: boolean,
  includeHeading: boolean
): Promise<string> {
  const storage = indexer.getStorage();

  const { callers, usedFallback } = await getCallersWithFallback(indexer, functionName);

  if (callers.length === 0) {
    let diagnostics = `No callers found for \`${functionName}\`.\n\n`;

    const searchResults = await storage.searchSymbols(functionName, { limit: 5 });
    const exactMatches = searchResults.filter((result) => result.symbol.name === functionName);

    if (exactMatches.length === 0) {
      diagnostics += '**Possible issues:**\n';
      diagnostics += `- Symbol "${functionName}" not found in index\n`;
      diagnostics += '- Check spelling or try `search_symbols` to find similar names\n';

      if (searchResults.length > 0) {
        diagnostics += '\n**Did you mean:**\n';
        for (const result of searchResults.slice(0, 3)) {
          diagnostics += `- \`${result.symbol.name}\`\n`;
        }
      }
    } else {
      const refs = await storage.getReferencesByName(functionName);
      diagnostics += '**Diagnostics:**\n';
      diagnostics += '- Symbol exists in index: ✓\n';
      diagnostics += `- Total references found: ${refs.length}\n`;
      diagnostics += `- Call references: ${refs.filter((ref) => ref.referenceKind === 'call').length}\n`;
      diagnostics += '- Call graph entries: 0\n';
      diagnostics += '\n**Tip**: Try `find_references` for more detailed usage information.\n';
    }

    return diagnostics;
  }

  const sortedCallers = [...callers].sort((a, b) => a.callerName.localeCompare(b.callerName));
  let output = '';

  if (includeHeading) {
    output += `# Callers of "${functionName}"\n\n`;
  }

  output += `Found ${callers.length} caller(s)`;
  if (usedFallback) {
    output += ' *(via symbol references)*';
  }
  output += '\n\n';

  if (compact) {
    for (const caller of sortedCallers) {
      const flags = [];
      if (caller.callCount > 1) flags.push(`${caller.callCount}x`);
      if (caller.isAsync) flags.push('async');
      if (caller.isConditional) flags.push('conditional');
      const flagStr = flags.length > 0 ? ` (${flags.join(', ')})` : '';
      output += `- ${caller.callerName}${flagStr}\n`;
    }
  } else {
    output += '| Caller | Call Count | Async | Conditional |\n';
    output += '|--------|------------|-------|-------------|\n';

    for (const caller of sortedCallers) {
      const asyncStr = caller.isAsync ? 'Yes' : 'No';
      const conditionalStr = caller.isConditional ? 'Yes' : 'No';
      output += `| \`${caller.callerName}\` | ${caller.callCount} | ${asyncStr} | ${conditionalStr} |\n`;
    }
  }

  output += '\n';

  if (depth > 1) {
    output += `## Indirect Callers (depth ${depth})\n\n`;

    const visited = new Set<string>([functionName]);
    let currentLevel = sortedCallers.map((caller) => caller.callerName);

    for (let level = 2; level <= depth && currentLevel.length > 0; level += 1) {
      const nextLevel: string[] = [];
      output += `### Depth ${level}\n\n`;

      for (const callerName of currentLevel) {
        if (visited.has(callerName)) {
          continue;
        }

        visited.add(callerName);
        const indirectCallers = await indexer.getCallersByName(callerName);

        if (indirectCallers.length > 0) {
          output += `**${callerName}** is called by:\n`;
          for (const indirectCaller of indirectCallers) {
            output += `- \`${indirectCaller.callerName}\`\n`;
            if (!visited.has(indirectCaller.callerName)) {
              nextLevel.push(indirectCaller.callerName);
            }
          }
          output += '\n';
        }
      }

      currentLevel = nextLevel;
    }
  }

  if (callers.length < 3) {
    output += '---\n';
    output += `Use \`trace_calls\` with \`direction: "callees"\` to see what functions "${functionName}" calls.\n`;
  }

  return output.trim();
}

function sortByCalleeName(callees: CallGraphEdge[]): CallGraphEdge[] {
  return [...callees].sort((a, b) => a.calleeName.localeCompare(b.calleeName));
}

async function getCalleeReport(
  indexer: Indexer,
  functionName: string,
  depth: number,
  compact: boolean,
  includeHeading: boolean
): Promise<string> {
  const callees = await indexer.getCalleesByName(functionName);

  if (callees.length === 0) {
    return `No callees found for \`${functionName}\`. Function may not call others or run \`resolve\` command.`;
  }

  const sortedCallees = sortByCalleeName(callees);
  let output = '';

  if (includeHeading) {
    output += `# Functions called by "${functionName}"\n\n`;
  }

  output += `Found ${callees.length} callee(s)\n\n`;

  if (compact) {
    for (const callee of sortedCallees) {
      const flags = [];
      if (callee.callCount > 1) flags.push(`${callee.callCount}x`);
      if (callee.isAsync) flags.push('async');
      if (callee.isConditional) flags.push('conditional');
      const flagStr = flags.length > 0 ? ` (${flags.join(', ')})` : '';
      output += `- ${callee.calleeName}${flagStr}\n`;
    }
  } else {
    output += '| Function Called | Times | Async | Conditional |\n';
    output += '|-----------------|-------|-------|-------------|\n';

    for (const callee of sortedCallees) {
      const asyncStr = callee.isAsync ? 'Yes' : 'No';
      const conditionalStr = callee.isConditional ? 'Yes' : 'No';
      output += `| \`${callee.calleeName}\` | ${callee.callCount} | ${asyncStr} | ${conditionalStr} |\n`;
    }
  }

  output += '\n';

  if (depth > 1) {
    output += `## Transitive Callees (depth ${depth})\n\n`;

    const visited = new Set<string>([functionName]);
    let currentLevel = sortedCallees.map((callee) => callee.calleeName);

    for (let level = 2; level <= depth && currentLevel.length > 0; level += 1) {
      const nextLevel: string[] = [];
      output += `### Depth ${level}\n\n`;

      for (const calleeName of currentLevel) {
        if (visited.has(calleeName)) {
          continue;
        }

        visited.add(calleeName);
        const transitiveCallees = await indexer.getCalleesByName(calleeName);

        if (transitiveCallees.length > 0) {
          output += `**${calleeName}** calls:\n`;
          for (const transitiveCallee of transitiveCallees) {
            output += `- \`${transitiveCallee.calleeName}\`\n`;
            if (!visited.has(transitiveCallee.calleeName)) {
              nextLevel.push(transitiveCallee.calleeName);
            }
          }
          output += '\n';
        }
      }

      currentLevel = nextLevel;
    }
  }

  if (callees.length < 3) {
    output += '---\n';
    output += `Use \`trace_calls\` with \`direction: "callers"\` to see what functions call "${functionName}".\n`;
  }

  return output.trim();
}

function normalizeDisplayPath(filePath: string, rootDir: string): string {
  if (!filePath) return '';

  const normalizedFile = filePath.replace(/\\/g, '/');
  const normalizedRoot = rootDir.replace(/\\/g, '/');
  if (!normalizedRoot) return normalizedFile;

  if (normalizedFile === normalizedRoot) {
    return path.basename(normalizedFile);
  }
  if (normalizedFile.startsWith(`${normalizedRoot}/`)) {
    return normalizedFile.slice(normalizedRoot.length + 1);
  }

  return normalizedFile;
}

async function resolveSymbolFile(
  indexer: Indexer,
  symbolId: string | undefined,
  symbolName: string,
  cache: Map<string, string>
): Promise<string> {
  const cacheKey = symbolId ? `id:${symbolId}` : `name:${symbolName}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const maybeRootDir = (indexer as { getRootDir?: () => string }).getRootDir;
  const rootDir = typeof maybeRootDir === 'function' ? maybeRootDir.call(indexer) : '';

  let resolved = '';
  const storage = indexer.getStorage() as {
    getSymbolById?: (symbolId: string) => Promise<{ filePath: string } | null>;
  };

  if (symbolId && typeof storage.getSymbolById === 'function') {
    try {
      const symbol = await storage.getSymbolById(symbolId);
      if (symbol?.filePath) {
        resolved = normalizeDisplayPath(symbol.filePath, rootDir);
      }
    } catch {
      resolved = '';
    }
  }

  if (!resolved) {
    try {
      const matches = await indexer.searchSymbols(symbolName, { type: 'function', limit: 5 });
      const exact = matches.find((match) => match.symbol.name === symbolName) ?? matches[0];
      if (exact?.symbol?.filePath) {
        resolved = normalizeDisplayPath(exact.symbol.filePath, rootDir);
      }
    } catch {
      resolved = '';
    }
  }

  cache.set(cacheKey, resolved);
  return resolved;
}

function formatCompactCallRows(rows: CompactCallRow[]): string {
  return formatCompactTable(rows, {
    columns: ['name', 'file', 'calls', 'async', 'conditional'],
  });
}

function createCompactCallRow(
  name: string,
  file: string,
  calls: number,
  isAsync: boolean,
  isConditional: boolean
): CompactCallRow {
  return {
    name,
    file,
    calls,
    async: isAsync ? 'Y' : 'N',
    conditional: isConditional ? 'Y' : 'N',
  };
}

async function collectCallerRowsByDepth(
  indexer: Indexer,
  functionName: string,
  depth: number
): Promise<Map<number, CompactCallRow[]>> {
  const rowsByDepth = new Map<number, CompactCallRow[]>();
  const fileCache = new Map<string, string>();

  const { callers } = await getCallersWithFallback(indexer, functionName);
  const depthOneRows = await Promise.all(
    callers.map(async (caller) =>
      createCompactCallRow(
        caller.callerName,
        await resolveSymbolFile(indexer, caller.callerSymbolId, caller.callerName, fileCache),
        Math.max(1, caller.callCount),
        caller.isAsync,
        caller.isConditional
      )
    )
  );
  rowsByDepth.set(1, depthOneRows.sort((a, b) => a.name.localeCompare(b.name)));

  if (depth <= 1) {
    return rowsByDepth;
  }

  const visited = new Set<string>([functionName]);
  let currentLevelNames = depthOneRows.map((row) => row.name);

  for (let level = 2; level <= depth && currentLevelNames.length > 0; level += 1) {
    const nextLevel: string[] = [];
    const levelRows: CompactCallRow[] = [];
    const seenRows = new Set<string>();

    for (const callerName of currentLevelNames) {
      if (visited.has(callerName)) {
        continue;
      }
      visited.add(callerName);

      const indirectCallers = await indexer.getCallersByName(callerName);
      for (const edge of indirectCallers) {
        const key = `${edge.callerName}:${edge.callerSymbolId ?? ''}:${edge.callCount}:${edge.isAsync}:${edge.isConditional}`;
        if (seenRows.has(key)) {
          continue;
        }
        seenRows.add(key);

        levelRows.push(createCompactCallRow(
          edge.callerName,
          await resolveSymbolFile(indexer, edge.callerSymbolId, edge.callerName, fileCache),
          Math.max(1, edge.callCount),
          edge.isAsync,
          edge.isConditional
        ));

        if (!visited.has(edge.callerName)) {
          nextLevel.push(edge.callerName);
        }
      }
    }

    rowsByDepth.set(level, levelRows.sort((a, b) => a.name.localeCompare(b.name)));
    currentLevelNames = nextLevel;
  }

  return rowsByDepth;
}

async function collectCalleeRowsByDepth(
  indexer: Indexer,
  functionName: string,
  depth: number
): Promise<Map<number, CompactCallRow[]>> {
  const rowsByDepth = new Map<number, CompactCallRow[]>();
  const fileCache = new Map<string, string>();

  const callees = await indexer.getCalleesByName(functionName);
  const depthOneRows = await Promise.all(
    callees.map(async (callee) =>
      createCompactCallRow(
        callee.calleeName,
        await resolveSymbolFile(indexer, callee.calleeSymbolId, callee.calleeName, fileCache),
        Math.max(1, callee.callCount),
        callee.isAsync,
        callee.isConditional
      )
    )
  );
  rowsByDepth.set(1, depthOneRows.sort((a, b) => a.name.localeCompare(b.name)));

  if (depth <= 1) {
    return rowsByDepth;
  }

  const visited = new Set<string>([functionName]);
  let currentLevelNames = depthOneRows.map((row) => row.name);

  for (let level = 2; level <= depth && currentLevelNames.length > 0; level += 1) {
    const nextLevel: string[] = [];
    const levelRows: CompactCallRow[] = [];
    const seenRows = new Set<string>();

    for (const calleeName of currentLevelNames) {
      if (visited.has(calleeName)) {
        continue;
      }
      visited.add(calleeName);

      const transitiveCallees = await indexer.getCalleesByName(calleeName);
      for (const edge of transitiveCallees) {
        const key = `${edge.calleeName}:${edge.calleeSymbolId ?? ''}:${edge.callCount}:${edge.isAsync}:${edge.isConditional}`;
        if (seenRows.has(key)) {
          continue;
        }
        seenRows.add(key);

        levelRows.push(createCompactCallRow(
          edge.calleeName,
          await resolveSymbolFile(indexer, edge.calleeSymbolId, edge.calleeName, fileCache),
          Math.max(1, edge.callCount),
          edge.isAsync,
          edge.isConditional
        ));

        if (!visited.has(edge.calleeName)) {
          nextLevel.push(edge.calleeName);
        }
      }
    }

    rowsByDepth.set(level, levelRows.sort((a, b) => a.name.localeCompare(b.name)));
    currentLevelNames = nextLevel;
  }

  return rowsByDepth;
}

function renderCompactSections(
  label: 'CALLERS' | 'CALLEES',
  functionName: string,
  rowsByDepth: Map<number, CompactCallRow[]>
): string[] {
  const sections: string[] = [];

  const depthOne = rowsByDepth.get(1) ?? [];
  sections.push(`[${label} of ${functionName}]`);
  sections.push(formatCompactCallRows(depthOne));

  const additionalDepths = [...rowsByDepth.keys()]
    .filter((level) => level > 1)
    .sort((a, b) => a - b);
  for (const level of additionalDepths) {
    sections.push(`[${label} depth=${level}]`);
    sections.push(formatCompactCallRows(rowsByDepth.get(level) ?? []));
  }

  return sections;
}

export async function traceCallsTool(indexer: Indexer, input: TraceCallsInput): Promise<ToolResponse> {
  const functionName = input.functionName.trim();
  if (!functionName) {
    return {
      content: [{
        type: 'text',
        text: 'Invalid function_name. Provide a non-empty function or method name.',
      }],
    };
  }

  const direction = input.direction ?? 'both';
  const depth = normalizeDepth(input.depth);
  const outputMode = normalizeOutputMode(input);

  // Kept for API compatibility; trace currently resolves by symbol name.
  void input.filePath;

  if (direction !== 'callers' && direction !== 'callees' && direction !== 'both') {
    return {
      content: [{
        type: 'text',
        text: `Invalid direction "${String(direction)}". Use "callers", "callees", or "both".`,
      }],
    };
  }

  if (outputMode === 'compact') {
    if (direction === 'callers') {
      const rowsByDepth = await collectCallerRowsByDepth(indexer, functionName, depth);
      const output = enforceOutputBudget(
        renderCompactSections('CALLERS', functionName, rowsByDepth).join('\n\n'),
        DEFAULT_MAX_BYTES
      );
      return {
        content: [{ type: 'text', text: output }],
      };
    }

    if (direction === 'callees') {
      const rowsByDepth = await collectCalleeRowsByDepth(indexer, functionName, depth);
      const output = enforceOutputBudget(
        renderCompactSections('CALLEES', functionName, rowsByDepth).join('\n\n'),
        DEFAULT_MAX_BYTES
      );
      return {
        content: [{ type: 'text', text: output }],
      };
    }

    const [callerRowsByDepth, calleeRowsByDepth] = await Promise.all([
      collectCallerRowsByDepth(indexer, functionName, depth),
      collectCalleeRowsByDepth(indexer, functionName, depth),
    ]);
    const output = enforceOutputBudget(
      [
        ...renderCompactSections('CALLERS', functionName, callerRowsByDepth),
        ...renderCompactSections('CALLEES', functionName, calleeRowsByDepth),
      ].join('\n\n'),
      DEFAULT_MAX_BYTES
    );

    return {
      content: [{ type: 'text', text: output }],
    };
  }

  if (direction === 'callers') {
    return {
      content: [{
        type: 'text',
        text: await getCallerReport(indexer, functionName, depth, false, true),
      }],
    };
  }

  if (direction === 'callees') {
    return {
      content: [{
        type: 'text',
        text: await getCalleeReport(indexer, functionName, depth, false, true),
      }],
    };
  }

  const [callersSection, calleesSection] = await Promise.all([
    getCallerReport(indexer, functionName, depth, false, false),
    getCalleeReport(indexer, functionName, depth, false, false),
  ]);

  const output = [
    `# Call Trace for "${functionName}"`,
    '',
    `Depth: ${depth}`,
    '',
    '## Callers',
    '',
    callersSection,
    '',
    '## Callees',
    '',
    calleesSection,
  ].join('\n');

  return {
    content: [{
      type: 'text',
      text: output,
    }],
  };
}
