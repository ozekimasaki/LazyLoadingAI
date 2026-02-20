/**
 * MCP Tool: get_module_dependencies - Show import/dependency graph for a file
 */

import path from 'node:path';
import type { Indexer } from '../../indexer/index.js';
import { enforceOutputBudget, formatCompactTable } from './compact-format.js';

export interface GetModuleDependenciesInput {
  filePath: string;
  depth?: number;
  includeReverse?: boolean;
  includeExternal?: boolean;
  includeTypeOnly?: boolean;
  detectCycles?: boolean;
  outputFormat?: 'tree' | 'list';
  format?: 'compact' | 'markdown';
  compact?: boolean;  // Return minimal format (just paths, no tables)
}

interface ImportInfo {
  source: string;
  resolvedPath: string | null;
  isExternal: boolean;
  isTypeOnly: boolean;
  specifiers: Array<{ name: string; alias?: string; isDefault: boolean; isNamespace: boolean }>;
}

const DEFAULT_MAX_BYTES = 3000;

function formatCompactDependencyOutput(
  imports: ImportInfo[],
  reverseDeps: Array<{ relativePath: string; specifiers: Array<{ name: string; alias?: string; isDefault: boolean; isNamespace: boolean }> }>,
  rootDir: string
): string {
  const importColumns = ['source', 'resolved', 'external', 'type_only', 'specifiers'];
  const reverseColumns = ['file', 'specifiers'];
  const importRows = imports.map((imp) => ({
    source: imp.source,
    resolved: imp.resolvedPath ? path.relative(rootDir, imp.resolvedPath) : '',
    external: imp.isExternal ? 'Y' : 'N',
    type_only: imp.isTypeOnly ? 'Y' : 'N',
    specifiers: formatSpecifiers(imp.specifiers),
  }));
  const reverseRows = reverseDeps.map((dep) => ({
    file: dep.relativePath,
    specifiers: formatSpecifiers(dep.specifiers),
  }));

  const sections = [
    '[IMPORTS]',
    importRows.length > 0
      ? formatCompactTable(importRows, { columns: importColumns })
      : importColumns.join('\t'),
    '[REVERSE_IMPORTS]',
    reverseRows.length > 0
      ? formatCompactTable(reverseRows, { columns: reverseColumns })
      : reverseColumns.join('\t'),
  ];

  return enforceOutputBudget(sections.join('\n'), DEFAULT_MAX_BYTES);
}

export async function getModuleDependenciesTool(
  indexer: Indexer,
  input: GetModuleDependenciesInput
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const storage = indexer.getStorage();
  const rootDir = indexer.getRootDir();

  // Normalize file path
  const filePath = path.isAbsolute(input.filePath)
    ? input.filePath
    : path.resolve(rootDir, input.filePath);

  // Get the file to check it exists
  const fileIndex = await storage.getFile(filePath);
  if (!fileIndex) {
    return {
      content: [{
        type: 'text',
        text: `File not indexed: ${input.filePath}. Run \`index\` first.`,
      }],
    };
  }

  const depth = Math.min(input.depth ?? 1, 5);
  const includeReverse = input.includeReverse ?? true;
  const includeExternal = input.includeExternal ?? true;
  const includeTypeOnly = input.includeTypeOnly ?? true;
  const detectCycles = input.detectCycles ?? false;
  const outputFormat = input.outputFormat ?? 'tree';
  const compact = input.format === 'compact' || (input.format === undefined && input.compact !== false);

  let output = `# Dependencies for ${fileIndex.relativePath}\n\n`;

  // Get direct imports
  const imports = await storage.getFileImports(filePath);

  // Filter imports based on options
  let filteredImports = imports;
  if (!includeExternal) {
    filteredImports = filteredImports.filter(i => !i.isExternal);
  }
  if (!includeTypeOnly) {
    filteredImports = filteredImports.filter(i => !i.isTypeOnly);
  }

  // Separate internal and external imports
  const internalImports = filteredImports.filter(i => !i.isExternal);
  const externalImports = filteredImports.filter(i => i.isExternal);

  const reverseDeps = includeReverse
    ? await storage.getReverseDependencies(filePath)
    : [];

  if (compact) {
    return {
      content: [{
        type: 'text',
        text: formatCompactDependencyOutput(filteredImports, reverseDeps, rootDir),
      }],
    };
  }

  output += `## Direct Imports (${filteredImports.length})\n\n`;

  if (internalImports.length > 0) {
    output += `### Internal (${internalImports.length})\n\n`;

    if (compact) {
      // Compact format: just paths with specifiers
      for (const imp of internalImports) {
        const specifierStr = formatSpecifiers(imp.specifiers);
        const relativePath = imp.resolvedPath
          ? path.relative(rootDir, imp.resolvedPath)
          : imp.source;
        const typeIndicator = imp.isTypeOnly ? ' (type)' : '';
        output += `- ${relativePath}: ${specifierStr}${typeIndicator}\n`;
      }
    } else {
      // Table format
      output += '| Module | Specifiers |\n';
      output += '|--------|------------|\n';

      for (const imp of internalImports) {
        const specifierStr = formatSpecifiers(imp.specifiers);
        const relativePath = imp.resolvedPath
          ? path.relative(rootDir, imp.resolvedPath)
          : imp.source;
        const typeIndicator = imp.isTypeOnly ? ' *(type)* ' : '';
        output += `| ${relativePath}${typeIndicator} | ${specifierStr} |\n`;
      }
    }
    output += '\n';
  }

  if (includeExternal && externalImports.length > 0) {
    output += `### External (${externalImports.length})\n\n`;

    if (compact) {
      // Compact format
      for (const imp of externalImports) {
        const specifierStr = formatSpecifiers(imp.specifiers);
        const typeIndicator = imp.isTypeOnly ? ' (type)' : '';
        output += `- ${imp.source}: ${specifierStr}${typeIndicator}\n`;
      }
    } else {
      // Table format
      output += '| Package | Specifiers |\n';
      output += '|---------|------------|\n';

      for (const imp of externalImports) {
        const specifierStr = formatSpecifiers(imp.specifiers);
        const typeIndicator = imp.isTypeOnly ? ' *(type)* ' : '';
        output += `| ${imp.source}${typeIndicator} | ${specifierStr} |\n`;
      }
    }
    output += '\n';
  }

  // Get reverse dependencies (files that import this file)
  if (includeReverse) {
    if (reverseDeps.length > 0) {
      output += `## Reverse Dependencies (${reverseDeps.length} files)\n\n`;
      for (const dep of reverseDeps) {
        const specifierStr = formatSpecifiers(dep.specifiers);
        output += `- ${dep.relativePath} → ${specifierStr}\n`;
      }
      output += '\n';
    } else {
      output += `## Reverse Dependencies\n\nNo files import this module.\n\n`;
    }
  }

  // Build dependency tree (for depth > 1)
  if (depth > 1) {
    const transitiveDeps = await storage.getTransitiveDependencies(filePath, depth);

    if (transitiveDeps.size > 1) {
      output += `## Dependency Tree (depth ${depth})\n\n`;

      if (outputFormat === 'tree') {
        output += formatDependencyTree(filePath, transitiveDeps, rootDir, includeExternal, depth);
      } else {
        output += formatDependencyList(transitiveDeps, rootDir, includeExternal);
      }
      output += '\n';
    }
  }

  // Detect circular dependencies
  if (detectCycles) {
    const cycles = await storage.detectCircularDependencies(filePath);

    if (cycles && cycles.length > 0) {
      output += `## ⚠️ Circular Dependencies Detected\n\n`;
      for (let i = 0; i < cycles.length; i++) {
        const cycle = cycles[i]!;
        output += `### Cycle ${i + 1}\n`;
        output += '```\n';
        output += cycle.map(p => path.relative(rootDir, p)).join(' → ');
        output += '\n```\n\n';
      }
    } else if (detectCycles) {
      output += `## Circular Dependencies\n\nNo circular dependencies detected.\n\n`;
    }
  }

  return {
    content: [{
      type: 'text',
      text: output.trim(),
    }],
  };
}

function formatSpecifiers(
  specifiers: Array<{ name: string; alias?: string; isDefault: boolean; isNamespace: boolean }>
): string {
  if (specifiers.length === 0) {
    return '*side-effect import*';
  }

  const parts: string[] = [];
  for (const spec of specifiers) {
    if (spec.isDefault) {
      parts.push(spec.alias ? `default as ${spec.alias}` : 'default');
    } else if (spec.isNamespace) {
      parts.push(`* as ${spec.alias ?? spec.name}`);
    } else if (spec.alias && spec.alias !== spec.name) {
      parts.push(`${spec.name} as ${spec.alias}`);
    } else {
      parts.push(spec.name);
    }
  }

  const result = parts.join(', ');
  return result.length > 50 ? result.slice(0, 47) + '...' : result;
}

function formatDependencyTree(
  rootFile: string,
  deps: Map<string, { depth: number; imports: Array<{ source: string; isExternal: boolean; isTypeOnly: boolean }> }>,
  rootDir: string,
  includeExternal: boolean,
  maxDepth: number
): string {
  const lines: string[] = [];
  const visited = new Set<string>();

  function buildTree(filePath: string, prefix: string, isLast: boolean, currentDepth: number): void {
    if (currentDepth > maxDepth || visited.has(filePath)) {
      if (visited.has(filePath)) {
        lines.push(`${prefix}${isLast ? '└── ' : '├── '}${path.relative(rootDir, filePath)} (circular)`);
      }
      return;
    }

    visited.add(filePath);
    const relativePath = path.relative(rootDir, filePath);
    lines.push(`${prefix}${isLast ? '└── ' : '├── '}${relativePath}`);

    const depInfo = deps.get(filePath);
    if (!depInfo) return;

    const imports = depInfo.imports.filter(i => {
      if (!includeExternal && i.isExternal) return false;
      return true;
    });

    const newPrefix = prefix + (isLast ? '    ' : '│   ');

    for (let i = 0; i < imports.length; i++) {
      const imp = imports[i]!;
      const isLastChild = i === imports.length - 1;

      if (imp.isExternal) {
        lines.push(`${newPrefix}${isLastChild ? '└── ' : '├── '}${imp.source} [external]`);
      } else {
        // Find the resolved path in deps
        const resolvedEntry = Array.from(deps.entries()).find(([, v]) =>
          v.imports.some(vi => vi.source === imp.source && v.depth === depInfo.depth + 1)
        );
        if (resolvedEntry) {
          buildTree(resolvedEntry[0], newPrefix, isLastChild, currentDepth + 1);
        } else {
          lines.push(`${newPrefix}${isLastChild ? '└── ' : '├── '}${imp.source}`);
        }
      }
    }
  }

  buildTree(rootFile, '', true, 0);

  return '```\n' + lines.join('\n') + '\n```';
}

function formatDependencyList(
  deps: Map<string, { depth: number; imports: Array<{ source: string; isExternal: boolean; isTypeOnly: boolean }> }>,
  rootDir: string,
  includeExternal: boolean
): string {
  const lines: string[] = [];

  // Group by depth
  const byDepth = new Map<number, string[]>();
  for (const [filePath, info] of deps) {
    const existing = byDepth.get(info.depth) ?? [];
    existing.push(filePath);
    byDepth.set(info.depth, existing);
  }

  for (const [depth, files] of Array.from(byDepth.entries()).sort((a, b) => a[0] - b[0])) {
    lines.push(`### Depth ${depth}`);
    for (const file of files) {
      lines.push(`- ${path.relative(rootDir, file)}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
