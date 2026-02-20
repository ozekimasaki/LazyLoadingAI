/**
 * Type extraction and normalization for cross-language type search
 */

import type { Language } from '../types/index.js';

/**
 * Parsed type information with normalized fields
 */
export interface ParsedType {
  raw: string;
  normalized: string;
  base: string;
  inner: string[];  // Inner type arguments
  isAsync: boolean;
  isNullable: boolean;
  isArray: boolean;
  isGeneric: boolean;
  isOptional: boolean;
  hasDefault: boolean;
}

/**
 * Symbol type information for storage
 */
export interface SymbolTypeInfo {
  symbolId: string;
  symbolName: string;
  filePath: string;
  language: Language;
  returnType: ParsedType | null;
  parameters: Array<{
    index: number;
    name: string;
    type: ParsedType | null;
  }>;
  paramCount: number;
  isMethod: boolean;
  parentClass: string | null;
}

// Cross-language type normalizations
const TS_NORMALIZATIONS: Record<string, string> = {
  'string': 'String',
  'number': 'Number',
  'boolean': 'Boolean',
  'void': 'Void',
  'null': 'Null',
  'undefined': 'Undefined',
  'any': 'Any',
  'unknown': 'Unknown',
  'never': 'Never',
  'object': 'Object',
  'Array': 'Array',
  'Promise': 'Promise',
  'Map': 'Map',
  'Set': 'Set',
  'Date': 'Date',
  'Error': 'Error',
  'Function': 'Function',
  'Symbol': 'Symbol',
  'BigInt': 'BigInt',
  'Uint8Array': 'ByteArray',
  'Buffer': 'ByteArray',
  'ReadonlyArray': 'Array',
  'Awaited': 'Awaited',
  'Partial': 'Partial',
  'Required': 'Required',
  'Readonly': 'Readonly',
  'Record': 'Record',
  'Pick': 'Pick',
  'Omit': 'Omit',
  'Exclude': 'Exclude',
  'Extract': 'Extract',
  'NonNullable': 'NonNullable',
  'ReturnType': 'ReturnType',
  'Parameters': 'Parameters',
  'InstanceType': 'InstanceType',
};

const PY_NORMALIZATIONS: Record<string, string> = {
  'str': 'String',
  'int': 'Number',
  'float': 'Number',
  'bool': 'Boolean',
  'None': 'Void',
  'NoneType': 'Void',
  'bytes': 'ByteArray',
  'bytearray': 'ByteArray',
  'list': 'Array',
  'List': 'Array',
  'tuple': 'Tuple',
  'Tuple': 'Tuple',
  'dict': 'Map',
  'Dict': 'Map',
  'set': 'Set',
  'Set': 'Set',
  'frozenset': 'Set',
  'FrozenSet': 'Set',
  'Awaitable': 'Promise',
  'Coroutine': 'Promise',
  'Future': 'Promise',
  'Optional': 'Nullable',
  'Union': 'Union',
  'Callable': 'Function',
  'Any': 'Any',
  'object': 'Object',
  'type': 'Type',
  'Type': 'Type',
  'Sequence': 'Array',
  'Iterable': 'Iterable',
  'Iterator': 'Iterator',
  'Generator': 'Generator',
  'AsyncGenerator': 'AsyncGenerator',
  'Mapping': 'Map',
  'MutableMapping': 'Map',
  'TypeVar': 'TypeVar',
  'Generic': 'Generic',
};

/**
 * Parse a raw type string into structured ParsedType
 */
export function parseType(rawType: string | null, language: Language): ParsedType | null {
  if (!rawType || rawType === '' || rawType === 'void' || rawType === 'None') {
    return null;
  }

  const trimmed = rawType.trim();

  // Detect async/Promise wrapping
  const isAsync = /^(Promise|Awaitable|Coroutine|Future|Async)\s*[<\[]/i.test(trimmed);

  // Detect nullable types
  const isNullable =
    /\|\s*(null|undefined|None)$/i.test(trimmed) ||
    /^(null|undefined|None)\s*\|/i.test(trimmed) ||
    /^Optional\s*[\[<]/i.test(trimmed);

  // Detect array types
  const isArray =
    /\[\]$/.test(trimmed) ||
    /^Array\s*[<\[]/i.test(trimmed) ||
    /^(list|List|Sequence|ReadonlyArray)\s*[\[<]/i.test(trimmed);

  // Extract base type and inner types
  const { base, inner, isGeneric } = extractBaseAndInner(trimmed, language);

  // Normalize the base type
  const normalizations = language === 'python' ? PY_NORMALIZATIONS : TS_NORMALIZATIONS;
  const normalizedBase = normalizations[base] || base;

  // Normalize inner types
  const normalizedInner = inner.map(t => {
    const parsed = parseType(t, language);
    return parsed?.normalized || t;
  });

  // Build normalized representation
  let normalized = normalizedBase;
  if (normalizedInner.length > 0) {
    normalized = `${normalizedBase}<${normalizedInner.join(', ')}>`;
  }
  if (isArray && normalizedBase !== 'Array') {
    normalized = `Array<${normalized}>`;
  }
  if (isAsync && normalizedBase !== 'Promise') {
    normalized = `Promise<${normalized}>`;
  }
  if (isNullable) {
    normalized = `${normalized} | null`;
  }

  return {
    raw: rawType,
    normalized,
    base: normalizedBase,
    inner: normalizedInner,
    isAsync,
    isNullable,
    isArray,
    isGeneric,
    isOptional: false,
    hasDefault: false,
  };
}

/**
 * Extract base type and inner type arguments from a type string
 */
function extractBaseAndInner(typeStr: string, language: Language): { base: string; inner: string[]; isGeneric: boolean } {
  // Remove nullable parts for base extraction
  let cleanType = typeStr
    .replace(/\|\s*(null|undefined|None)/gi, '')
    .replace(/^(null|undefined|None)\s*\|/gi, '')
    .trim();

  // Handle TypeScript array shorthand: T[]
  const arrayMatch = cleanType.match(/^(.+)\[\]$/);
  if (arrayMatch && arrayMatch[1]) {
    return {
      base: 'Array',
      inner: [arrayMatch[1].trim()],
      isGeneric: true,
    };
  }

  // Handle generic types: Type<T, U> or Type[T, U]
  const genericMatch = language === 'python'
    ? cleanType.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\[(.+)\]$/)
    : cleanType.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*<(.+)>$/);

  if (genericMatch && genericMatch[1] && genericMatch[2]) {
    const base = genericMatch[1];
    const innerStr = genericMatch[2];
    const inner = splitTypeArguments(innerStr, language);
    return {
      base,
      inner,
      isGeneric: inner.length > 0,
    };
  }

  // Handle union types (only for base extraction, not recursively)
  if (cleanType.includes('|')) {
    const parts = cleanType.split('|').map(p => p.trim()).filter(p =>
      p.toLowerCase() !== 'null' &&
      p.toLowerCase() !== 'undefined' &&
      p.toLowerCase() !== 'none'
    );
    if (parts.length === 1 && parts[0]) {
      return extractBaseAndInner(parts[0], language);
    }
    return {
      base: 'Union',
      inner: parts,
      isGeneric: true,
    };
  }

  // Simple type (no generics)
  return {
    base: cleanType,
    inner: [],
    isGeneric: false,
  };
}

/**
 * Split type arguments respecting nested brackets
 */
function splitTypeArguments(argsStr: string, language: Language): string[] {
  const args: string[] = [];
  let current = '';
  let depth = 0;
  const openBracket = language === 'python' ? '[' : '<';
  const closeBracket = language === 'python' ? ']' : '>';

  for (const char of argsStr) {
    if (char === openBracket || char === '<' || char === '[' || char === '(') {
      depth++;
      current += char;
    } else if (char === closeBracket || char === '>' || char === ']' || char === ')') {
      depth--;
      current += char;
    } else if (char === ',' && depth === 0) {
      if (current.trim()) {
        args.push(current.trim());
      }
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    args.push(current.trim());
  }

  return args;
}

/**
 * Check if two types match based on different match modes
 */
export function typesMatch(
  type: ParsedType,
  searchType: string,
  matchMode: 'exact' | 'base' | 'inner' | 'partial',
  options: {
    includeAsyncVariants?: boolean;
    includeNullableVariants?: boolean;
  } = {}
): boolean {
  const searchParsed = parseType(searchType, 'typescript'); // Assume search is normalized
  if (!searchParsed) return false;

  switch (matchMode) {
    case 'exact':
      return type.normalized.toLowerCase() === searchParsed.normalized.toLowerCase();

    case 'base':
      // Match if base types are the same
      if (type.base.toLowerCase() === searchParsed.base.toLowerCase()) {
        return true;
      }
      // Also match T with Promise<T> if includeAsyncVariants
      if (options.includeAsyncVariants && type.isAsync) {
        return type.inner.some(inner =>
          inner.toLowerCase() === searchParsed.base.toLowerCase()
        );
      }
      return false;

    case 'inner':
      // Match if the search type appears in inner types
      return type.inner.some(inner =>
        inner.toLowerCase().includes(searchParsed.base.toLowerCase())
      );

    case 'partial':
      // Match if search type appears anywhere
      return type.normalized.toLowerCase().includes(searchParsed.base.toLowerCase()) ||
             type.base.toLowerCase().includes(searchParsed.base.toLowerCase());

    default:
      return false;
  }
}

/**
 * Extract type info from function signature
 */
export function extractFunctionTypeInfo(
  func: {
    id: string;
    name: string;
    parameters: Array<{ name: string; type: string | null; defaultValue: string | null; isOptional: boolean }>;
    returnType: string | null;
    kind: string;
    parentClass: string | null;
  },
  filePath: string,
  language: Language
): SymbolTypeInfo {
  const returnType = parseType(func.returnType, language);

  const parameters = func.parameters.map((param, index) => {
    const parsedType = parseType(param.type, language);
    if (parsedType) {
      parsedType.isOptional = param.isOptional;
      parsedType.hasDefault = param.defaultValue !== null;
    }
    return {
      index,
      name: param.name,
      type: parsedType,
    };
  });

  return {
    symbolId: func.id,
    symbolName: func.name,
    filePath,
    language,
    returnType,
    parameters,
    paramCount: parameters.length,
    isMethod: func.kind === 'method' || func.kind === 'constructor',
    parentClass: func.parentClass,
  };
}

/**
 * Search type info by return type
 */
export interface TypeSearchOptions {
  returnType?: string;
  paramType?: string;
  matchMode?: 'exact' | 'base' | 'inner' | 'partial';
  includeAsyncVariants?: boolean;
  includeNullableVariants?: boolean;
  language?: Language;
  limit?: number;
}

/**
 * Filter type info entries by search criteria
 */
export function filterByTypeSearch(
  entries: SymbolTypeInfo[],
  options: TypeSearchOptions
): SymbolTypeInfo[] {
  let results = [...entries];

  // Filter by language if specified
  if (options.language) {
    results = results.filter(e => e.language === options.language);
  }

  // Filter by return type
  if (options.returnType) {
    results = results.filter(entry => {
      if (!entry.returnType) return false;
      return typesMatch(
        entry.returnType,
        options.returnType!,
        options.matchMode || 'base',
        {
          includeAsyncVariants: options.includeAsyncVariants,
          includeNullableVariants: options.includeNullableVariants,
        }
      );
    });
  }

  // Filter by parameter type
  if (options.paramType) {
    results = results.filter(entry => {
      return entry.parameters.some(param => {
        if (!param.type) return false;
        return typesMatch(
          param.type,
          options.paramType!,
          options.matchMode || 'base',
          {
            includeAsyncVariants: options.includeAsyncVariants,
            includeNullableVariants: options.includeNullableVariants,
          }
        );
      });
    });
  }

  // Apply limit
  if (options.limit && results.length > options.limit) {
    results = results.slice(0, options.limit);
  }

  return results;
}

/**
 * Get normalized type for display
 */
export function getNormalizedTypeDisplay(type: ParsedType): string {
  return type.normalized;
}

/**
 * Get base type for indexing
 */
export function getBaseTypeForIndex(type: ParsedType): string {
  return type.base.toLowerCase();
}

/**
 * Get inner types as comma-separated string for indexing
 */
export function getInnerTypesForIndex(type: ParsedType): string {
  return type.inner.join(',').toLowerCase();
}
