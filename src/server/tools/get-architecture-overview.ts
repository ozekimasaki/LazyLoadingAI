/**
 * get_architecture_overview tool implementation
 * Structured architecture map with module narratives, dependencies, entry points, and public API.
 */

import path from 'node:path';
import type { Indexer } from '../../indexer/index.js';
import type { SqliteStorage } from '../../indexer/storage/index.js';
import type {
  FileIndex,
  ClassSignature,
  FunctionSignature,
  InterfaceSignature,
  TypeAliasSignature,
  VariableSignature,
} from '../../types/index.js';
import { enforceOutputBudget, formatCompactTable } from './compact-format.js';

type ArchitectureFocus =
  | 'full'
  | 'modules'
  | 'entry_points'
  | 'dependencies'
  | 'public_api'
  | 'patterns'
  | 'core_classes';

type ExportKind = 'class' | 'function' | 'interface' | 'type' | 'variable';
type EntryPointType = 'cli' | 'library' | 'main' | 'bin';

const DESCRIPTION_STOP_WORDS = new Set([
  'a', 'an', 'and', 'api', 'as', 'at', 'base', 'build', 'by', 'create', 'default', 'for', 'from',
  'get', 'has', 'in', 'is', 'it', 'list', 'load', 'main', 'make', 'module', 'of', 'on', 'or', 'set',
  'start', 'stop', 'the', 'to', 'update', 'use', 'utils', 'util', 'with',
]);

const MODULE_HINTS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /(^|\/)indexer(\/|$)/i, description: 'Core indexing and symbol extraction engine.' },
  { pattern: /(^|\/)server(\/|$)/i, description: 'Server runtime and MCP tool orchestration layer.' },
  { pattern: /(^|\/)markov(\/|$)/i, description: 'Probabilistic relationship and suggestion engine.' },
  { pattern: /(^|\/)synonyms(\/|$)/i, description: 'Query expansion and result ranking utilities.' },
  { pattern: /(^|\/)parsers?(\/|$)/i, description: 'Language parsing and signature extraction layer.' },
  { pattern: /(^|\/)storage(\/|$)/i, description: 'Persistence and storage access infrastructure.' },
  { pattern: /(^|\/)(cli|bin)(\/|$)/i, description: 'Command-line entry points and command handlers.' },
  { pattern: /(^|\/)config(\/|$)/i, description: 'Configuration parsing and normalization helpers.' },
  { pattern: /(^|\/)templates?(\/|$)/i, description: 'Template and generated-document utilities.' },
  { pattern: /(^|\/)types?(\/|$)/i, description: 'Shared type contracts used across modules.' },
  { pattern: /(^|\/)watcher(\/|$)/i, description: 'File watching and incremental sync utilities.' },
];

const DEFAULT_MAX_BYTES = 6000;
const FULL_FOCUS_MAX_BYTES = 8000;

export interface GetArchitectureOverviewInput {
  focus?: ArchitectureFocus;
  max_depth?: number;
  entry_file?: string;
  include_types?: boolean;
  group_by?: 'kind' | 'file';
  format?: 'compact' | 'markdown';
}

interface ModuleExport {
  name: string;
  kind: ExportKind;
  file: string;
  line?: number;
  signature: string;
  referenceCount: number;
  methodCount: number;
  propertyCount: number;
}

interface ModuleInfo {
  name: string;
  fileCount: number;
  lineCount: number;
  exports: ModuleExport[];
  topExports: ModuleExport[];
  narrative: string | null;
  groupedExports: Map<ExportKind, ModuleExport[]>;
}

interface ModuleDependencyEdge {
  fromModule: string;
  toModule: string;
  symbols: Set<string>;
  typeOnlyCount: number;
  valueCount: number;
}

interface EntryPoint {
  type: EntryPointType;
  file: FileIndex;
  source: string;
}

interface EntryPointDetection {
  entries: EntryPoint[];
  apiFiles: FileIndex[];
  source: string;
}

interface ApiSymbolBase {
  kind: ExportKind;
  name: string;
  file: string;
  line?: number;
  signature: string;
}

interface ApiClassSymbol extends ApiSymbolBase {
  kind: 'class';
  methodCount: number;
  extendsType?: string;
  implementsTypes: string[];
}

interface ApiFunctionSymbol extends ApiSymbolBase {
  kind: 'function';
  isAsync: boolean;
  returnType?: string;
}

interface ApiInterfaceSymbol extends ApiSymbolBase {
  kind: 'interface';
  propertyCount: number;
  methodCount: number;
}

interface ApiTypeSymbol extends ApiSymbolBase {
  kind: 'type';
}

interface ApiVariableSymbol extends ApiSymbolBase {
  kind: 'variable';
  variableKind: string;
}

type ApiSymbol =
  | ApiClassSymbol
  | ApiFunctionSymbol
  | ApiInterfaceSymbol
  | ApiTypeSymbol
  | ApiVariableSymbol;

interface PublicApiCollection {
  symbols: ApiSymbol[];
  filesUsed: string[];
  unresolvedReExports: string[];
}

interface StorageConfigFile {
  filePath: string;
  relativePath: string;
  format: string;
  configType: string;
  entryCount: number;
}

interface StorageConfigValue {
  path: string;
  value: string;
  rawValue: unknown;
  valueType: string;
  filePath: string;
  format: string;
  configType: string;
  description: string | null;
  lineNumber: number;
}

interface StorageImportSpecifier {
  name: string;
  alias?: string;
  isDefault: boolean;
  isNamespace: boolean;
}

interface StorageFileImport {
  source: string;
  resolvedPath: string | null;
  isExternal: boolean;
  isTypeOnly: boolean;
  isReExport: boolean;
  specifiers: StorageImportSpecifier[];
}

interface StorageFileExport {
  name: string;
  isDefault: boolean;
  isReExport: boolean;
  reExportSource: string | null;
  resolvedReExportPath: string | null;
}

export async function getArchitectureOverviewTool(
  indexer: Indexer,
  input: GetArchitectureOverviewInput
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const storage = indexer.getStorage();
  const allFiles = await storage.listFiles({});

  if (allFiles.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'No indexed files found. Run `lazy-load index <directory>` to index your codebase.',
        },
      ],
    };
  }

  const sourceFiles = allFiles.filter(
    f => f.language !== 'config' && !isExcludedArchitecturePath(f.relativePath)
  );
  if (sourceFiles.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'Only configuration files are indexed. Add source files and re-run `lazy-load index`.',
        },
      ],
    };
  }

  const focus = normalizeFocus(input.focus);
  const includeTypes = input.include_types ?? true;
  const groupBy = input.group_by ?? 'kind';
  const outputMode = input.format ?? 'compact';

  const modules = buildModules(sourceFiles);
  const dependencyEdges = await buildModuleDependencies(storage, sourceFiles);
  const entryPoints = await detectEntryPoints(storage, sourceFiles, input.entry_file);
  const apiCollection = await collectPublicApi(storage, sourceFiles, entryPoints.apiFiles, includeTypes);
  const patterns = detectPatterns(sourceFiles);

  if (outputMode === 'compact') {
    const maxBytes = focus === 'full' ? FULL_FOCUS_MAX_BYTES : DEFAULT_MAX_BYTES;
    const compactOutput = await renderCompactArchitectureOverview(
      storage,
      focus,
      modules,
      dependencyEdges,
      entryPoints.entries,
      apiCollection,
      patterns,
      includeTypes
    );
    return {
      content: [
        {
          type: 'text',
          text: enforceOutputBudget(compactOutput, maxBytes),
        },
      ],
    };
  }

  const sections: string[] = ['# Architecture Overview'];

  if (focus === 'full' || focus === 'modules') {
    sections.push(renderModules(modules));
  }

  if (focus === 'full' || focus === 'dependencies') {
    sections.push(renderModuleDependencies(dependencyEdges));
  }

  if (focus === 'full' || focus === 'entry_points') {
    sections.push(await renderEntryPoints(storage, entryPoints.entries, includeTypes));
  }

  if (focus === 'full' || focus === 'public_api' || focus === 'entry_points') {
    sections.push(renderPublicApi(apiCollection, groupBy, includeTypes, entryPoints.source));
  }

  if (focus === 'full' || focus === 'patterns') {
    sections.push(renderPatterns(patterns));
  }

  return {
    content: [
      {
        type: 'text',
        text: sections.filter(Boolean).join('\n\n').trim(),
      },
    ],
  };
}

function normalizeFocus(focus: ArchitectureFocus | undefined): Exclude<ArchitectureFocus, 'core_classes'> {
  if (!focus) {
    return 'modules';
  }
  if (focus === 'core_classes') {
    return 'modules';
  }
  return focus;
}

async function renderCompactArchitectureOverview(
  storage: SqliteStorage,
  focus: Exclude<ArchitectureFocus, 'core_classes'>,
  modules: ModuleInfo[],
  dependencyEdges: ModuleDependencyEdge[],
  entryPoints: EntryPoint[],
  apiCollection: PublicApiCollection,
  patterns: string[],
  includeTypes: boolean
): Promise<string> {
  const sections: string[] = [];

  if (focus === 'full' || focus === 'modules') {
    const moduleRows = modules.map((moduleInfo) => ({
      name: moduleInfo.name,
      files: moduleInfo.fileCount,
      lines: moduleInfo.lineCount,
      top_exports: moduleInfo.topExports
        .slice(0, 4)
        .map((exp) => exp.line
          ? `${exp.name} (${exp.file}:${exp.line})`
          : `${exp.name} (${exp.file})`)
        .join(', '),
    }));
    sections.push('[MODULES]');
    sections.push(formatCompactTable(moduleRows, {
      columns: ['name', 'files', 'lines', 'top_exports'],
    }));
  }

  if (focus === 'full' || focus === 'dependencies') {
    const depRows = dependencyEdges.map((edge) => ({
      from: edge.fromModule,
      to: edge.toModule,
      symbols: [...edge.symbols].sort((a, b) => a.localeCompare(b)).slice(0, 8).join(', '),
    }));
    sections.push('[DEPS]');
    sections.push(formatCompactTable(depRows, {
      columns: ['from', 'to', 'symbols'],
    }));
  }

  if (focus === 'full' || focus === 'entry_points') {
    const entryRows = await Promise.all(
      entryPoints.map(async (entry) => {
        const signatures = await getEntryExportSignatures(storage, entry.file, includeTypes);
        return {
          type: entry.type,
          file: entry.file.relativePath,
          source: entry.source,
          exports: signatures.slice(0, 5).join(', '),
        };
      })
    );
    sections.push('[ENTRY_POINTS]');
    sections.push(formatCompactTable(entryRows, {
      columns: ['type', 'file', 'source', 'exports'],
    }));
  }

  if (focus === 'full' || focus === 'public_api' || focus === 'entry_points') {
    const apiRows = apiCollection.symbols.map((symbol) => ({
      name: symbol.name,
      kind: symbol.kind,
      file: symbol.file,
      line: symbol.line,
      signature: symbol.signature,
    }));
    sections.push('[PUBLIC_API]');
    sections.push(formatCompactTable(apiRows, {
      columns: ['name', 'kind', 'file', 'line', 'signature'],
    }));

    if (apiCollection.unresolvedReExports.length > 0) {
      const unresolvedRows = apiCollection.unresolvedReExports.map((name) => ({ name }));
      sections.push('[UNRESOLVED_REEXPORTS]');
      sections.push(formatCompactTable(unresolvedRows, { columns: ['name'] }));
    }
  }

  if (focus === 'full' || focus === 'patterns') {
    const patternRows = patterns.map((pattern) => ({
      pattern: pattern.replace(/\*\*/g, ''),
    }));
    sections.push('[PATTERNS]');
    sections.push(formatCompactTable(patternRows, { columns: ['pattern'] }));
  }

  return sections.join('\n\n').trim();
}

function buildModules(files: FileIndex[]): ModuleInfo[] {
  const grouped = new Map<string, FileIndex[]>();
  const referenceCounts = buildReferenceCounts(files);

  for (const file of files) {
    const moduleName = getModuleName(file.relativePath);
    const existing = grouped.get(moduleName) ?? [];
    existing.push(file);
    grouped.set(moduleName, existing);
  }

  const modules: ModuleInfo[] = [];
  for (const [moduleName, moduleFiles] of grouped.entries()) {
    const exports = collectModuleExports(moduleFiles, referenceCounts);
    const uniqueExports = dedupeModuleExports(exports);
    const topExports = [...uniqueExports]
      .sort((a, b) => scoreModuleExport(b) - scoreModuleExport(a))
      .slice(0, 5);
    const groupedExports = groupExportsByKind(uniqueExports);
    const narrative = buildModuleNarrative(moduleName, uniqueExports, topExports, moduleFiles);

    modules.push({
      name: moduleName,
      fileCount: moduleFiles.length,
      lineCount: moduleFiles.reduce((sum, file) => sum + file.lineCount, 0),
      exports: uniqueExports,
      topExports,
      narrative,
      groupedExports,
    });
  }

  return modules.sort((a, b) => {
    if (b.lineCount !== a.lineCount) {
      return b.lineCount - a.lineCount;
    }
    return a.name.localeCompare(b.name);
  });
}

function buildReferenceCounts(files: FileIndex[]): Map<string, number> {
  const counts = new Map<string, number>();
  const increment = (name: string | null | undefined, amount: number = 1): void => {
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    counts.set(trimmed, (counts.get(trimmed) ?? 0) + amount);
  };

  for (const file of files) {
    for (const reference of file.references) {
      increment(reference.symbolName);
    }

    for (const call of file.calls) {
      increment(call.calleeName, Math.max(call.callCount, 1));
      increment(call.callerName);
    }

    for (const imp of file.imports) {
      for (const specifier of imp.specifiers) {
        increment(specifier.name);
      }
    }
  }

  return counts;
}

function collectModuleExports(
  files: FileIndex[],
  referenceCounts: Map<string, number>
): ModuleExport[] {
  const collected: ModuleExport[] = [];

  for (const file of files) {
    for (const cls of file.classes) {
      if (!cls.isExported) continue;
      collected.push({
        name: cls.name,
        kind: 'class',
        file: file.relativePath,
        line: cls.location.startLine > 0 ? cls.location.startLine : undefined,
        signature: normalizeSignature(cls.signature || `class ${cls.name}`),
        referenceCount: referenceCounts.get(cls.name) ?? 0,
        methodCount: cls.methods.length,
        propertyCount: cls.properties.length,
      });
    }

    for (const func of file.functions) {
      if (!func.modifiers?.isExported) continue;
      collected.push({
        name: func.name,
        kind: 'function',
        file: file.relativePath,
        line: func.location.startLine > 0 ? func.location.startLine : undefined,
        signature: normalizeSignature(func.signature || `function ${func.name}()`),
        referenceCount: referenceCounts.get(func.name) ?? 0,
        methodCount: 0,
        propertyCount: func.parameters.length,
      });
    }

    for (const iface of file.interfaces) {
      if (!iface.isExported) continue;
      collected.push({
        name: iface.name,
        kind: 'interface',
        file: file.relativePath,
        line: iface.location.startLine > 0 ? iface.location.startLine : undefined,
        signature: normalizeSignature(iface.signature || `interface ${iface.name}`),
        referenceCount: referenceCounts.get(iface.name) ?? 0,
        methodCount: iface.methods.length,
        propertyCount: iface.properties.length,
      });
    }

    for (const typeAlias of file.typeAliases) {
      if (!typeAlias.isExported) continue;
      collected.push({
        name: typeAlias.name,
        kind: 'type',
        file: file.relativePath,
        line: typeAlias.location.startLine > 0 ? typeAlias.location.startLine : undefined,
        signature: normalizeSignature(typeAlias.signature || `type ${typeAlias.name}`),
        referenceCount: referenceCounts.get(typeAlias.name) ?? 0,
        methodCount: 0,
        propertyCount: 0,
      });
    }

    for (const variable of file.variables) {
      if (!variable.isExported) continue;
      collected.push({
        name: variable.name,
        kind: 'variable',
        file: file.relativePath,
        line: variable.location?.startLine && variable.location.startLine > 0
          ? variable.location.startLine
          : undefined,
        signature: normalizeSignature(`${variable.kind} ${variable.name}${variable.type ? `: ${variable.type}` : ''}`),
        referenceCount: referenceCounts.get(variable.name) ?? 0,
        methodCount: 0,
        propertyCount: 0,
      });
    }
  }

  return collected;
}

function dedupeModuleExports(exports: ModuleExport[]): ModuleExport[] {
  const byKey = new Map<string, ModuleExport>();

  for (const exp of exports) {
    const key = `${exp.kind}:${exp.name}`;
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, exp);
      continue;
    }

    const existingScore = scoreModuleExport(existing);
    const nextScore = scoreModuleExport(exp);

    if (nextScore > existingScore) {
      byKey.set(key, exp);
      continue;
    }

    if (nextScore === existingScore) {
      const existingPriority = `${existing.signature.length}:${existing.file}`;
      const nextPriority = `${exp.signature.length}:${exp.file}`;
      if (nextPriority < existingPriority) {
        byKey.set(key, exp);
      }
    }
  }

  return [...byKey.values()];
}

function groupExportsByKind(exports: ModuleExport[]): Map<ExportKind, ModuleExport[]> {
  const grouped = new Map<ExportKind, ModuleExport[]>();
  const kinds: ExportKind[] = ['class', 'function', 'interface', 'type', 'variable'];
  for (const kind of kinds) {
    grouped.set(kind, []);
  }

  for (const exp of exports) {
    grouped.get(exp.kind)?.push(exp);
  }

  for (const values of grouped.values()) {
    values.sort((a, b) => {
      if (a.name !== b.name) {
        return a.name.localeCompare(b.name);
      }
      return a.file.localeCompare(b.file);
    });
  }

  return grouped;
}

function scoreModuleExport(exp: ModuleExport): number {
  const referenceWeight = exp.referenceCount * 4;
  switch (exp.kind) {
    case 'class':
      return 30 + referenceWeight + exp.methodCount * 3 + exp.propertyCount;
    case 'function':
      return 20 + referenceWeight + exp.propertyCount;
    case 'interface':
      return 10 + referenceWeight + exp.propertyCount + exp.methodCount;
    case 'type':
      return 8 + referenceWeight;
    case 'variable':
      return 6 + referenceWeight;
    default:
      return referenceWeight;
  }
}

function buildModuleNarrative(
  moduleName: string,
  exports: ModuleExport[],
  topExports: ModuleExport[],
  moduleFiles: FileIndex[]
): string | null {
  if (!(moduleName === 'src' || moduleName.startsWith('src/'))) {
    return null;
  }

  if (exports.length < 2 || topExports.length < 2) {
    return null;
  }

  if (topExports.some(exp => exp.signature.length > 180)) {
    return null;
  }

  const tokens = extractSemanticTokens(topExports.map(exp => exp.name));
  const hint = inferModuleHint(moduleName, tokens);
  if (!hint && tokens.length < 2) {
    return null;
  }

  const kindSummary = summarizeExportKinds(exports);
  const topicPhrase = tokens.length > 0 ? formatTokenList(tokens.slice(0, 3)) : 'core workflows';
  const sentenceOne = hint ?? `Provides ${kindSummary} focused on ${topicPhrase}.`;
  const sentenceTwo = `Primary exports: ${topExports.map(exp => `\`${formatModuleExportHeadline(exp)}\``).join(', ')}.`;

  const narrative = `${sentenceOne} ${sentenceTwo}`;
  if (narrative.length < 60) {
    return null;
  }

  // Avoid narrative when module has highly fragmented files with almost no exports.
  const exportedFiles = moduleFiles.filter(file =>
    file.classes.some(c => c.isExported) ||
    file.functions.some(f => f.modifiers?.isExported) ||
    file.interfaces.some(i => i.isExported) ||
    file.typeAliases.some(t => t.isExported) ||
    file.variables.some(v => v.isExported)
  );
  if (exportedFiles.length === 0) {
    return null;
  }

  return narrative;
}

function extractSemanticTokens(names: string[]): string[] {
  const counts = new Map<string, number>();

  for (const name of names) {
    const expanded = name
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_\-.]/g, ' ')
      .toLowerCase();

    const tokens = expanded.split(/\s+/).filter(Boolean);
    for (const token of tokens) {
      if (token.length < 3) continue;
      if (DESCRIPTION_STOP_WORDS.has(token)) continue;
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }
      return a[0].localeCompare(b[0]);
    })
    .map(entry => entry[0])
    .slice(0, 6);
}

function inferModuleHint(moduleName: string, tokens: string[]): string | null {
  for (const hint of MODULE_HINTS) {
    if (hint.pattern.test(moduleName)) {
      return hint.description;
    }
  }

  const tokenSet = new Set(tokens);
  if (tokenSet.has('indexer') || (tokenSet.has('index') && tokenSet.has('symbol'))) {
    return 'Core indexing and symbol extraction engine.';
  }
  if (tokenSet.has('server') || tokenSet.has('tool')) {
    return 'Server runtime and MCP tool orchestration layer.';
  }
  if (tokenSet.has('chain') || tokenSet.has('markov')) {
    return 'Probabilistic relationship and suggestion engine.';
  }
  if (tokenSet.has('config')) {
    return 'Configuration parsing and normalization helpers.';
  }

  return null;
}

function summarizeExportKinds(exports: ModuleExport[]): string {
  const counts: Record<ExportKind, number> = {
    class: 0,
    function: 0,
    interface: 0,
    type: 0,
    variable: 0,
  };

  for (const exp of exports) {
    counts[exp.kind] += 1;
  }

  const labels: Array<[ExportKind, string]> = [
    ['class', 'classes'],
    ['function', 'functions'],
    ['interface', 'interfaces'],
    ['type', 'types'],
    ['variable', 'variables'],
  ];

  const parts = labels
    .filter(([kind]) => counts[kind] > 0)
    .map(([kind, label]) => `${counts[kind]} ${label}`);

  return parts.length > 0 ? parts.join(', ') : 'no public exports';
}

function formatTokenList(tokens: string[]): string {
  if (tokens.length === 0) return 'core workflows';
  if (tokens.length === 1) return tokens[0] ?? 'core workflows';
  if (tokens.length === 2) return `${tokens[0]} and ${tokens[1]}`;
  return `${tokens[0]}, ${tokens[1]}, and ${tokens[2]}`;
}

function formatModuleExportHeadline(exp: ModuleExport): string {
  if (exp.kind === 'class') {
    return `class ${exp.name}`;
  }
  if (exp.kind === 'function') {
    return `function ${exp.name}()`;
  }
  if (exp.kind === 'interface') {
    return `interface ${exp.name}`;
  }
  if (exp.kind === 'type') {
    return `type ${exp.name}`;
  }
  return `${exp.kind} ${exp.name}`;
}

function renderModules(modules: ModuleInfo[]): string {
  let output = '## Modules\n';

  for (const moduleInfo of modules) {
    output += `\n### ${formatModuleLabel(moduleInfo.name)} (${moduleInfo.fileCount} files, ${moduleInfo.lineCount.toLocaleString()} lines)\n`;

    if (moduleInfo.narrative) {
      output += `${moduleInfo.narrative}\n`;
      if (moduleInfo.topExports.length > 0) {
        output += `Key exports: ${moduleInfo.topExports.map(exp => `\`${formatModuleExportHeadline(exp)}\``).join(', ')}.\n`;
      }
      continue;
    }

    output += 'Structured export listing (fallback):\n';
    output += renderGroupedModuleExports(moduleInfo.groupedExports);
  }

  return output.trimEnd();
}

function renderGroupedModuleExports(grouped: Map<ExportKind, ModuleExport[]>): string {
  const kindLabels: Array<[ExportKind, string]> = [
    ['class', 'Classes'],
    ['function', 'Functions'],
    ['interface', 'Interfaces'],
    ['type', 'Types'],
    ['variable', 'Variables'],
  ];

  let output = '';
  let hasAny = false;

  for (const [kind, label] of kindLabels) {
    const entries = grouped.get(kind) ?? [];
    if (entries.length === 0) continue;
    hasAny = true;

    const preview = entries.slice(0, 6).map(entry => `\`${formatModuleExportHeadline(entry)}\``);
    const overflow = entries.length - preview.length;
    const suffix = overflow > 0 ? `, ... (+${overflow} more)` : '';
    output += `- ${label}: ${preview.join(', ')}${suffix}\n`;
  }

  if (!hasAny) {
    output += '- No exported symbols detected in this module.\n';
  }

  return output;
}

async function buildModuleDependencies(
  storage: SqliteStorage,
  files: FileIndex[]
): Promise<ModuleDependencyEdge[]> {
  const fileByPath = new Map(files.map(file => [file.filePath, file]));
  const moduleByFilePath = new Map(files.map(file => [file.filePath, getModuleName(file.relativePath)]));
  const edgeMap = new Map<string, ModuleDependencyEdge>();

  for (const file of files) {
    let imports = await safeGetFileImports(storage, file.filePath);
    imports = hydrateUnresolvedImports(imports, file, files);
    if (imports.length === 0 && file.imports.length > 0) {
      imports = buildImportsFromFileIndex(file, files);
    }

    for (const imp of imports) {
      if (imp.isExternal || !imp.resolvedPath) continue;

      const sourceModule = moduleByFilePath.get(file.filePath);
      const targetFile = fileByPath.get(imp.resolvedPath);
      const targetModule = targetFile ? moduleByFilePath.get(targetFile.filePath) : undefined;

      if (!sourceModule || !targetModule || sourceModule === targetModule) {
        continue;
      }

      const key = `${sourceModule}->${targetModule}`;
      let edge = edgeMap.get(key);
      if (!edge) {
        edge = {
          fromModule: sourceModule,
          toModule: targetModule,
          symbols: new Set<string>(),
          typeOnlyCount: 0,
          valueCount: 0,
        };
        edgeMap.set(key, edge);
      }

      if (imp.specifiers.length === 0) {
        edge.symbols.add('*side-effect*');
      } else {
        for (const specifier of imp.specifiers) {
          const rendered = formatImportSpecifier(specifier);
          edge.symbols.add(imp.isTypeOnly ? `${rendered} (type)` : rendered);
        }
      }

      if (imp.isTypeOnly) {
        edge.typeOnlyCount += 1;
      } else {
        edge.valueCount += 1;
      }
    }
  }

  return [...edgeMap.values()].sort((a, b) => {
    if (a.fromModule !== b.fromModule) {
      return a.fromModule.localeCompare(b.fromModule);
    }
    return a.toModule.localeCompare(b.toModule);
  });
}

function buildImportsFromFileIndex(file: FileIndex, allFiles: FileIndex[]): StorageFileImport[] {
  const imports: StorageFileImport[] = [];
  for (const imp of file.imports) {
    const isRelativeImport = imp.source.startsWith('.') || imp.source.startsWith('/');
    let resolvedPath: string | null = null;

    if (isRelativeImport) {
      const normalizedSource = imp.source.startsWith('.')
        ? normalizeEntryPath(imp.source, path.dirname(file.relativePath))
        : imp.source;
      const targetFile = matchEntryPathToFile(allFiles, normalizedSource);
      resolvedPath = targetFile?.filePath ?? null;
    }

    imports.push({
      source: imp.source,
      resolvedPath,
      isExternal: !isRelativeImport,
      isTypeOnly: imp.isTypeOnly,
      isReExport: false,
      specifiers: imp.specifiers.map(specifier => ({
        name: specifier.name,
        alias: specifier.alias,
        isDefault: specifier.isDefault,
        isNamespace: specifier.isNamespace,
      })),
    });
  }

  return imports;
}

function hydrateUnresolvedImports(
  imports: StorageFileImport[],
  file: FileIndex,
  allFiles: FileIndex[]
): StorageFileImport[] {
  if (imports.length === 0) {
    return imports;
  }

  return imports.map(imp => {
    if (imp.isExternal || imp.resolvedPath) {
      return imp;
    }

    const resolvedPath = resolveInternalImportPath(file, allFiles, imp.source);
    if (!resolvedPath) {
      return imp;
    }

    return {
      ...imp,
      resolvedPath,
    };
  });
}

function resolveInternalImportPath(
  file: FileIndex,
  allFiles: FileIndex[],
  source: string
): string | null {
  const isRelativeImport = source.startsWith('.') || source.startsWith('/');
  if (!isRelativeImport) {
    return null;
  }

  const normalizedSource = source.startsWith('.')
    ? normalizeEntryPath(source, path.dirname(file.relativePath))
    : source;
  const targetFile = matchEntryPathToFile(allFiles, normalizedSource);
  return targetFile?.filePath ?? null;
}

function formatImportSpecifier(specifier: StorageImportSpecifier): string {
  if (specifier.isNamespace) {
    return `* as ${specifier.alias ?? specifier.name}`;
  }
  if (specifier.isDefault) {
    return specifier.alias ? `default as ${specifier.alias}` : 'default';
  }
  if (specifier.alias && specifier.alias !== specifier.name) {
    return `${specifier.name} as ${specifier.alias}`;
  }
  return specifier.name;
}

function renderModuleDependencies(edges: ModuleDependencyEdge[]): string {
  let output = '## Module Dependencies\n\n';

  if (edges.length === 0) {
    output += '*No cross-module internal imports detected.*';
    return output;
  }

  for (const edge of edges) {
    const symbols = [...edge.symbols];
    const preview = symbols.slice(0, 10).join(', ');
    const overflow = symbols.length > 10 ? `, ... (+${symbols.length - 10} more)` : '';
    const qualifier = edge.valueCount === 0 && edge.typeOnlyCount > 0 ? ' [type-only]' : '';
    output += `- ${formatModuleLabel(edge.fromModule)} -> ${formatModuleLabel(edge.toModule)} (${preview}${overflow})${qualifier}\n`;
  }

  return output.trimEnd();
}

async function detectEntryPoints(
  storage: SqliteStorage,
  files: FileIndex[],
  requestedEntryFile?: string
): Promise<EntryPointDetection> {
  const entriesByPath = new Map<string, EntryPoint>();
  const addEntry = (file: FileIndex, type: EntryPointType, source: string): void => {
    if (entriesByPath.has(file.filePath)) return;
    entriesByPath.set(file.filePath, { file, type, source });
  };

  if (requestedEntryFile) {
    const requestedMatches = findMatchingFiles(files, requestedEntryFile);
    for (const match of requestedMatches) {
      addEntry(match, classifyEntryPointType(match), 'user-specified');
    }

    const requestedEntries = [...entriesByPath.values()];
    return {
      entries: requestedEntries,
      apiFiles: requestedEntries.map(entry => entry.file),
      source: requestedEntries.length > 0 ? 'user-specified entry_file' : 'fallback all exports',
    };
  }

  const packageEntries = await findPackageEntryPaths(storage);
  for (const packageEntry of packageEntries.libraryPaths) {
    const file = matchEntryPathToFile(files, packageEntry);
    if (file) {
      addEntry(file, 'library', packageEntries.librarySource ?? 'package.json');
    }
  }

  for (const binPath of packageEntries.binPaths) {
    const file = matchEntryPathToFile(files, binPath);
    if (file) {
      addEntry(file, 'bin', packageEntries.binSource ?? 'package.json bin');
    }
  }

  for (const file of files) {
    if (/^src\/(cli|bin)\/(index|main)\.(ts|js)$/.test(file.relativePath)) {
      addEntry(file, 'cli', 'cli convention');
    }
  }

  const fallbackPaths = [
    'src/index.ts',
    'src/index.js',
    'index.ts',
    'index.js',
    'lib/index.ts',
    'lib/index.js',
    'src/main.ts',
    'src/main.js',
  ];

  for (const fallback of fallbackPaths) {
    const file = files.find(candidate => candidate.relativePath === fallback);
    if (!file) continue;
    addEntry(file, classifyEntryPointType(file), 'default patterns');
  }

  const entries = [...entriesByPath.values()].sort((a, b) =>
    a.file.relativePath.localeCompare(b.file.relativePath)
  );

  return {
    entries,
    apiFiles: entries.map(entry => entry.file),
    source: entries.length > 0 ? 'detected entry points' : 'fallback all exports',
  };
}

function findMatchingFiles(files: FileIndex[], candidatePath: string): FileIndex[] {
  const normalized = candidatePath.replace(/\\/g, '/').replace(/^\.\//, '');
  const hasDirectory = normalized.includes('/');
  return files.filter(file =>
    file.relativePath === normalized ||
    file.relativePath.endsWith(`/${normalized}`) ||
    (!hasDirectory && path.basename(file.relativePath) === path.basename(normalized))
  );
}

function classifyEntryPointType(file: FileIndex): EntryPointType {
  const relativePath = file.relativePath;
  if (/(^|\/)(cli|bin)\//.test(relativePath)) {
    return 'cli';
  }
  if (/main\.(ts|js)$/.test(relativePath)) {
    return 'main';
  }
  return 'library';
}

interface PackageEntryPaths {
  libraryPaths: string[];
  binPaths: string[];
  librarySource: string | null;
  binSource: string | null;
}

async function findPackageEntryPaths(storage: SqliteStorage): Promise<PackageEntryPaths> {
  const emptyResult: PackageEntryPaths = {
    libraryPaths: [],
    binPaths: [],
    librarySource: null,
    binSource: null,
  };

  if (typeof storage.listConfigFiles !== 'function' || typeof storage.getConfigValue !== 'function') {
    return emptyResult;
  }

  const configFiles = await safeListConfigFiles(storage, { configType: 'package.json' });
  if (configFiles.length === 0) {
    return emptyResult;
  }

  const rootPackageJson = [...configFiles].sort((a, b) =>
    a.relativePath.length - b.relativePath.length
  )[0];

  if (!rootPackageJson) {
    return emptyResult;
  }

  const packageDir = path.dirname(rootPackageJson.relativePath);
  const libraryPaths: string[] = [];
  const binPaths: string[] = [];
  let librarySource: string | null = null;
  let binSource: string | null = null;

  const exportValues = await safeGetConfigValue(storage, 'exports', rootPackageJson.filePath);
  if (exportValues.length > 0) {
    const extracted = extractPathsFromExports(exportValues[0]?.rawValue, packageDir);
    if (extracted.length > 0) {
      libraryPaths.push(...extracted);
      librarySource = 'package.json exports';
    }
  }

  if (libraryPaths.length === 0) {
    const moduleValues = await safeGetConfigValue(storage, 'module', rootPackageJson.filePath);
    const moduleValue = moduleValues[0]?.rawValue;
    if (typeof moduleValue === 'string') {
      libraryPaths.push(normalizeEntryPath(moduleValue, packageDir));
      librarySource = 'package.json module';
    }
  }

  if (libraryPaths.length === 0) {
    const mainValues = await safeGetConfigValue(storage, 'main', rootPackageJson.filePath);
    const mainValue = mainValues[0]?.rawValue;
    if (typeof mainValue === 'string') {
      libraryPaths.push(normalizeEntryPath(mainValue, packageDir));
      librarySource = 'package.json main';
    }
  }

  const binValues = await safeGetConfigValue(storage, 'bin', rootPackageJson.filePath);
  const binRaw = binValues[0]?.rawValue;
  if (typeof binRaw === 'string') {
    binPaths.push(normalizeEntryPath(binRaw, packageDir));
    binSource = 'package.json bin';
  } else if (binRaw && typeof binRaw === 'object') {
    for (const value of Object.values(binRaw as Record<string, unknown>)) {
      if (typeof value === 'string') {
        binPaths.push(normalizeEntryPath(value, packageDir));
      }
    }
    if (binPaths.length > 0) {
      binSource = 'package.json bin';
    }
  }

  return {
    libraryPaths: dedupeStrings(libraryPaths),
    binPaths: dedupeStrings(binPaths),
    librarySource,
    binSource,
  };
}

function extractPathsFromExports(exportsValue: unknown, baseDir: string): string[] {
  const paths: string[] = [];

  if (typeof exportsValue === 'string') {
    paths.push(normalizeEntryPath(exportsValue, baseDir));
    return paths;
  }

  if (!exportsValue || typeof exportsValue !== 'object') {
    return paths;
  }

  const exportObject = exportsValue as Record<string, unknown>;

  const dotEntry = exportObject['.'];
  if (typeof dotEntry === 'string') {
    paths.push(normalizeEntryPath(dotEntry, baseDir));
  } else if (dotEntry && typeof dotEntry === 'object') {
    const dotObject = dotEntry as Record<string, unknown>;
    const conditional = dotObject['import'] ?? dotObject['default'] ?? dotObject['require'];
    if (typeof conditional === 'string') {
      paths.push(normalizeEntryPath(conditional, baseDir));
    }
  }

  if (paths.length === 0) {
    const rootConditional = exportObject['import'] ?? exportObject['default'] ?? exportObject['require'];
    if (typeof rootConditional === 'string') {
      paths.push(normalizeEntryPath(rootConditional, baseDir));
    }
  }

  return paths;
}

function normalizeEntryPath(entryPath: string, baseDir: string): string {
  let normalized = entryPath.replace(/^\.\//, '').replace(/\\/g, '/');

  if (baseDir && baseDir !== '.') {
    normalized = path.join(baseDir, normalized).replace(/\\/g, '/');
  }

  if (normalized.startsWith('dist/')) {
    normalized = normalized
      .replace(/^dist\//, 'src/')
      .replace(/\.mjs$/, '.ts')
      .replace(/\.cjs$/, '.ts')
      .replace(/\.js$/, '.ts');
  }

  if (normalized.startsWith('build/')) {
    normalized = normalized.replace(/^build\//, 'src/').replace(/\.js$/, '.ts');
  }

  return normalized;
}

function matchEntryPathToFile(files: FileIndex[], entryPath: string): FileIndex | null {
  const normalized = entryPath.replace(/\\/g, '/').replace(/^\.\//, '');
  const variants = dedupeStrings([
    normalized,
    normalized.replace(/\.mjs$/, '.ts'),
    normalized.replace(/\.cjs$/, '.ts'),
    normalized.replace(/\.js$/, '.ts'),
    normalized.replace(/^dist\//, 'src/').replace(/\.mjs$/, '.ts').replace(/\.cjs$/, '.ts').replace(/\.js$/, '.ts'),
    normalized.replace(/^build\//, 'src/').replace(/\.js$/, '.ts'),
  ]);

  for (const variant of variants) {
    const exact = files.find(file => file.relativePath === variant);
    if (exact) return exact;

    const suffix = files.find(file => file.relativePath.endsWith(`/${variant}`));
    if (suffix) return suffix;
  }

  return null;
}

async function collectPublicApi(
  storage: SqliteStorage,
  allSourceFiles: FileIndex[],
  entryFiles: FileIndex[],
  includeTypes: boolean
): Promise<PublicApiCollection> {
  const filesToScan = entryFiles.length > 0 ? entryFiles : allSourceFiles;
  const symbolMap = new Map<string, ApiSymbol>();
  const unresolvedReExports = new Set<string>();

  for (const file of filesToScan) {
    addDeclaredApiSymbols(symbolMap, file, includeTypes);
  }

  for (const file of filesToScan) {
    const reExportNames = await collectReExportNames(storage, file);
    for (const exportName of reExportNames) {
      const resolved = await resolveApiSymbolThroughReExports(
        storage,
        symbolMap,
        allSourceFiles,
        file,
        exportName,
        includeTypes
      );
      if (!resolved) {
        unresolvedReExports.add(exportName);
      }
    }
  }

  const symbols = [...symbolMap.values()].sort((a, b) => {
    if (a.kind !== b.kind) {
      return kindOrder(a.kind) - kindOrder(b.kind);
    }
    if (a.name !== b.name) {
      return a.name.localeCompare(b.name);
    }
    return a.file.localeCompare(b.file);
  });

  return {
    symbols,
    filesUsed: filesToScan.map(file => file.relativePath),
    unresolvedReExports: [...unresolvedReExports].sort((a, b) => a.localeCompare(b)),
  };
}

async function collectReExportNames(storage: SqliteStorage, file: FileIndex): Promise<string[]> {
  const names = new Set<string>();

  const fileExports = await safeGetFileExports(storage, file.filePath);
  for (const exp of fileExports) {
    if (!exp.isReExport) continue;
    if (!exp.name || exp.name === '*') continue;
    names.add(exp.name);
  }

  for (const exp of file.exports) {
    if (!exp.isReExport) continue;
    if (!exp.name || exp.name === '*') continue;
    names.add(exp.name);
  }

  return [...names].sort((a, b) => a.localeCompare(b));
}

async function resolveApiSymbolThroughReExports(
  storage: SqliteStorage,
  symbolMap: Map<string, ApiSymbol>,
  allSourceFiles: FileIndex[],
  startingFile: FileIndex,
  exportName: string,
  includeTypes: boolean
): Promise<boolean> {
  const queue: FileIndex[] = [startingFile];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const file = queue.shift();
    if (!file) {
      continue;
    }

    const visitKey = `${file.filePath}:${exportName}`;
    if (visited.has(visitKey)) {
      continue;
    }
    visited.add(visitKey);

    if (addNamedApiSymbolFromFile(symbolMap, file, exportName, includeTypes)) {
      return true;
    }

    const reExports = await collectReExportCandidates(storage, file);
    for (const reExport of reExports) {
      if (reExport.name !== exportName && reExport.name !== '*') {
        continue;
      }

      const targetFile = resolveReExportTargetFile(allSourceFiles, file, reExport);
      if (targetFile) {
        queue.push(targetFile);
      }
    }
  }

  return false;
}

interface ReExportCandidate {
  name: string;
  source: string | null;
  resolvedPath: string | null;
}

async function collectReExportCandidates(
  storage: SqliteStorage,
  file: FileIndex
): Promise<ReExportCandidate[]> {
  const candidates: ReExportCandidate[] = [];
  const seen = new Set<string>();

  const stored = await safeGetFileExports(storage, file.filePath);
  for (const exp of stored) {
    if (!exp.isReExport) continue;
    const key = `${exp.name}:${exp.reExportSource ?? ''}:${exp.resolvedReExportPath ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      name: exp.name,
      source: exp.reExportSource,
      resolvedPath: exp.resolvedReExportPath,
    });
  }

  for (const exp of file.exports) {
    if (!exp.isReExport) continue;
    const key = `${exp.name}:${exp.source ?? ''}:`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      name: exp.name,
      source: exp.source ?? null,
      resolvedPath: null,
    });
  }

  return candidates;
}

function resolveReExportTargetFile(
  allSourceFiles: FileIndex[],
  currentFile: FileIndex,
  candidate: ReExportCandidate
): FileIndex | null {
  if (candidate.resolvedPath) {
    const direct = allSourceFiles.find(file => file.filePath === candidate.resolvedPath);
    if (direct) {
      return direct;
    }
  }

  if (!candidate.source) {
    return null;
  }

  const normalizedSource = normalizeEntryPath(candidate.source, path.dirname(currentFile.relativePath));
  const fromRelative = matchEntryPathToFile(allSourceFiles, normalizedSource);
  if (fromRelative) {
    return fromRelative;
  }

  return null;
}

function addDeclaredApiSymbols(symbolMap: Map<string, ApiSymbol>, file: FileIndex, includeTypes: boolean): void {
  for (const cls of file.classes) {
    if (!cls.isExported) continue;
    const symbol: ApiClassSymbol = {
      kind: 'class',
      name: cls.name,
      file: file.relativePath,
      line: cls.location.startLine > 0 ? cls.location.startLine : undefined,
      signature: normalizeSignature(cls.signature || `class ${cls.name}`),
      methodCount: cls.methods.length,
      extendsType: cls.extends ?? undefined,
      implementsTypes: cls.implements ?? [],
    };
    symbolMap.set(symbolKey(symbol), symbol);
  }

  for (const func of file.functions) {
    if (!func.modifiers?.isExported) continue;
    const symbol: ApiFunctionSymbol = {
      kind: 'function',
      name: func.name,
      file: file.relativePath,
      line: func.location.startLine > 0 ? func.location.startLine : undefined,
      signature: normalizeSignature(func.signature || `function ${func.name}()`),
      isAsync: func.modifiers?.isAsync ?? false,
      returnType: func.returnType ?? undefined,
    };
    symbolMap.set(symbolKey(symbol), symbol);
  }

  if (includeTypes) {
    for (const iface of file.interfaces) {
      if (!iface.isExported) continue;
      const symbol: ApiInterfaceSymbol = {
        kind: 'interface',
        name: iface.name,
        file: file.relativePath,
        line: iface.location.startLine > 0 ? iface.location.startLine : undefined,
        signature: normalizeSignature(iface.signature || `interface ${iface.name}`),
        propertyCount: iface.properties.length,
        methodCount: iface.methods.length,
      };
      symbolMap.set(symbolKey(symbol), symbol);
    }

    for (const typeAlias of file.typeAliases) {
      if (!typeAlias.isExported) continue;
      const symbol: ApiTypeSymbol = {
        kind: 'type',
        name: typeAlias.name,
        file: file.relativePath,
        line: typeAlias.location.startLine > 0 ? typeAlias.location.startLine : undefined,
        signature: normalizeSignature(typeAlias.signature || `type ${typeAlias.name}`),
      };
      symbolMap.set(symbolKey(symbol), symbol);
    }
  }

  for (const variable of file.variables) {
    if (!variable.isExported) continue;
    const signature = `${variable.kind} ${variable.name}${variable.type ? `: ${variable.type}` : ''}`;
    const symbol: ApiVariableSymbol = {
      kind: 'variable',
      name: variable.name,
      file: file.relativePath,
      line: variable.location?.startLine && variable.location.startLine > 0
        ? variable.location.startLine
        : undefined,
      signature: normalizeSignature(signature),
      variableKind: variable.kind,
    };
    symbolMap.set(symbolKey(symbol), symbol);
  }
}

function addNamedApiSymbolFromFile(
  symbolMap: Map<string, ApiSymbol>,
  file: FileIndex,
  exportName: string,
  includeTypes: boolean
): boolean {
  const cls = file.classes.find(candidate => candidate.name === exportName);
  if (cls) {
    const symbol: ApiClassSymbol = {
      kind: 'class',
      name: cls.name,
      file: file.relativePath,
      line: cls.location.startLine > 0 ? cls.location.startLine : undefined,
      signature: normalizeSignature(cls.signature || `class ${cls.name}`),
      methodCount: cls.methods.length,
      extendsType: cls.extends ?? undefined,
      implementsTypes: cls.implements ?? [],
    };
    symbolMap.set(symbolKey(symbol), symbol);
    return true;
  }

  const func = file.functions.find(candidate => candidate.name === exportName);
  if (func) {
    const symbol: ApiFunctionSymbol = {
      kind: 'function',
      name: func.name,
      file: file.relativePath,
      line: func.location.startLine > 0 ? func.location.startLine : undefined,
      signature: normalizeSignature(func.signature || `function ${func.name}()`),
      isAsync: func.modifiers?.isAsync ?? false,
      returnType: func.returnType ?? undefined,
    };
    symbolMap.set(symbolKey(symbol), symbol);
    return true;
  }

  if (includeTypes) {
    const iface = file.interfaces.find(candidate => candidate.name === exportName);
    if (iface) {
      const symbol: ApiInterfaceSymbol = {
        kind: 'interface',
        name: iface.name,
        file: file.relativePath,
        line: iface.location.startLine > 0 ? iface.location.startLine : undefined,
        signature: normalizeSignature(iface.signature || `interface ${iface.name}`),
        propertyCount: iface.properties.length,
        methodCount: iface.methods.length,
      };
      symbolMap.set(symbolKey(symbol), symbol);
      return true;
    }

    const typeAlias = file.typeAliases.find(candidate => candidate.name === exportName);
    if (typeAlias) {
      const symbol: ApiTypeSymbol = {
        kind: 'type',
        name: typeAlias.name,
        file: file.relativePath,
        line: typeAlias.location.startLine > 0 ? typeAlias.location.startLine : undefined,
        signature: normalizeSignature(typeAlias.signature || `type ${typeAlias.name}`),
      };
      symbolMap.set(symbolKey(symbol), symbol);
      return true;
    }
  }

  const variable = file.variables.find(candidate => candidate.name === exportName);
  if (variable) {
    const symbol: ApiVariableSymbol = {
      kind: 'variable',
      name: variable.name,
      file: file.relativePath,
      line: variable.location?.startLine && variable.location.startLine > 0
        ? variable.location.startLine
        : undefined,
      signature: normalizeSignature(`${variable.kind} ${variable.name}${variable.type ? `: ${variable.type}` : ''}`),
      variableKind: variable.kind,
    };
    symbolMap.set(symbolKey(symbol), symbol);
    return true;
  }

  return false;
}

function symbolKey(symbol: ApiSymbol): string {
  return `${symbol.kind}:${symbol.file}:${symbol.name}`;
}

function kindOrder(kind: ExportKind): number {
  switch (kind) {
    case 'class':
      return 0;
    case 'function':
      return 1;
    case 'interface':
      return 2;
    case 'type':
      return 3;
    case 'variable':
      return 4;
    default:
      return 5;
  }
}

async function renderEntryPoints(
  storage: SqliteStorage,
  entries: EntryPoint[],
  includeTypes: boolean
): Promise<string> {
  let output = '## Entry Points\n\n';

  if (entries.length === 0) {
    output += '*No clear entry points detected. Public API section falls back to all exported symbols.*';
    return output;
  }

  for (const entry of entries) {
    const typeLabel = entry.type === 'cli'
      ? 'CLI'
      : entry.type === 'library'
        ? 'Library'
        : entry.type === 'bin'
          ? 'Binary'
          : 'Main';

    const roleDescription = entry.type === 'cli'
      ? 'Command-line execution path.'
      : entry.type === 'library'
        ? 'Primary import surface for consumers.'
        : entry.type === 'bin'
          ? 'Package bin entry wrapper.'
          : 'Standalone runtime entry file.';

    const signatures = await getEntryExportSignatures(storage, entry.file, includeTypes);
    const preview = signatures.slice(0, 5).map(signature => `\`${signature}\``).join(', ');
    const overflow = signatures.length > 5 ? `, ... (+${signatures.length - 5} more)` : '';

    output += `- **${typeLabel}**: \`${entry.file.relativePath}\` — ${roleDescription}`;
    if (signatures.length > 0) {
      output += ` Exports: ${preview}${overflow}.`;
    } else {
      output += ' No direct exports detected.';
    }
    output += ` *(detected via ${entry.source})*\n`;
  }

  return output.trimEnd();
}

async function getEntryExportSignatures(
  storage: SqliteStorage,
  file: FileIndex,
  includeTypes: boolean
): Promise<string[]> {
  const signatures: string[] = [];
  const pushUnique = (value: string): void => {
    if (!signatures.includes(value)) {
      signatures.push(value);
    }
  };

  for (const cls of file.classes) {
    if (cls.isExported) {
      pushUnique(normalizeSignature(cls.signature || `class ${cls.name}`));
    }
  }
  for (const func of file.functions) {
    if (func.modifiers?.isExported) {
      pushUnique(normalizeSignature(func.signature || `function ${func.name}()`));
    }
  }
  if (includeTypes) {
    for (const iface of file.interfaces) {
      if (iface.isExported) {
        pushUnique(normalizeSignature(iface.signature || `interface ${iface.name}`));
      }
    }
    for (const typeAlias of file.typeAliases) {
      if (typeAlias.isExported) {
        pushUnique(normalizeSignature(typeAlias.signature || `type ${typeAlias.name}`));
      }
    }
  }
  for (const variable of file.variables) {
    if (variable.isExported) {
      pushUnique(normalizeSignature(`${variable.kind} ${variable.name}${variable.type ? `: ${variable.type}` : ''}`));
    }
  }

  const fileExports = await safeGetFileExports(storage, file.filePath);
  for (const exp of fileExports) {
    if (exp.isReExport) {
      pushUnique(`re-export ${exp.name}`);
    }
  }

  for (const exp of file.exports) {
    if (exp.isReExport) {
      pushUnique(`re-export ${exp.name}`);
    }
  }

  return signatures.sort((a, b) => a.localeCompare(b));
}

function renderPublicApi(
  api: PublicApiCollection,
  groupBy: 'kind' | 'file',
  includeTypes: boolean,
  source: string
): string {
  let output = '## Public API\n\n';

  if (api.filesUsed.length > 0) {
    output += `Source scope: ${api.filesUsed.map(file => `\`${file}\``).join(', ')} (${source}).\n\n`;
  }

  if (api.symbols.length === 0) {
    output += '*No exported public symbols found in the selected entry scope.*';
    return output;
  }

  if (groupBy === 'kind') {
    output += renderApiByKind(api.symbols, includeTypes);
  } else {
    output += renderApiByFile(api.symbols);
  }

  if (api.unresolvedReExports.length > 0) {
    output += '\n### Unresolved Re-exports\n';
    output += api.unresolvedReExports.map(name => `- \`${name}\``).join('\n');
    output += '\n';
  }

  return output.trimEnd();
}

function renderApiByKind(symbols: ApiSymbol[], includeTypes: boolean): string {
  const groups = new Map<ExportKind, ApiSymbol[]>();
  groups.set('class', []);
  groups.set('function', []);
  groups.set('interface', []);
  groups.set('type', []);
  groups.set('variable', []);

  for (const symbol of symbols) {
    groups.get(symbol.kind)?.push(symbol);
  }

  let output = '';

  const appendGroup = (kind: ExportKind, title: string): void => {
    const group = groups.get(kind) ?? [];
    if (group.length === 0) return;

    output += `### ${title} (${group.length})\n`;
    for (const symbol of group) {
      output += `- ${formatApiSymbol(symbol)}\n`;
    }
    output += '\n';
  };

  appendGroup('class', 'Classes');
  appendGroup('function', 'Functions');
  if (includeTypes) {
    appendGroup('interface', 'Interfaces');
    appendGroup('type', 'Types');
  }
  appendGroup('variable', 'Variables');

  return output;
}

function renderApiByFile(symbols: ApiSymbol[]): string {
  const byFile = new Map<string, ApiSymbol[]>();
  for (const symbol of symbols) {
    const existing = byFile.get(symbol.file) ?? [];
    existing.push(symbol);
    byFile.set(symbol.file, existing);
  }

  const orderedFiles = [...byFile.keys()].sort((a, b) => a.localeCompare(b));
  let output = '';

  for (const file of orderedFiles) {
    output += `### \`${file}\`\n`;
    const fileSymbols = byFile.get(file) ?? [];
    fileSymbols.sort((a, b) => {
      if (a.kind !== b.kind) {
        return kindOrder(a.kind) - kindOrder(b.kind);
      }
      return a.name.localeCompare(b.name);
    });

    for (const symbol of fileSymbols) {
      output += `- ${formatApiSymbol(symbol)}\n`;
    }
    output += '\n';
  }

  return output;
}

function formatApiSymbol(symbol: ApiSymbol): string {
  switch (symbol.kind) {
    case 'class': {
      const classSymbol = symbol as ApiClassSymbol;
      const traits: string[] = [];
      if (classSymbol.extendsType) {
        traits.push(`extends ${classSymbol.extendsType}`);
      }
      if (classSymbol.implementsTypes.length > 0) {
        traits.push(`implements ${classSymbol.implementsTypes.join(', ')}`);
      }
      const traitText = traits.length > 0 ? `; ${traits.join('; ')}` : '';
      return `\`${classSymbol.signature}\` from \`${classSymbol.file}\` (${classSymbol.methodCount} methods${traitText})`;
    }
    case 'function': {
      const functionSymbol = symbol as ApiFunctionSymbol;
      const asyncTag = functionSymbol.isAsync ? ' [async]' : '';
      return `\`${functionSymbol.signature}\` from \`${functionSymbol.file}\`${asyncTag}`;
    }
    case 'interface': {
      const interfaceSymbol = symbol as ApiInterfaceSymbol;
      return `\`${interfaceSymbol.signature}\` from \`${interfaceSymbol.file}\` (${interfaceSymbol.propertyCount} props, ${interfaceSymbol.methodCount} methods)`;
    }
    case 'type':
      return `\`${symbol.signature}\` from \`${symbol.file}\``;
    case 'variable': {
      const variableSymbol = symbol as ApiVariableSymbol;
      return `\`${variableSymbol.signature}\` from \`${variableSymbol.file}\` [${variableSymbol.variableKind}]`;
    }
  }
}

function detectPatterns(files: FileIndex[]): string[] {
  const inheritance = new Map<string, Set<string>>();
  const implementations = new Map<string, Set<string>>();

  for (const file of files) {
    for (const cls of file.classes) {
      if (cls.extends) {
        const existing = inheritance.get(cls.extends) ?? new Set<string>();
        existing.add(cls.name);
        inheritance.set(cls.extends, existing);
      }

      for (const iface of cls.implements ?? []) {
        const existing = implementations.get(iface) ?? new Set<string>();
        existing.add(cls.name);
        implementations.set(iface, existing);
      }
    }
  }

  const patterns: string[] = [];

  for (const [base, children] of inheritance.entries()) {
    if (children.size >= 2) {
      patterns.push(`**${base}** inheritance fan-out: ${[...children].sort((a, b) => a.localeCompare(b)).join(', ')}`);
    }
  }

  for (const [iface, implementers] of implementations.entries()) {
    if (implementers.size >= 2) {
      patterns.push(`**${iface}** implementations: ${[...implementers].sort((a, b) => a.localeCompare(b)).join(', ')}`);
    }
  }

  return patterns.sort((a, b) => a.localeCompare(b));
}

function renderPatterns(patterns: string[]): string {
  let output = '## Key Patterns\n\n';
  if (patterns.length === 0) {
    output += '*No repeated inheritance or interface-implementation patterns detected.*';
    return output;
  }

  for (const pattern of patterns) {
    output += `- ${pattern}\n`;
  }
  return output.trimEnd();
}

function getModuleName(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);

  if (parts.length === 0) {
    return '.';
  }

  if (parts[0] === 'src') {
    if (parts.length >= 3) {
      return `src/${parts[1]}`;
    }
    return 'src';
  }

  if (parts.length === 1) {
    return '.';
  }

  return parts[0] ?? '.';
}

function formatModuleLabel(moduleName: string): string {
  if (moduleName === '.') {
    return '(root)';
  }
  return moduleName.endsWith('/') ? moduleName : `${moduleName}/`;
}

function normalizeSignature(signature: string): string {
  return signature.replace(/\s+/g, ' ').trim();
}

function isExcludedArchitecturePath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  return (
    /(^|\/)(test|tests|__tests__|example|examples|build|dist|coverage)(\/|$)/i.test(normalized) ||
    /\.test\./.test(normalized) ||
    /\.spec\./.test(normalized)
  );
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}

async function safeGetFileImports(storage: SqliteStorage, filePath: string): Promise<StorageFileImport[]> {
  if (typeof storage.getFileImports !== 'function') {
    return [];
  }
  try {
    const imports = await storage.getFileImports(filePath);
    return imports as StorageFileImport[];
  } catch {
    return [];
  }
}

async function safeGetFileExports(storage: SqliteStorage, filePath: string): Promise<StorageFileExport[]> {
  if (typeof storage.getFileExports !== 'function') {
    return [];
  }
  try {
    const exportsList = await storage.getFileExports(filePath);
    return exportsList as StorageFileExport[];
  } catch {
    return [];
  }
}

async function safeListConfigFiles(
  storage: SqliteStorage,
  options: { configType?: string; directory?: string }
): Promise<StorageConfigFile[]> {
  if (typeof storage.listConfigFiles !== 'function') {
    return [];
  }
  try {
    const files = await storage.listConfigFiles(options);
    return files as StorageConfigFile[];
  } catch {
    return [];
  }
}

async function safeGetConfigValue(
  storage: SqliteStorage,
  configPath: string,
  filePath?: string
): Promise<StorageConfigValue[]> {
  if (typeof storage.getConfigValue !== 'function') {
    return [];
  }
  try {
    const values = await storage.getConfigValue(configPath, filePath);
    return values as StorageConfigValue[];
  } catch {
    return [];
  }
}
