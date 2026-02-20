/**
 * Type resolution for context bundling
 * Extracts and resolves type definitions used by a function
 */

import type { SqliteStorage } from '../../../indexer/storage/sqlite.js';
import type {
  FunctionSignature,
  InterfaceSignature,
  TypeAliasSignature,
  ClassSignature,
} from '../../../types/symbols.js';

export interface TypeDefinition {
  name: string;
  kind: 'interface' | 'type' | 'class';
  filePath: string;
  startLine: number;
  endLine: number;
  source?: string;
}

/**
 * Parse a type string to extract type names
 * Handles generics, unions, intersections, arrays, etc.
 */
export function extractTypeNames(typeStr: string | null): string[] {
  if (!typeStr) return [];

  const names = new Set<string>();

  // Remove common wrapper types and extract inner types
  const cleaned = typeStr
    .replace(/\s+/g, ' ')
    .trim();

  // Extract type names using regex
  // This handles: TypeName, TypeName<Inner>, TypeName[], etc.
  const typePattern = /\b([A-Z][a-zA-Z0-9_]*)\b/g;
  let match;

  while ((match = typePattern.exec(cleaned)) !== null) {
    const typeName = match[1]!;
    // Filter out built-in types
    if (!isBuiltInType(typeName)) {
      names.add(typeName);
    }
  }

  return Array.from(names);
}

/**
 * Check if a type is a built-in TypeScript/JavaScript type
 */
function isBuiltInType(typeName: string): boolean {
  const builtIns = new Set([
    // Primitives
    'String', 'Number', 'Boolean', 'Symbol', 'BigInt',
    'Object', 'Function', 'Array', 'Map', 'Set', 'WeakMap', 'WeakSet',
    // Promise and async
    'Promise', 'PromiseLike', 'AsyncIterator', 'AsyncIterable',
    // Utility types
    'Partial', 'Required', 'Readonly', 'Record', 'Pick', 'Omit',
    'Exclude', 'Extract', 'NonNullable', 'Parameters', 'ReturnType',
    'ConstructorParameters', 'InstanceType', 'ThisParameterType',
    'OmitThisParameter', 'ThisType', 'Uppercase', 'Lowercase',
    'Capitalize', 'Uncapitalize',
    // Other common types
    'Date', 'Error', 'RegExp', 'JSON', 'Math', 'Console',
    'ArrayBuffer', 'SharedArrayBuffer', 'DataView',
    'Int8Array', 'Uint8Array', 'Uint8ClampedArray',
    'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array',
    'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array',
    // Node types
    'Buffer', 'ReadableStream', 'WritableStream', 'Blob', 'File',
    // Common generic markers
    'T', 'K', 'V', 'U', 'R', 'P', 'S',
  ]);

  return builtIns.has(typeName);
}

/**
 * Resolve all types used by a function
 */
export async function resolveAllTypes(
  func: FunctionSignature,
  storage: SqliteStorage
): Promise<TypeDefinition[]> {
  const typeNames = new Set<string>();

  // Extract type names from return type
  for (const name of extractTypeNames(func.returnType)) {
    typeNames.add(name);
  }

  // Extract type names from parameters
  for (const param of func.parameters) {
    for (const name of extractTypeNames(param.type)) {
      typeNames.add(name);
    }
  }

  // Extract type names from type parameters
  if (func.typeParameters) {
    for (const tp of func.typeParameters) {
      // Type parameters might have constraints like "T extends Foo"
      const constraintMatch = tp.match(/extends\s+(\w+)/);
      if (constraintMatch) {
        const constraintType = constraintMatch[1]!;
        if (!isBuiltInType(constraintType)) {
          typeNames.add(constraintType);
        }
      }
    }
  }

  // Resolve each type name to its definition
  const definitions: TypeDefinition[] = [];

  for (const typeName of typeNames) {
    const def = await resolveTypeName(typeName, storage);
    if (def) {
      definitions.push(def);
    }
  }

  return definitions;
}

/**
 * Resolve a type name to its definition
 */
async function resolveTypeName(
  typeName: string,
  storage: SqliteStorage
): Promise<TypeDefinition | null> {
  // Search for interface, type alias, or class with this name
  const results = await storage.searchSymbols(typeName, {
    type: 'all',
    limit: 10,
  });

  for (const result of results) {
    // Must be an exact name match
    if (result.symbol.name !== typeName) continue;

    if (result.symbol.kind === 'interface') {
      const iface = await storage.getInterface(result.symbol.filePath, result.symbol.name);
      if (iface) {
        return {
          name: iface.name,
          kind: 'interface',
          filePath: iface.location.filePath,
          startLine: iface.location.startLine,
          endLine: iface.location.endLine,
        };
      }
    } else if (result.symbol.kind === 'type') {
      const typeAlias = await storage.getTypeAlias(result.symbol.filePath, result.symbol.name);
      if (typeAlias) {
        return {
          name: typeAlias.name,
          kind: 'type',
          filePath: typeAlias.location.filePath,
          startLine: typeAlias.location.startLine,
          endLine: typeAlias.location.endLine,
        };
      }
    } else if (result.symbol.kind === 'class') {
      const cls = await storage.getClass(result.symbol.filePath, result.symbol.name);
      if (cls) {
        return {
          name: cls.name,
          kind: 'class',
          filePath: cls.location.filePath,
          startLine: cls.location.startLine,
          endLine: cls.location.endLine,
        };
      }
    }
  }

  return null;
}

/**
 * Get source code for a type definition
 */
export async function getTypeSource(
  def: TypeDefinition,
  storage: SqliteStorage,
  rootDir: string
): Promise<string | null> {
  try {
    const fs = await import('node:fs');
    const content = await fs.promises.readFile(def.filePath, 'utf-8');
    const lines = content.split('\n');

    // Extract the relevant lines
    const startIdx = Math.max(0, def.startLine - 1);
    const endIdx = Math.min(lines.length, def.endLine);

    return lines.slice(startIdx, endIdx).join('\n');
  } catch {
    return null;
  }
}
