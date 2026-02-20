/**
 * Core symbol types for the LazyLoadingAI indexer
 */

export type SymbolKind = 'function' | 'method' | 'constructor' | 'callback' | 'class' | 'interface' | 'type' | 'variable' | 'property' | 'config';
export type Language = 'typescript' | 'javascript' | 'python' | 'config';

export interface Location {
  filePath: string;
  startLine: number;
  endLine: number;
  startColumn?: number;
  endColumn?: number;
}

export interface ParameterInfo {
  name: string;
  type: string | null;
  defaultValue: string | null;
  isOptional: boolean;
  isRest: boolean;
  documentation?: string;
}

export interface DocumentationInfo {
  description: string;
  params: Array<{ name: string; description: string }>;
  returns?: string;
  throws?: string[];
  examples?: string[];
  deprecated?: string | boolean;
  tags: Array<{ tag: string; text: string }>;
}

export interface FunctionModifiers {
  isAsync: boolean;
  isExported: boolean;
  isStatic: boolean;
  isPrivate: boolean;
  isProtected: boolean;
  isAbstract: boolean;
  isGenerator: boolean;
  callbackContext?: string;  // Context for callbacks: e.g., "describe", "it", "on:click"
}

export interface FunctionSignature {
  id: string;
  name: string;
  fullyQualifiedName: string;
  kind: 'function' | 'method' | 'constructor' | 'callback';
  signature: string;
  parameters: ParameterInfo[];
  returnType: string | null;
  documentation: DocumentationInfo | null;
  location: Location;
  modifiers: FunctionModifiers;
  parentClass: string | null;
  parentFunction: string | null;  // Parent function for nested functions (qualified name)
  nestingDepth: number;           // 0 = top-level, 1 = first nesting level, etc.
  localName: string;              // Unqualified name (same as name for top-level functions)
  decorators?: string[];
  typeParameters?: string[];
}

export interface PropertySignature {
  name: string;
  type: string | null;
  isOptional: boolean;
  isReadonly: boolean;
  isStatic: boolean;
  visibility: 'public' | 'private' | 'protected';
  defaultValue: string | null;
  documentation: DocumentationInfo | null;
}

export interface ClassSignature {
  id: string;
  name: string;
  fullyQualifiedName: string;
  signature: string;
  extends: string | null;
  implements: string[];
  methods: FunctionSignature[];
  properties: PropertySignature[];
  methodCount: number;
  propertyCount: number;
  constructorSignature: string | null;
  documentation: DocumentationInfo | null;
  location: Location;
  isExported: boolean;
  isAbstract: boolean;
  decorators?: string[];
  typeParameters?: string[];
}

export interface InterfaceSignature {
  id: string;
  name: string;
  fullyQualifiedName: string;
  signature: string;
  extends: string[];
  properties: PropertySignature[];
  methods: FunctionSignature[];
  documentation: DocumentationInfo | null;
  location: Location;
  isExported: boolean;
  typeParameters?: string[];
}

export interface TypeAliasSignature {
  id: string;
  name: string;
  fullyQualifiedName: string;
  signature: string;
  type: string;
  documentation: DocumentationInfo | null;
  location: Location;
  isExported: boolean;
  typeParameters?: string[];
}

export interface VariableSignature {
  id: string;
  name: string;
  fullyQualifiedName: string;
  type: string | null;
  kind: 'const' | 'let' | 'var';
  isExported: boolean;
  documentation: DocumentationInfo | null;
  location: Location;
}

export type Symbol =
  | FunctionSignature
  | ClassSignature
  | InterfaceSignature
  | TypeAliasSignature
  | VariableSignature;

export interface FileIndex {
  filePath: string;
  relativePath: string;
  language: Language;
  checksum: string;
  lastModified: number;
  functions: FunctionSignature[];
  classes: ClassSignature[];
  interfaces: InterfaceSignature[];
  typeAliases: TypeAliasSignature[];
  variables: VariableSignature[];
  imports: ImportInfo[];
  exports: ExportInfo[];
  references: SymbolReference[];
  calls: CallGraphEdge[];
  typeRelationships: TypeRelationship[];
  summary: string;
  lineCount: number;
  // Parse status tracking
  parseStatus?: ParseStatus;
  parseWarnings?: ParseWarning[];
  fileSize?: number;
}

export interface ImportInfo {
  source: string;
  specifiers: Array<{
    name: string;
    alias?: string;
    isDefault: boolean;
    isNamespace: boolean;
  }>;
  isTypeOnly: boolean;
}

export interface ExportInfo {
  name: string;
  alias?: string;
  isDefault: boolean;
  isReExport: boolean;
  source?: string;
}

// Reference tracking: where symbols are used
export type ReferenceKind = 'call' | 'read' | 'write' | 'type' | 'import';

export interface SymbolReference {
  id: string;
  symbolId: string;
  symbolName: string;
  referencingFile: string;
  referencingSymbolId?: string;
  referencingSymbolName?: string;
  lineNumber: number;
  columnNumber?: number;
  context: string;
  referenceKind: ReferenceKind;
}

// Call graph: function call relationships
export interface CallGraphEdge {
  id: string;
  callerSymbolId: string;
  callerName: string;
  calleeName: string;
  calleeSymbolId?: string;
  callCount: number;
  isAsync: boolean;
  isConditional: boolean;
}

// Type relationships: inheritance and implementation
export type RelationshipKind = 'extends' | 'implements' | 'mixin';

export interface TypeRelationship {
  id: string;
  sourceSymbolId: string;
  sourceName: string;
  targetName: string;
  targetSymbolId?: string;
  relationshipKind: RelationshipKind;
}

// Parse status tracking
export type ParseStatus = 'complete' | 'partial' | 'skipped';
export type ParseWarningCode = 'FILE_TOO_LARGE' | 'PARSE_ERROR' | 'TIMEOUT';

export interface ParseWarning {
  code: ParseWarningCode;
  message: string;
  details?: {
    fileSize?: number;
    maxSize?: number;
    lineCount?: number;
    errorMessage?: string;
  };
}
