/**
 * trace_types tool implementation
 * Trace hierarchy or implementation relationships for a class/interface.
 */

import type { Indexer } from '../../indexer/index.js';
import type { TypeRelationship } from '../../types/symbols.js';
import { enforceOutputBudget, formatCompactTable } from './compact-format.js';

export type TraceTypesMode = 'hierarchy' | 'implementations';
export type TraceTypeDirection = 'up' | 'down' | 'both';

export interface TraceTypesInput {
  className: string;
  mode?: TraceTypesMode;
  filePath?: string;
  direction?: TraceTypeDirection;
  limit?: number;
  format?: 'compact' | 'markdown';
}

type ToolResponse = { content: Array<{ type: 'text'; text: string }> };
type OutputMode = 'compact' | 'markdown';
type CompactTypeRow = { name: string; relationship: string; target: string; file: string };

const DEFAULT_MODE: TraceTypesMode = 'hierarchy';
const DEFAULT_DIRECTION: TraceTypeDirection = 'both';
const DEFAULT_LIMIT = 50;
const MIN_LIMIT = 1;
const MAX_LIMIT = 500;
const MAX_HIERARCHY_DEPTH = 5;
const DEFAULT_MAX_BYTES = 3000;

function normalizeMode(mode?: string): TraceTypesMode | null {
  if (mode === undefined) {
    return DEFAULT_MODE;
  }
  if (mode === 'hierarchy' || mode === 'implementations') {
    return mode;
  }
  return null;
}

function normalizeDirection(direction?: string): TraceTypeDirection | null {
  if (direction === undefined) {
    return DEFAULT_DIRECTION;
  }
  if (direction === 'up' || direction === 'down' || direction === 'both') {
    return direction;
  }
  return null;
}

function normalizeLimit(limit?: number): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }

  return Math.max(MIN_LIMIT, Math.min(MAX_LIMIT, Math.trunc(limit)));
}

function normalizeOutputMode(mode?: OutputMode): OutputMode {
  if (mode === 'compact' || mode === 'markdown') {
    return mode;
  }
  return 'compact';
}

function normalizeDisplayPath(filePath: string, rootDir: string): string {
  if (!filePath) return '';

  const normalizedFile = filePath.replace(/\\/g, '/');
  const normalizedRoot = rootDir.replace(/\\/g, '/');

  if (!normalizedRoot) return normalizedFile;
  if (normalizedFile === normalizedRoot) return normalizedFile;
  if (normalizedFile.startsWith(`${normalizedRoot}/`)) {
    return normalizedFile.slice(normalizedRoot.length + 1);
  }

  return normalizedFile;
}

async function resolveTypeFile(
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
  const storage = indexer.getStorage() as {
    getSymbolById?: (symbolId: string) => Promise<{ filePath: string } | null>;
  };

  let resolved = '';
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
      const matches = await indexer.searchSymbols(symbolName, { type: 'all', limit: 5 });
      const exact = matches.find((match) =>
        (match.symbol.kind === 'class' || match.symbol.kind === 'interface') &&
        match.symbol.name === symbolName
      ) ?? matches.find((match) => match.symbol.kind === 'class' || match.symbol.kind === 'interface');
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

async function toCompactRows(indexer: Indexer, relations: TypeRelationship[]): Promise<CompactTypeRow[]> {
  const fileCache = new Map<string, string>();

  return Promise.all(relations.map(async (relation) => ({
    name: relation.sourceName,
    relationship: relation.relationshipKind,
    target: relation.targetName,
    file: await resolveTypeFile(indexer, relation.sourceSymbolId, relation.sourceName, fileCache),
  })));
}

function dedupeRelationships(relations: TypeRelationship[]): TypeRelationship[] {
  const seen = new Set<string>();
  const deduped: TypeRelationship[] = [];

  for (const relation of relations) {
    const key = `${relation.sourceName}:${relation.relationshipKind}:${relation.targetName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(relation);
  }

  return deduped;
}

async function collectHierarchyRelationships(
  indexer: Indexer,
  className: string,
  direction: TraceTypeDirection
): Promise<TypeRelationship[]> {
  const relations: TypeRelationship[] = [];

  if (direction === 'up' || direction === 'both') {
    let frontier = [className];
    const visited = new Set<string>();

    for (let level = 1; level <= MAX_HIERARCHY_DEPTH && frontier.length > 0; level += 1) {
      const next = new Set<string>();
      for (const name of frontier) {
        if (visited.has(name)) continue;
        visited.add(name);

        const parents = await indexer.getTypeHierarchyByName(name);
        for (const relation of parents) {
          relations.push(relation);
          next.add(relation.targetName);
        }
      }
      frontier = [...next];
    }
  }

  if (direction === 'down' || direction === 'both') {
    let frontier = [className];
    const visited = new Set<string>();

    for (let level = 1; level <= MAX_HIERARCHY_DEPTH && frontier.length > 0; level += 1) {
      const next = new Set<string>();
      for (const name of frontier) {
        if (visited.has(name)) continue;
        visited.add(name);

        const children = await indexer.getSubtypes(name);
        for (const relation of children) {
          relations.push(relation);
          next.add(relation.sourceName);
        }
      }
      frontier = [...next];
    }
  }

  return dedupeRelationships(relations);
}

async function collectImplementationRelationships(
  indexer: Indexer,
  className: string,
  limit: number
): Promise<TypeRelationship[]> {
  const [implementations, subtypes] = await Promise.all([
    indexer.findImplementations(className),
    indexer.getSubtypes(className),
  ]);

  return dedupeRelationships([...implementations, ...subtypes]).slice(0, limit);
}

function renderCompactTypeRows(rows: CompactTypeRow[]): string {
  const columns = ['name', 'relationship', 'target', 'file'];
  return rows.length > 0
    ? formatCompactTable(rows, { columns })
    : columns.join('\t');
}

async function renderHierarchy(
  indexer: Indexer,
  className: string,
  direction: TraceTypeDirection
): Promise<string> {
  let output = `# Type Hierarchy for "${className}"\n\n`;

  if (direction === 'up' || direction === 'both') {
    const parents = await indexer.getTypeHierarchyByName(className);

    if (parents.length > 0) {
      output += `## Parent Types (${className} extends/implements)\n\n`;

      const extendsRelationships = parents.filter((relation) => relation.relationshipKind === 'extends');
      const implementsRelationships = parents.filter((relation) => relation.relationshipKind === 'implements');
      const mixinRelationships = parents.filter((relation) => relation.relationshipKind === 'mixin');

      if (extendsRelationships.length > 0) {
        output += '### Extends\n';
        for (const relation of extendsRelationships) {
          output += `- \`${relation.targetName}\`\n`;
        }
        output += '\n';
      }

      if (implementsRelationships.length > 0) {
        output += '### Implements\n';
        for (const relation of implementsRelationships) {
          output += `- \`${relation.targetName}\`\n`;
        }
        output += '\n';
      }

      if (mixinRelationships.length > 0) {
        output += '### Mixins\n';
        for (const relation of mixinRelationships) {
          output += `- \`${relation.targetName}\`\n`;
        }
        output += '\n';
      }

      const visited = new Set<string>([className]);
      let level = 1;
      let currentTypes = parents.map((parent) => parent.targetName);

      while (currentTypes.length > 0 && level < MAX_HIERARCHY_DEPTH) {
        const nextTypes: string[] = [];
        let foundAny = false;

        for (const typeName of currentTypes) {
          if (visited.has(typeName)) {
            continue;
          }

          visited.add(typeName);
          const ancestors = await indexer.getTypeHierarchyByName(typeName);

          if (ancestors.length > 0) {
            if (!foundAny) {
              output += `### Ancestor Types (Level ${level + 1})\n`;
              foundAny = true;
            }
            output += `**${typeName}** extends/implements:\n`;
            for (const ancestor of ancestors) {
              output += `- \`${ancestor.targetName}\` (${ancestor.relationshipKind})\n`;
              nextTypes.push(ancestor.targetName);
            }
            output += '\n';
          }
        }

        currentTypes = nextTypes;
        level += 1;
      }
    } else if (direction === 'up') {
      output += `No parent types found. "${className}" does not extend or implement any types.\n\n`;
    }
  }

  if (direction === 'down' || direction === 'both') {
    const children = await indexer.getSubtypes(className);

    if (children.length > 0) {
      output += `## Child Types (types that extend/implement ${className})\n\n`;

      const extending = children.filter((relation) => relation.relationshipKind === 'extends');
      const implementing = children.filter((relation) => relation.relationshipKind === 'implements');
      const mixingIn = children.filter((relation) => relation.relationshipKind === 'mixin');

      if (extending.length > 0) {
        output += `### Classes that extend ${className}\n`;
        for (const relation of extending) {
          output += `- \`${relation.sourceName}\`\n`;
        }
        output += '\n';
      }

      if (implementing.length > 0) {
        output += `### Classes that implement ${className}\n`;
        for (const relation of implementing) {
          output += `- \`${relation.sourceName}\`\n`;
        }
        output += '\n';
      }

      if (mixingIn.length > 0) {
        output += `### Classes that use ${className} as mixin\n`;
        for (const relation of mixingIn) {
          output += `- \`${relation.sourceName}\`\n`;
        }
        output += '\n';
      }

      const visited = new Set<string>([className]);
      let level = 1;
      let currentTypes = children.map((child) => child.sourceName);

      while (currentTypes.length > 0 && level < MAX_HIERARCHY_DEPTH) {
        const nextTypes: string[] = [];
        let foundAny = false;

        for (const typeName of currentTypes) {
          if (visited.has(typeName)) {
            continue;
          }

          visited.add(typeName);
          const descendants = await indexer.getSubtypes(typeName);

          if (descendants.length > 0) {
            if (!foundAny) {
              output += `### Descendant Types (Level ${level + 1})\n`;
              foundAny = true;
            }
            output += `**${typeName}** is extended/implemented by:\n`;
            for (const descendant of descendants) {
              output += `- \`${descendant.sourceName}\` (${descendant.relationshipKind})\n`;
              nextTypes.push(descendant.sourceName);
            }
            output += '\n';
          }
        }

        currentTypes = nextTypes;
        level += 1;
      }
    } else if (direction === 'down') {
      output += `No child types found. No types extend or implement "${className}".\n\n`;
    }
  }

  const [parents, children] = await Promise.all([
    indexer.getTypeHierarchyByName(className),
    indexer.getSubtypes(className),
  ]);

  if (parents.length === 0 && children.length === 0) {
    return `No type hierarchy found for "${className}"\n\nThis could mean:\n- The type doesn't extend or implement anything\n- No other types extend or implement it\n- The type might not be indexed (check spelling)\n- Try running 'resolve' command to link type relationships`;
  }

  output += '---\n\n';
  output += '**Tip**: Use `trace_types` with `mode: "implementations"` to find all implementations of an interface.\n';
  return output;
}

async function renderImplementations(
  indexer: Indexer,
  className: string,
  limit: number
): Promise<string> {
  const implementations = await indexer.findImplementations(className);
  const subtypes = await indexer.getSubtypes(className);

  const allRelationships = [...implementations, ...subtypes];
  const seen = new Set<string>();
  const unique = allRelationships.filter((relation) => {
    if (seen.has(relation.sourceName)) {
      return false;
    }
    seen.add(relation.sourceName);
    return true;
  });

  const totalCount = unique.length;
  const limited = unique.slice(0, limit);

  if (limited.length === 0) {
    const storage = indexer.getStorage();
    let diagnostics = `No implementations found for "${className}"\n\n`;

    const searchResults = await storage.searchSymbols(className, {
      type: 'all',
      limit: 10,
    });

    const exactMatches = searchResults.filter((result) =>
      (result.symbol.kind === 'interface' || result.symbol.kind === 'class') &&
      result.symbol.name === className
    );

    if (exactMatches.length > 0) {
      diagnostics += '**Diagnostics:**\n';
      diagnostics += `- Interface/class "${className}" exists in index: ✓\n`;
      diagnostics += `- Found in: ${exactMatches.map((match) => match.symbol.filePath).join(', ')}\n`;
      diagnostics += '- No classes implement or extend this type in the indexed codebase\n';
    } else {
      diagnostics += '**Possible issues:**\n';
      diagnostics += `- Interface/class "${className}" not found in index\n`;

      if (searchResults.length > 0) {
        const suggestions = searchResults
          .filter((result) => result.symbol.kind === 'interface' || result.symbol.kind === 'class')
          .slice(0, 3);

        if (suggestions.length > 0) {
          diagnostics += '\n**Did you mean:**\n';
          for (const suggestion of suggestions) {
            diagnostics += `- \`${suggestion.symbol.name}\` (${suggestion.symbol.kind})\n`;
          }
        }
      }

      if (!className.includes('<')) {
        diagnostics += '\n**Tip**: If searching for a generic type like `Repository<User>`, try just the base name `Repository`.\n';
      }
    }

    diagnostics += '\n**Other tips:**\n';
    diagnostics += '- Run `resolve` command to link type relationships\n';
    diagnostics += '- Check if the codebase has been indexed with `lazy-load index`\n';

    return diagnostics;
  }

  let output = `# Implementations of "${className}"\n\n`;
  output += `Found ${totalCount} implementation(s)`;
  if (totalCount > limit) {
    output += ` (showing first ${limit})`;
  }
  output += '\n\n';

  const extending = limited.filter((relation) => relation.relationshipKind === 'extends');
  const implementing = limited.filter((relation) => relation.relationshipKind === 'implements');
  const mixingIn = limited.filter((relation) => relation.relationshipKind === 'mixin');

  if (implementing.length > 0) {
    output += `## Classes that implement "${className}"\n\n`;
    output += '| Class | Relationship |\n';
    output += '|-------|-------------|\n';
    for (const relation of implementing) {
      output += `| \`${relation.sourceName}\` | implements |\n`;
    }
    output += '\n';
  }

  if (extending.length > 0) {
    output += `## Classes/Interfaces that extend "${className}"\n\n`;
    output += '| Type | Relationship |\n';
    output += '|------|-------------|\n';
    for (const relation of extending) {
      output += `| \`${relation.sourceName}\` | extends |\n`;
    }
    output += '\n';
  }

  if (mixingIn.length > 0) {
    output += `## Classes that use "${className}" as mixin\n\n`;
    output += '| Class | Relationship |\n';
    output += '|-------|-------------|\n';
    for (const relation of mixingIn) {
      output += `| \`${relation.sourceName}\` | mixin |\n`;
    }
    output += '\n';
  }

  output += '---\n\n';
  output += '**Tip**: Use `trace_types` with `mode: "hierarchy"` to see the full inheritance tree for any of these types.\n';
  return output;
}

export async function traceTypesTool(indexer: Indexer, input: TraceTypesInput): Promise<ToolResponse> {
  const className = input.className.trim();
  if (!className) {
    return {
      content: [{
        type: 'text',
        text: 'Invalid class_name. Provide a non-empty class or interface name.',
      }],
    };
  }

  const outputMode = normalizeOutputMode(input.format);
  const mode = normalizeMode(input.mode);
  if (!mode) {
    return {
      content: [{
        type: 'text',
        text: `Invalid mode "${String(input.mode)}". Use "hierarchy" or "implementations".`,
      }],
    };
  }

  // Kept for API compatibility; trace currently resolves by symbol name.
  void input.filePath;

  if (mode === 'hierarchy') {
    const direction = normalizeDirection(input.direction);
    if (!direction) {
      return {
        content: [{
          type: 'text',
          text: `Invalid direction "${String(input.direction)}". Use "up", "down", or "both".`,
        }],
      };
    }

    if (outputMode === 'compact') {
      const relations = await collectHierarchyRelationships(indexer, className, direction);
      if (relations.length === 0) {
        return {
          content: [{
            type: 'text',
            text: `No type hierarchy found for "${className}".`,
          }],
        };
      }

      const rows = await toCompactRows(indexer, relations);
      return {
        content: [{
          type: 'text',
          text: enforceOutputBudget(renderCompactTypeRows(rows), DEFAULT_MAX_BYTES),
        }],
      };
    }

    return {
      content: [{
        type: 'text',
        text: await renderHierarchy(indexer, className, direction),
      }],
    };
  }

  const limit = normalizeLimit(input.limit);
  if (outputMode === 'compact') {
    const relations = await collectImplementationRelationships(indexer, className, limit);
    if (relations.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `No implementations found for "${className}".`,
        }],
      };
    }

    const rows = await toCompactRows(indexer, relations);
    return {
      content: [{
        type: 'text',
        text: enforceOutputBudget(renderCompactTypeRows(rows), DEFAULT_MAX_BYTES),
      }],
    };
  }

  return {
    content: [{
      type: 'text',
      text: await renderImplementations(indexer, className, limit),
    }],
  };
}
