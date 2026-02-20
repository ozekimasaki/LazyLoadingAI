/**
 * TypeScript/JavaScript parser using ts-morph
 */

import {
  Project,
  SourceFile,
  FunctionDeclaration,
  MethodDeclaration,
  ClassDeclaration,
  InterfaceDeclaration,
  TypeAliasDeclaration,
  VariableDeclaration,
  VariableDeclarationKind,
  ConstructorDeclaration,
  PropertyDeclaration,
  PropertySignature as TSPropertySignature,
  MethodSignature,
  ParameterDeclaration,
  JSDoc,
  SyntaxKind,
  Node,
  ArrowFunction,
  FunctionExpression,
  CallExpression,
  Scope,
} from 'ts-morph';

import type {
  Language,
  FunctionSignature,
  ClassSignature,
  InterfaceSignature,
  TypeAliasSignature,
  VariableSignature,
  PropertySignature,
  ParameterInfo,
  DocumentationInfo,
  FunctionModifiers,
  ImportInfo,
  ExportInfo,
  Location,
  SymbolReference,
  CallGraphEdge,
  TypeRelationship,
  ReferenceKind,
} from '../../types/index.js';

import { LanguageParser, type ParseResult, type ParseError, type ParserOptions } from './base.js';

// Test framework functions that commonly use callbacks
const TEST_FRAMEWORK_FUNCTIONS = new Set([
  'describe', 'it', 'test', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll',
  'suite', 'spec', 'context', 'before', 'after'
]);

// Method names that commonly take meaningful callbacks
const CALLBACK_METHOD_NAMES = new Set([
  'then', 'catch', 'finally', 'on', 'once', 'addEventListener',
  'action', 'command', 'option', 'use', 'subscribe', 'handle'
]);

// Method names whose callbacks should be skipped (array operations, etc.)
const SKIP_CALLBACK_METHODS = new Set([
  'map', 'filter', 'reduce', 'forEach', 'find', 'some', 'every',
  'flatMap', 'sort', 'findIndex', 'reduceRight'
]);

export class TypeScriptParser extends LanguageParser {
  private project: Project;

  constructor(options: ParserOptions = {}) {
    super(options);
    this.project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        target: 99, // ESNext
        module: 99, // ESNext
        strict: false,
        allowJs: true,
        checkJs: false,
        skipLibCheck: true,
        noEmit: true,
      },
    });
  }

  get language(): Language {
    return 'typescript';
  }

  get extensions(): string[] {
    return ['ts', 'tsx', 'js', 'jsx', 'mts', 'cts', 'mjs', 'cjs'];
  }

  canParse(filePath: string): boolean {
    const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
    return this.extensions.includes(ext);
  }

  async parseFile(filePath: string, content: string): Promise<ParseResult> {
    const errors: ParseError[] = [];

    if (this.isFileTooLarge(content)) {
      return {
        functions: [],
        classes: [],
        interfaces: [],
        typeAliases: [],
        variables: [],
        imports: [],
        exports: [],
        references: [],
        calls: [],
        typeRelationships: [],
        errors: [{ message: 'File too large to parse', severity: 'warning' }],
      };
    }

    // Create or update the source file
    let sourceFile = this.project.getSourceFile(filePath);
    if (sourceFile) {
      sourceFile.replaceWithText(content);
    } else {
      sourceFile = this.project.createSourceFile(filePath, content, { overwrite: true });
    }

    try {
      const functions = this.extractFunctions(sourceFile, filePath);
      const classes = this.extractClasses(sourceFile, filePath);
      const interfaces = this.extractInterfaces(sourceFile, filePath);
      const typeAliases = this.extractTypeAliases(sourceFile, filePath);
      const variables = this.extractVariables(sourceFile, filePath);
      const imports = this.extractImports(sourceFile);
      const exports = this.extractExports(sourceFile);

      // Extract references, calls, and type relationships
      const references = this.extractReferences(sourceFile, filePath, content, functions, classes);
      const calls = this.extractCalls(sourceFile, filePath, functions, classes);
      const typeRelationships = this.extractTypeRelationships(sourceFile, filePath, classes, interfaces);

      return {
        functions,
        classes,
        interfaces,
        typeAliases,
        variables,
        imports,
        exports,
        references,
        calls,
        typeRelationships,
        errors,
      };
    } catch (error) {
      errors.push({
        message: error instanceof Error ? error.message : String(error),
        severity: 'error',
      });

      return {
        functions: [],
        classes: [],
        interfaces: [],
        typeAliases: [],
        variables: [],
        imports: [],
        exports: [],
        references: [],
        calls: [],
        typeRelationships: [],
        errors,
      };
    }
  }

  private extractFunctions(sourceFile: SourceFile, filePath: string): FunctionSignature[] {
    const functions: FunctionSignature[] = [];

    // Get function declarations
    for (const func of sourceFile.getFunctions()) {
      const sig = this.parseFunctionDeclaration(func, filePath, null);
      if (sig && this.shouldIncludeSymbol(sig.modifiers.isPrivate)) {
        functions.push(sig);
        // Extract nested functions
        const nestedFunctions = this.extractNestedFunctions(func, filePath, sig.name, 1);
        functions.push(...nestedFunctions);
      }
    }

    // Get arrow functions and function expressions assigned to variables
    for (const varDecl of sourceFile.getVariableDeclarations()) {
      const initializer = varDecl.getInitializer();
      if (initializer && (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))) {
        const sig = this.parseArrowOrFunctionExpression(varDecl, initializer, filePath);
        if (sig && this.shouldIncludeSymbol(sig.modifiers.isPrivate)) {
          functions.push(sig);
          // Extract nested functions
          const nestedFunctions = this.extractNestedFunctions(initializer, filePath, sig.name, 1);
          functions.push(...nestedFunctions);
        }
      }
    }

    // Extract callbacks from call expressions (test functions, event handlers, etc.)
    const callbacks = this.extractCallbacks(sourceFile, filePath);
    functions.push(...callbacks);

    return functions;
  }

  /**
   * Maximum nesting depth for nested function extraction
   */
  private static readonly MAX_NESTING_DEPTH = 3;

  /**
   * Minimum lines for a nested function to be considered significant
   */
  private static readonly MIN_NESTED_FUNCTION_LINES = 3;

  /**
   * Extract nested functions from a function body
   */
  private extractNestedFunctions(
    parentNode: FunctionDeclaration | ArrowFunction | FunctionExpression,
    filePath: string,
    parentQualifiedName: string,
    depth: number
  ): FunctionSignature[] {
    if (depth > TypeScriptParser.MAX_NESTING_DEPTH) {
      return [];
    }

    const nestedFunctions: FunctionSignature[] = [];
    const body = parentNode.getBody();
    if (!body) return nestedFunctions;

    // Find nested function declarations
    for (const nestedFunc of body.getDescendantsOfKind(SyntaxKind.FunctionDeclaration)) {
      // Skip if the function is inside another nested function (will be handled by recursion)
      if (this.hasIntermediateFunctionAncestor(nestedFunc, parentNode)) {
        continue;
      }

      const sig = this.parseNestedFunctionDeclaration(nestedFunc, filePath, parentQualifiedName, depth);
      if (sig && this.shouldIncludeSymbol(sig.modifiers.isPrivate)) {
        nestedFunctions.push(sig);
        // Recursively extract nested functions
        const deeperNested = this.extractNestedFunctions(nestedFunc, filePath, sig.name, depth + 1);
        nestedFunctions.push(...deeperNested);
      }
    }

    // Find arrow functions and function expressions assigned to const/let inside the body
    for (const varDecl of body.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      // Skip if inside another nested function
      if (this.hasIntermediateFunctionAncestor(varDecl, parentNode)) {
        continue;
      }

      const initializer = varDecl.getInitializer();
      if (initializer && (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))) {
        const sig = this.parseNestedArrowOrFunctionExpression(
          varDecl,
          initializer,
          filePath,
          parentQualifiedName,
          depth
        );
        if (sig && this.shouldIncludeSymbol(sig.modifiers.isPrivate)) {
          nestedFunctions.push(sig);
          // Recursively extract nested functions
          const deeperNested = this.extractNestedFunctions(initializer, filePath, sig.name, depth + 1);
          nestedFunctions.push(...deeperNested);
        }
      }
    }

    return nestedFunctions;
  }

  /**
   * Check if a node has an intermediate function ancestor between it and the specified parent
   */
  private hasIntermediateFunctionAncestor(node: Node, stopAt: Node): boolean {
    let current = node.getParent();
    while (current && current !== stopAt) {
      if (
        Node.isFunctionDeclaration(current) ||
        Node.isArrowFunction(current) ||
        Node.isFunctionExpression(current) ||
        Node.isMethodDeclaration(current)
      ) {
        return true;
      }
      current = current.getParent();
    }
    return false;
  }

  /**
   * Parse a nested function declaration
   */
  private parseNestedFunctionDeclaration(
    func: FunctionDeclaration,
    filePath: string,
    parentQualifiedName: string,
    depth: number
  ): FunctionSignature | null {
    const localName = func.getName();
    if (!localName) return null;

    const startLine = func.getStartLineNumber();
    const endLine = func.getEndLineNumber();

    // Skip functions that are too small
    if (endLine - startLine + 1 < TypeScriptParser.MIN_NESTED_FUNCTION_LINES) {
      return null;
    }

    const location: Location = { filePath, startLine, endLine };
    const qualifiedName = `${parentQualifiedName}.${localName}`;

    const parameters = this.parseParameters(func.getParameters());
    const returnType = func.getReturnType().getText(func);
    const documentation = this.parseJsDoc(func.getJsDocs());
    const typeParameters = func.getTypeParameters().map(tp => tp.getText());

    const modifiers: FunctionModifiers = {
      isAsync: func.isAsync(),
      isExported: false, // Nested functions can't be exported
      isStatic: false,
      isPrivate: localName.startsWith('_'),
      isProtected: false,
      isAbstract: false,
      isGenerator: func.isGenerator(),
    };

    const signature = this.buildFunctionSignature(localName, parameters, returnType, modifiers, typeParameters);

    return {
      id: this.generateId(filePath, qualifiedName, 'function', startLine),
      name: qualifiedName,
      fullyQualifiedName: this.generateFullyQualifiedName(filePath, qualifiedName),
      kind: 'function',
      signature,
      parameters,
      returnType,
      documentation,
      location,
      modifiers,
      parentClass: null,
      parentFunction: parentQualifiedName,
      nestingDepth: depth,
      localName,
      typeParameters: typeParameters.length > 0 ? typeParameters : undefined,
    };
  }

  /**
   * Parse a nested arrow function or function expression
   */
  private parseNestedArrowOrFunctionExpression(
    varDecl: VariableDeclaration,
    func: ArrowFunction | FunctionExpression,
    filePath: string,
    parentQualifiedName: string,
    depth: number
  ): FunctionSignature | null {
    const localName = varDecl.getName();
    if (!localName) return null;

    const statement = varDecl.getVariableStatement();
    const startLine = statement?.getStartLineNumber() ?? varDecl.getStartLineNumber();
    const endLine = func.getEndLineNumber();

    // Skip functions that are too small
    if (endLine - startLine + 1 < TypeScriptParser.MIN_NESTED_FUNCTION_LINES) {
      return null;
    }

    const location: Location = { filePath, startLine, endLine };
    const qualifiedName = `${parentQualifiedName}.${localName}`;

    const parameters = this.parseParameters(func.getParameters());
    const returnType = func.getReturnType().getText(func);
    const documentation = statement ? this.parseJsDoc(statement.getJsDocs()) : null;
    const typeParameters = func.getTypeParameters().map(tp => tp.getText());

    const modifiers: FunctionModifiers = {
      isAsync: func.isAsync(),
      isExported: false, // Nested functions can't be exported
      isStatic: false,
      isPrivate: localName.startsWith('_'),
      isProtected: false,
      isAbstract: false,
      isGenerator: Node.isFunctionExpression(func) ? func.isGenerator() : false,
    };

    const signature = this.buildFunctionSignature(localName, parameters, returnType, modifiers, typeParameters);

    return {
      id: this.generateId(filePath, qualifiedName, 'function', startLine),
      name: qualifiedName,
      fullyQualifiedName: this.generateFullyQualifiedName(filePath, qualifiedName),
      kind: 'function',
      signature,
      parameters,
      returnType,
      documentation,
      location,
      modifiers,
      parentClass: null,
      parentFunction: parentQualifiedName,
      nestingDepth: depth,
      localName,
      typeParameters: typeParameters.length > 0 ? typeParameters : undefined,
    };
  }

  private parseFunctionDeclaration(
    func: FunctionDeclaration,
    filePath: string,
    parentClass: string | null
  ): FunctionSignature | null {
    const name = func.getName();
    if (!name) return null;

    const startLine = func.getStartLineNumber();
    const endLine = func.getEndLineNumber();
    const location: Location = { filePath, startLine, endLine };

    const parameters = this.parseParameters(func.getParameters());
    const returnType = func.getReturnType().getText(func);
    const documentation = this.parseJsDoc(func.getJsDocs());
    const typeParameters = func.getTypeParameters().map(tp => tp.getText());

    const modifiers: FunctionModifiers = {
      isAsync: func.isAsync(),
      isExported: func.isExported(),
      isStatic: false,
      isPrivate: name.startsWith('_'),
      isProtected: false,
      isAbstract: false,
      isGenerator: func.isGenerator(),
    };

    const signature = this.buildFunctionSignature(name, parameters, returnType, modifiers, typeParameters);

    return {
      id: this.generateId(filePath, name, 'function', startLine),
      name,
      fullyQualifiedName: this.generateFullyQualifiedName(filePath, name, parentClass ?? undefined),
      kind: 'function',
      signature,
      parameters,
      returnType,
      documentation,
      location,
      modifiers,
      parentClass,
      parentFunction: null,
      nestingDepth: 0,
      localName: name,
      typeParameters: typeParameters.length > 0 ? typeParameters : undefined,
    };
  }

  private parseArrowOrFunctionExpression(
    varDecl: VariableDeclaration,
    func: ArrowFunction | FunctionExpression,
    filePath: string
  ): FunctionSignature | null {
    const name = varDecl.getName();
    if (!name) return null;

    const statement = varDecl.getVariableStatement();
    const startLine = statement?.getStartLineNumber() ?? varDecl.getStartLineNumber();
    const endLine = func.getEndLineNumber();
    const location: Location = { filePath, startLine, endLine };

    const parameters = this.parseParameters(func.getParameters());
    const returnType = func.getReturnType().getText(func);
    const documentation = statement ? this.parseJsDoc(statement.getJsDocs()) : null;
    const typeParameters = func.getTypeParameters().map(tp => tp.getText());

    const isExported = statement?.isExported() ?? false;

    const modifiers: FunctionModifiers = {
      isAsync: func.isAsync(),
      isExported,
      isStatic: false,
      isPrivate: name.startsWith('_'),
      isProtected: false,
      isAbstract: false,
      isGenerator: Node.isFunctionExpression(func) ? func.isGenerator() : false,
    };

    const signature = this.buildFunctionSignature(name, parameters, returnType, modifiers, typeParameters);

    return {
      id: this.generateId(filePath, name, 'function', startLine),
      name,
      fullyQualifiedName: this.generateFullyQualifiedName(filePath, name),
      kind: 'function',
      signature,
      parameters,
      returnType,
      documentation,
      location,
      modifiers,
      parentClass: null,
      parentFunction: null,
      nestingDepth: 0,
      localName: name,
      typeParameters: typeParameters.length > 0 ? typeParameters : undefined,
    };
  }

  private extractClasses(sourceFile: SourceFile, filePath: string): ClassSignature[] {
    const classes: ClassSignature[] = [];

    for (const classDecl of sourceFile.getClasses()) {
      const sig = this.parseClassDeclaration(classDecl, filePath);
      if (sig) {
        classes.push(sig);
      }
    }

    return classes;
  }

  private parseClassDeclaration(classDecl: ClassDeclaration, filePath: string): ClassSignature | null {
    const name = classDecl.getName();
    if (!name) return null;

    const startLine = classDecl.getStartLineNumber();
    const endLine = classDecl.getEndLineNumber();
    const location: Location = { filePath, startLine, endLine };

    const extendsClause = classDecl.getExtends();
    const extendsName = extendsClause?.getText() ?? null;

    const implementsNames = classDecl.getImplements().map(i => i.getText());

    const methods = this.parseClassMethods(classDecl, filePath, name);
    const properties = this.parseClassProperties(classDecl);
    const constructorSig = this.parseConstructor(classDecl, filePath, name);

    const documentation = this.parseJsDoc(classDecl.getJsDocs());
    const typeParameters = classDecl.getTypeParameters().map(tp => tp.getText());

    const decorators = classDecl.getDecorators().map(d => d.getText());

    const signature = this.buildClassSignature(name, extendsName, implementsNames, typeParameters);

    return {
      id: this.generateId(filePath, name, 'class', startLine),
      name,
      fullyQualifiedName: this.generateFullyQualifiedName(filePath, name),
      signature,
      extends: extendsName,
      implements: implementsNames,
      methods,
      properties,
      methodCount: methods.length,
      propertyCount: properties.length,
      constructorSignature: constructorSig?.signature ?? null,
      documentation,
      location,
      isExported: classDecl.isExported(),
      isAbstract: classDecl.isAbstract(),
      decorators: decorators.length > 0 ? decorators : undefined,
      typeParameters: typeParameters.length > 0 ? typeParameters : undefined,
    };
  }

  private parseClassMethods(
    classDecl: ClassDeclaration,
    filePath: string,
    className: string
  ): FunctionSignature[] {
    const methods: FunctionSignature[] = [];

    for (const method of classDecl.getMethods()) {
      const sig = this.parseMethodDeclaration(method, filePath, className);
      if (sig && this.shouldIncludeSymbol(sig.modifiers.isPrivate)) {
        methods.push(sig);
      }
    }

    return methods;
  }

  private parseMethodDeclaration(
    method: MethodDeclaration,
    filePath: string,
    className: string
  ): FunctionSignature {
    const name = method.getName();
    const startLine = method.getStartLineNumber();
    const endLine = method.getEndLineNumber();
    const location: Location = { filePath, startLine, endLine };

    const parameters = this.parseParameters(method.getParameters());
    const returnType = method.getReturnType().getText(method);
    const documentation = this.parseJsDoc(method.getJsDocs());
    const typeParameters = method.getTypeParameters().map(tp => tp.getText());

    const scope = method.getScope();
    const decorators = method.getDecorators().map(d => d.getText());

    const modifiers: FunctionModifiers = {
      isAsync: method.isAsync(),
      isExported: false,
      isStatic: method.isStatic(),
      isPrivate: scope === Scope.Private || name.startsWith('#'),
      isProtected: scope === Scope.Protected,
      isAbstract: method.isAbstract(),
      isGenerator: method.isGenerator(),
    };

    const signature = this.buildFunctionSignature(name, parameters, returnType, modifiers, typeParameters);

    return {
      id: this.generateId(filePath, `${className}.${name}`, 'method', startLine),
      name,
      fullyQualifiedName: this.generateFullyQualifiedName(filePath, name, className),
      kind: 'method',
      signature,
      parameters,
      returnType,
      documentation,
      location,
      modifiers,
      parentClass: className,
      parentFunction: null,
      nestingDepth: 0,
      localName: name,
      decorators: decorators.length > 0 ? decorators : undefined,
      typeParameters: typeParameters.length > 0 ? typeParameters : undefined,
    };
  }

  private parseConstructor(
    classDecl: ClassDeclaration,
    filePath: string,
    className: string
  ): FunctionSignature | null {
    const constructors = classDecl.getConstructors();
    if (constructors.length === 0) return null;

    const ctor = constructors[0]!;
    const startLine = ctor.getStartLineNumber();
    const endLine = ctor.getEndLineNumber();
    const location: Location = { filePath, startLine, endLine };

    const parameters = this.parseParameters(ctor.getParameters());
    const documentation = this.parseJsDoc(ctor.getJsDocs());

    const modifiers: FunctionModifiers = {
      isAsync: false,
      isExported: false,
      isStatic: false,
      isPrivate: false,
      isProtected: false,
      isAbstract: false,
      isGenerator: false,
    };

    const paramList = parameters.map(p => {
      let str = p.name;
      if (p.isOptional) str += '?';
      if (p.type) str += `: ${p.type}`;
      return str;
    }).join(', ');

    const signature = `constructor(${paramList})`;

    return {
      id: this.generateId(filePath, `${className}.constructor`, 'constructor', startLine),
      name: 'constructor',
      fullyQualifiedName: this.generateFullyQualifiedName(filePath, 'constructor', className),
      kind: 'constructor',
      signature,
      parameters,
      returnType: className,
      documentation,
      location,
      modifiers,
      parentClass: className,
      parentFunction: null,
      nestingDepth: 0,
      localName: 'constructor',
    };
  }

  private parseClassProperties(classDecl: ClassDeclaration): PropertySignature[] {
    const properties: PropertySignature[] = [];

    for (const prop of classDecl.getProperties()) {
      const sig = this.parsePropertyDeclaration(prop);
      if (sig && this.shouldIncludeSymbol(sig.visibility === 'private')) {
        properties.push(sig);
      }
    }

    return properties;
  }

  private parsePropertyDeclaration(prop: PropertyDeclaration): PropertySignature {
    const scope = prop.getScope();
    const visibility = scope === Scope.Private ? 'private' : scope === Scope.Protected ? 'protected' : 'public';

    return {
      name: prop.getName(),
      type: prop.getType().getText(prop),
      isOptional: prop.hasQuestionToken(),
      isReadonly: prop.isReadonly(),
      isStatic: prop.isStatic(),
      visibility,
      defaultValue: prop.getInitializer()?.getText() ?? null,
      documentation: this.parseJsDoc(prop.getJsDocs()),
    };
  }

  private extractInterfaces(sourceFile: SourceFile, filePath: string): InterfaceSignature[] {
    const interfaces: InterfaceSignature[] = [];

    for (const iface of sourceFile.getInterfaces()) {
      const sig = this.parseInterfaceDeclaration(iface, filePath);
      if (sig) {
        interfaces.push(sig);
      }
    }

    return interfaces;
  }

  private parseInterfaceDeclaration(iface: InterfaceDeclaration, filePath: string): InterfaceSignature {
    const name = iface.getName();
    const startLine = iface.getStartLineNumber();
    const endLine = iface.getEndLineNumber();
    const location: Location = { filePath, startLine, endLine };

    const extendsNames = iface.getExtends().map(e => e.getText());
    const properties = this.parseInterfaceProperties(iface);
    const methods = this.parseInterfaceMethods(iface, filePath, name);
    const documentation = this.parseJsDoc(iface.getJsDocs());
    const typeParameters = iface.getTypeParameters().map(tp => tp.getText());

    const signature = this.buildInterfaceSignature(name, extendsNames, typeParameters);

    return {
      id: this.generateId(filePath, name, 'interface', startLine),
      name,
      fullyQualifiedName: this.generateFullyQualifiedName(filePath, name),
      signature,
      extends: extendsNames,
      properties,
      methods,
      documentation,
      location,
      isExported: iface.isExported(),
      typeParameters: typeParameters.length > 0 ? typeParameters : undefined,
    };
  }

  private parseInterfaceProperties(iface: InterfaceDeclaration): PropertySignature[] {
    const properties: PropertySignature[] = [];

    for (const prop of iface.getProperties()) {
      properties.push({
        name: prop.getName(),
        type: prop.getType().getText(prop),
        isOptional: prop.hasQuestionToken(),
        isReadonly: prop.isReadonly(),
        isStatic: false,
        visibility: 'public',
        defaultValue: null,
        documentation: this.parseJsDoc(prop.getJsDocs()),
      });
    }

    return properties;
  }

  private parseInterfaceMethods(
    iface: InterfaceDeclaration,
    filePath: string,
    interfaceName: string
  ): FunctionSignature[] {
    const methods: FunctionSignature[] = [];

    for (const method of iface.getMethods()) {
      const name = method.getName();
      const startLine = method.getStartLineNumber();
      const endLine = method.getEndLineNumber();
      const location: Location = { filePath, startLine, endLine };

      const parameters = this.parseParameters(method.getParameters());
      const returnType = method.getReturnType().getText(method);
      const documentation = this.parseJsDoc(method.getJsDocs());
      const typeParameters = method.getTypeParameters().map(tp => tp.getText());

      const modifiers: FunctionModifiers = {
        isAsync: false,
        isExported: false,
        isStatic: false,
        isPrivate: false,
        isProtected: false,
        isAbstract: false,
        isGenerator: false,
      };

      const signature = this.buildFunctionSignature(name, parameters, returnType, modifiers, typeParameters);

      methods.push({
        id: this.generateId(filePath, `${interfaceName}.${name}`, 'method', startLine),
        name,
        fullyQualifiedName: this.generateFullyQualifiedName(filePath, name, interfaceName),
        kind: 'method',
        signature,
        parameters,
        returnType,
        documentation,
        location,
        modifiers,
        parentClass: interfaceName,
        parentFunction: null,
        nestingDepth: 0,
        localName: name,
        typeParameters: typeParameters.length > 0 ? typeParameters : undefined,
      });
    }

    return methods;
  }

  private extractTypeAliases(sourceFile: SourceFile, filePath: string): TypeAliasSignature[] {
    const typeAliases: TypeAliasSignature[] = [];

    for (const typeAlias of sourceFile.getTypeAliases()) {
      const name = typeAlias.getName();
      const startLine = typeAlias.getStartLineNumber();
      const endLine = typeAlias.getEndLineNumber();
      const location: Location = { filePath, startLine, endLine };

      const type = typeAlias.getType().getText(typeAlias);
      const documentation = this.parseJsDoc(typeAlias.getJsDocs());
      const typeParameters = typeAlias.getTypeParameters().map(tp => tp.getText());

      const exportKw = typeAlias.isExported() ? 'export ' : '';
      const typeParams = typeParameters.length > 0 ? `<${typeParameters.join(', ')}>` : '';
      const signature = `${exportKw}type ${name}${typeParams} = ${type}`;

      typeAliases.push({
        id: this.generateId(filePath, name, 'type', startLine),
        name,
        fullyQualifiedName: this.generateFullyQualifiedName(filePath, name),
        signature,
        type,
        documentation,
        location,
        isExported: typeAlias.isExported(),
        typeParameters: typeParameters.length > 0 ? typeParameters : undefined,
      });
    }

    return typeAliases;
  }

  private extractVariables(sourceFile: SourceFile, filePath: string): VariableSignature[] {
    const variables: VariableSignature[] = [];

    for (const statement of sourceFile.getVariableStatements()) {
      for (const decl of statement.getDeclarations()) {
        // Skip arrow functions and function expressions (handled in extractFunctions)
        const initializer = decl.getInitializer();
        if (initializer && (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))) {
          continue;
        }

        const name = decl.getName();
        const startLine = statement.getStartLineNumber();
        const endLine = statement.getEndLineNumber();
        const location: Location = { filePath, startLine, endLine };

        const type = decl.getType().getText(decl);
        const documentation = this.parseJsDoc(statement.getJsDocs());

        const declarationKind = statement.getDeclarationKind();
        const kind = declarationKind === VariableDeclarationKind.Var ? 'var' : declarationKind === VariableDeclarationKind.Let ? 'let' : 'const';

        const isPrivate = name.startsWith('_');
        if (this.shouldIncludeSymbol(isPrivate)) {
          variables.push({
            id: this.generateId(filePath, name, 'variable', startLine),
            name,
            fullyQualifiedName: this.generateFullyQualifiedName(filePath, name),
            type,
            kind: kind as 'const' | 'let' | 'var',
            isExported: statement.isExported(),
            documentation,
            location,
          });
        }
      }
    }

    return variables;
  }

  private extractImports(sourceFile: SourceFile): ImportInfo[] {
    const imports: ImportInfo[] = [];

    for (const importDecl of sourceFile.getImportDeclarations()) {
      const source = importDecl.getModuleSpecifierValue();
      const specifiers: ImportInfo['specifiers'] = [];

      const defaultImport = importDecl.getDefaultImport();
      if (defaultImport) {
        specifiers.push({
          name: defaultImport.getText(),
          isDefault: true,
          isNamespace: false,
        });
      }

      const namespaceImport = importDecl.getNamespaceImport();
      if (namespaceImport) {
        specifiers.push({
          name: namespaceImport.getText(),
          isDefault: false,
          isNamespace: true,
        });
      }

      for (const named of importDecl.getNamedImports()) {
        const alias = named.getAliasNode()?.getText();
        specifiers.push({
          name: named.getName(),
          alias,
          isDefault: false,
          isNamespace: false,
        });
      }

      imports.push({
        source,
        specifiers,
        isTypeOnly: importDecl.isTypeOnly(),
      });
    }

    return imports;
  }

  private extractExports(sourceFile: SourceFile): ExportInfo[] {
    const exports: ExportInfo[] = [];

    // Named exports
    for (const exportDecl of sourceFile.getExportDeclarations()) {
      const source = exportDecl.getModuleSpecifierValue();

      for (const named of exportDecl.getNamedExports()) {
        const alias = named.getAliasNode()?.getText();
        exports.push({
          name: named.getName(),
          alias,
          isDefault: false,
          isReExport: !!source,
          source: source ?? undefined,
        });
      }
    }

    // Default export
    const defaultExport = sourceFile.getDefaultExportSymbol();
    if (defaultExport) {
      exports.push({
        name: defaultExport.getName(),
        isDefault: true,
        isReExport: false,
      });
    }

    return exports;
  }

  private parseParameters(params: ParameterDeclaration[]): ParameterInfo[] {
    return params.map(param => ({
      name: param.getName(),
      type: param.getType().getText(param),
      defaultValue: param.getInitializer()?.getText() ?? null,
      isOptional: param.isOptional(),
      isRest: param.isRestParameter(),
    }));
  }

  private parseJsDoc(jsDocs: JSDoc[]): DocumentationInfo | null {
    if (jsDocs.length === 0) return null;

    const doc = jsDocs[0]!;
    const description = doc.getDescription().trim();

    const params: DocumentationInfo['params'] = [];
    const tags: DocumentationInfo['tags'] = [];
    let returns: string | undefined;
    let deprecated: string | boolean | undefined;
    const throws: string[] = [];
    const examples: string[] = [];

    for (const tag of doc.getTags()) {
      const tagName = tag.getTagName();
      const text = tag.getCommentText()?.trim() ?? '';

      switch (tagName) {
        case 'param':
          const paramName = tag.getText().match(/@param\s+(?:\{[^}]+\}\s+)?(\w+)/)?.[1];
          if (paramName) {
            params.push({ name: paramName, description: text });
          }
          break;
        case 'returns':
        case 'return':
          returns = text;
          break;
        case 'deprecated':
          deprecated = text || true;
          break;
        case 'throws':
        case 'exception':
          throws.push(text);
          break;
        case 'example':
          examples.push(text);
          break;
        default:
          tags.push({ tag: tagName, text });
      }
    }

    if (!description && params.length === 0 && !returns) {
      return null;
    }

    return {
      description,
      params,
      returns,
      throws: throws.length > 0 ? throws : undefined,
      examples: examples.length > 0 ? examples : undefined,
      deprecated,
      tags,
    };
  }

  private buildFunctionSignature(
    name: string,
    parameters: ParameterInfo[],
    returnType: string,
    modifiers: FunctionModifiers,
    typeParameters: string[]
  ): string {
    const parts: string[] = [];

    if (modifiers.isExported) parts.push('export');
    if (modifiers.isAsync) parts.push('async');
    if (modifiers.isStatic) parts.push('static');
    if (modifiers.isPrivate) parts.push('private');
    if (modifiers.isProtected) parts.push('protected');
    if (modifiers.isAbstract) parts.push('abstract');

    parts.push('function');

    const typeParams = typeParameters.length > 0 ? `<${typeParameters.join(', ')}>` : '';
    const paramList = parameters.map(p => {
      let str = p.isRest ? `...${p.name}` : p.name;
      if (p.isOptional && !p.defaultValue) str += '?';
      if (p.type) str += `: ${p.type}`;
      if (p.defaultValue) str += ` = ${p.defaultValue}`;
      return str;
    }).join(', ');

    parts.push(`${name}${typeParams}(${paramList}): ${returnType}`);

    return parts.join(' ');
  }

  private buildClassSignature(
    name: string,
    extendsName: string | null,
    implementsNames: string[],
    typeParameters: string[]
  ): string {
    const parts: string[] = ['class', name];

    if (typeParameters.length > 0) {
      parts[parts.length - 1] += `<${typeParameters.join(', ')}>`;
    }

    if (extendsName) {
      parts.push('extends', extendsName);
    }

    if (implementsNames.length > 0) {
      parts.push('implements', implementsNames.join(', '));
    }

    return parts.join(' ');
  }

  private buildInterfaceSignature(
    name: string,
    extendsNames: string[],
    typeParameters: string[]
  ): string {
    const parts: string[] = ['interface', name];

    if (typeParameters.length > 0) {
      parts[parts.length - 1] += `<${typeParameters.join(', ')}>`;
    }

    if (extendsNames.length > 0) {
      parts.push('extends', extendsNames.join(', '));
    }

    return parts.join(' ');
  }

  private shouldIncludeSymbol(isPrivate: boolean): boolean {
    return this.options.includePrivate || !isPrivate;
  }

  /**
   * Extract callbacks from call expressions (test functions, event handlers, CLI handlers, etc.)
   */
  private extractCallbacks(sourceFile: SourceFile, filePath: string): FunctionSignature[] {
    const callbacks: FunctionSignature[] = [];
    const seenLocations = new Set<string>(); // Avoid duplicates

    // Find all call expressions
    const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);

    for (const callExpr of callExpressions) {
      const extracted = this.extractCallbacksFromCall(callExpr, filePath, seenLocations);
      callbacks.push(...extracted);
    }

    return callbacks;
  }

  /**
   * Extract callbacks from a single call expression
   */
  private extractCallbacksFromCall(
    callExpr: CallExpression,
    filePath: string,
    seenLocations: Set<string>
  ): FunctionSignature[] {
    const callbacks: FunctionSignature[] = [];
    const expression = callExpr.getExpression();
    const expressionText = expression.getText();

    // Get the function/method being called
    let functionName: string;
    let contextPrefix = '';

    if (Node.isPropertyAccessExpression(expression)) {
      // Method call: obj.method()
      functionName = expression.getName();
      const objText = expression.getExpression().getText();
      if (functionName === 'on' || functionName === 'once' || functionName === 'addEventListener') {
        // For event handlers, include the event name in context
        const args = callExpr.getArguments();
        if (args.length > 0 && Node.isStringLiteral(args[0]!)) {
          contextPrefix = `${functionName}:${args[0].getLiteralText()}`;
        } else {
          contextPrefix = functionName;
        }
      }
    } else if (Node.isIdentifier(expression)) {
      // Direct call: functionName()
      functionName = expression.getText();
    } else {
      return callbacks;
    }

    // Skip array methods
    if (SKIP_CALLBACK_METHODS.has(functionName)) {
      return callbacks;
    }

    // Check if this is a test framework function or callback-taking method
    const isTestFunction = TEST_FRAMEWORK_FUNCTIONS.has(functionName);
    const isCallbackMethod = CALLBACK_METHOD_NAMES.has(functionName);

    if (!isTestFunction && !isCallbackMethod) {
      return callbacks;
    }

    const args = callExpr.getArguments();

    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;

      // Check if the argument is a function (arrow or function expression)
      if (!Node.isArrowFunction(arg) && !Node.isFunctionExpression(arg)) {
        continue;
      }

      const func = arg as ArrowFunction | FunctionExpression;
      const startLine = func.getStartLineNumber();
      const endLine = func.getEndLineNumber();
      const locationKey = `${filePath}:${startLine}:${endLine}`;

      // Skip if we've already seen this callback
      if (seenLocations.has(locationKey)) {
        continue;
      }
      seenLocations.add(locationKey);

      // Determine the callback name
      let callbackName: string;
      let context = contextPrefix || functionName;

      if (isTestFunction) {
        // For test functions, use the description as the name
        const descArg = args.find(a => Node.isStringLiteral(a));
        if (descArg && Node.isStringLiteral(descArg)) {
          const desc = descArg.getLiteralText();
          // Sanitize the description for use as a name
          callbackName = desc.substring(0, 60).replace(/[^a-zA-Z0-9_\s-]/g, '').trim() || `${functionName}_callback`;
        } else {
          callbackName = `${functionName}_callback_${startLine}`;
        }
      } else {
        // For other callbacks, use a descriptive name
        callbackName = `${context}_callback_${startLine}`;
      }

      const callback = this.parseCallbackFunction(func, filePath, callbackName, context, startLine, endLine);
      if (callback) {
        callbacks.push(callback);
      }
    }

    return callbacks;
  }

  /**
   * Parse a callback function into a FunctionSignature
   */
  private parseCallbackFunction(
    func: ArrowFunction | FunctionExpression,
    filePath: string,
    name: string,
    callbackContext: string,
    startLine: number,
    endLine: number
  ): FunctionSignature {
    const location = { filePath, startLine, endLine };
    const parameters = this.parseParameters(func.getParameters());
    const returnType = func.getReturnType().getText(func);
    const typeParameters = func.getTypeParameters().map(tp => tp.getText());

    const modifiers: FunctionModifiers = {
      isAsync: func.isAsync(),
      isExported: false,
      isStatic: false,
      isPrivate: false,
      isProtected: false,
      isAbstract: false,
      isGenerator: Node.isFunctionExpression(func) ? func.isGenerator() : false,
      callbackContext,
    };

    const signature = this.buildCallbackSignature(name, parameters, returnType, modifiers, typeParameters, callbackContext);

    return {
      id: this.generateId(filePath, name, 'callback', startLine),
      name,
      fullyQualifiedName: this.generateFullyQualifiedName(filePath, name),
      kind: 'callback',
      signature,
      parameters,
      returnType,
      documentation: null,
      location,
      modifiers,
      parentClass: null,
      parentFunction: null,
      nestingDepth: 0,
      localName: name,
      typeParameters: typeParameters.length > 0 ? typeParameters : undefined,
    };
  }

  /**
   * Build a signature string for a callback function
   */
  private buildCallbackSignature(
    name: string,
    parameters: ParameterInfo[],
    returnType: string,
    modifiers: FunctionModifiers,
    typeParameters: string[],
    callbackContext: string
  ): string {
    const parts: string[] = [];

    parts.push(`[${callbackContext}]`);
    if (modifiers.isAsync) parts.push('async');

    const typeParams = typeParameters.length > 0 ? `<${typeParameters.join(', ')}>` : '';
    const paramList = parameters.map(p => {
      let str = p.isRest ? `...${p.name}` : p.name;
      if (p.isOptional && !p.defaultValue) str += '?';
      if (p.type) str += `: ${p.type}`;
      if (p.defaultValue) str += ` = ${p.defaultValue}`;
      return str;
    }).join(', ');

    parts.push(`${name}${typeParams}(${paramList}): ${returnType}`);

    return parts.join(' ');
  }

  /**
   * Extract references to symbols (where identifiers are used)
   */
  private extractReferences(
    sourceFile: SourceFile,
    filePath: string,
    content: string,
    functions: FunctionSignature[],
    classes: ClassSignature[]
  ): SymbolReference[] {
    const references: SymbolReference[] = [];
    const lines = content.split('\n');

    // Build a map of known symbols for quick lookup
    const knownSymbols = new Set<string>();
    for (const func of functions) {
      knownSymbols.add(func.name);
    }
    for (const cls of classes) {
      knownSymbols.add(cls.name);
      for (const method of cls.methods) {
        knownSymbols.add(method.name);
      }
    }

    // Find all identifiers in the source file
    sourceFile.getDescendantsOfKind(SyntaxKind.Identifier).forEach(identifier => {
      const name = identifier.getText();

      // Skip common keywords and short names
      if (name.length < 2 || ['as', 'is', 'in', 'of', 'if', 'do'].includes(name)) {
        return;
      }

      // Skip declarations (we want usages, not definitions)
      const parent = identifier.getParent();
      if (!parent) return;

      const parentKind = parent.getKind();
      if (
        parentKind === SyntaxKind.FunctionDeclaration ||
        parentKind === SyntaxKind.MethodDeclaration ||
        parentKind === SyntaxKind.ClassDeclaration ||
        parentKind === SyntaxKind.InterfaceDeclaration ||
        parentKind === SyntaxKind.TypeAliasDeclaration ||
        parentKind === SyntaxKind.VariableDeclaration ||
        parentKind === SyntaxKind.Parameter ||
        parentKind === SyntaxKind.PropertyDeclaration ||
        parentKind === SyntaxKind.PropertySignature
      ) {
        // Check if this identifier is the name being declared
        const nameNode = (parent as any).getName?.();
        if (nameNode === name || (parent as any).name?.getText() === name) {
          return;
        }
      }

      // Determine reference kind
      let referenceKind: ReferenceKind = 'read';

      if (parentKind === SyntaxKind.CallExpression) {
        const callExpr = parent;
        const expression = (callExpr as any).getExpression?.();
        if (expression === identifier || expression?.getText() === name) {
          referenceKind = 'call';
        }
      } else if (parentKind === SyntaxKind.TypeReference) {
        referenceKind = 'type';
      } else if (parentKind === SyntaxKind.ImportSpecifier || parentKind === SyntaxKind.ImportClause) {
        referenceKind = 'import';
      } else if (
        parentKind === SyntaxKind.BinaryExpression &&
        (parent as any).getOperatorToken?.().getKind() === SyntaxKind.EqualsToken
      ) {
        const left = (parent as any).getLeft?.();
        if (left === identifier || left?.getText() === name) {
          referenceKind = 'write';
        }
      }

      const lineNumber = identifier.getStartLineNumber();
      const lineText = lines[lineNumber - 1] ?? '';
      const startOfLine = identifier.getStart() - identifier.getStartLinePos();
      const column = startOfLine > 0 ? startOfLine : lineText.indexOf(name);

      // Get context (surrounding code)
      const contextStart = Math.max(0, column - 20);
      const contextEnd = Math.min(lineText.length, column + name.length + 20);
      const context = lineText.slice(contextStart, contextEnd).trim();

      // Find containing function/method
      let referencingSymbolId: string | undefined;
      let referencingSymbolName: string | undefined;

      const containingFunction = identifier.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration)
        ?? identifier.getFirstAncestorByKind(SyntaxKind.MethodDeclaration)
        ?? identifier.getFirstAncestorByKind(SyntaxKind.ArrowFunction);

      if (containingFunction) {
        const funcName = (containingFunction as any).getName?.() ?? 'anonymous';
        const funcLine = containingFunction.getStartLineNumber();
        const containingClass = containingFunction.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
        if (containingClass) {
          const className = containingClass.getName() ?? '';
          referencingSymbolId = this.generateId(filePath, `${className}.${funcName}`, 'method', funcLine);
          referencingSymbolName = `${className}.${funcName}`;
        } else {
          referencingSymbolId = this.generateId(filePath, funcName, 'function', funcLine);
          referencingSymbolName = funcName;
        }
      }

      const refId = `${filePath}:ref:${name}:${lineNumber}:${column}`;

      references.push({
        id: refId,
        symbolId: '', // Will be resolved later
        symbolName: name,
        referencingFile: filePath,
        referencingSymbolId,
        referencingSymbolName,
        lineNumber,
        columnNumber: column,
        context,
        referenceKind,
      });
    });

    return references;
  }

  /**
   * Extract function call relationships
   */
  private extractCalls(
    sourceFile: SourceFile,
    filePath: string,
    functions: FunctionSignature[],
    classes: ClassSignature[]
  ): CallGraphEdge[] {
    const calls: CallGraphEdge[] = [];
    const callCounts = new Map<string, { edge: CallGraphEdge; count: number }>();

    // Process call expressions
    sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).forEach(callExpr => {
      const expression = callExpr.getExpression();
      let calleeName = expression.getText();

      // Simplify method calls (obj.method -> method)
      if (calleeName.includes('.')) {
        const parts = calleeName.split('.');
        calleeName = parts[parts.length - 1] ?? calleeName;
      }

      // Remove type arguments
      if (calleeName.includes('<')) {
        calleeName = calleeName.split('<')[0] ?? calleeName;
      }

      // Find containing function
      const containingFunction = callExpr.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration)
        ?? callExpr.getFirstAncestorByKind(SyntaxKind.MethodDeclaration)
        ?? callExpr.getFirstAncestorByKind(SyntaxKind.ArrowFunction);

      if (!containingFunction) return;

      const funcName = (containingFunction as any).getName?.();
      if (!funcName) return;

      const funcLine = containingFunction.getStartLineNumber();
      const containingClass = containingFunction.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);

      let callerSymbolId: string;
      let callerName: string;

      if (containingClass) {
        const className = containingClass.getName() ?? '';
        callerSymbolId = this.generateId(filePath, `${className}.${funcName}`, 'method', funcLine);
        callerName = `${className}.${funcName}`;
      } else {
        callerSymbolId = this.generateId(filePath, funcName, 'function', funcLine);
        callerName = funcName;
      }

      // Check if call is async (await keyword)
      const isAsync = !!callExpr.getFirstAncestorByKind(SyntaxKind.AwaitExpression);

      // Check if call is conditional (inside if/try/catch/ternary)
      const isConditional = !!(
        callExpr.getFirstAncestorByKind(SyntaxKind.IfStatement) ||
        callExpr.getFirstAncestorByKind(SyntaxKind.TryStatement) ||
        callExpr.getFirstAncestorByKind(SyntaxKind.ConditionalExpression)
      );

      // Create unique key for deduplication
      const key = `${callerSymbolId}:${calleeName}`;

      if (callCounts.has(key)) {
        callCounts.get(key)!.count++;
      } else {
        const edgeId = `${filePath}:call:${callerName}:${calleeName}`;
        callCounts.set(key, {
          edge: {
            id: edgeId,
            callerSymbolId,
            callerName,
            calleeName,
            calleeSymbolId: undefined, // Will be resolved later
            callCount: 1,
            isAsync,
            isConditional,
          },
          count: 1,
        });
      }
    });

    // Convert to array with counts
    for (const { edge, count } of callCounts.values()) {
      calls.push({ ...edge, callCount: count });
    }

    return calls;
  }

  /**
   * Extract type relationships (extends/implements)
   */
  private extractTypeRelationships(
    sourceFile: SourceFile,
    filePath: string,
    classes: ClassSignature[],
    interfaces: InterfaceSignature[]
  ): TypeRelationship[] {
    const relationships: TypeRelationship[] = [];

    // Extract from classes
    for (const cls of classes) {
      // Handle extends
      if (cls.extends) {
        const relId = `${filePath}:extends:${cls.name}:${cls.extends}`;
        relationships.push({
          id: relId,
          sourceSymbolId: cls.id,
          sourceName: cls.name,
          targetName: cls.extends,
          targetSymbolId: undefined, // Will be resolved later
          relationshipKind: 'extends',
        });
      }

      // Handle implements
      for (const impl of cls.implements) {
        const relId = `${filePath}:implements:${cls.name}:${impl}`;
        relationships.push({
          id: relId,
          sourceSymbolId: cls.id,
          sourceName: cls.name,
          targetName: impl,
          targetSymbolId: undefined, // Will be resolved later
          relationshipKind: 'implements',
        });
      }
    }

    // Extract from interfaces (extends only)
    for (const iface of interfaces) {
      for (const ext of iface.extends) {
        const relId = `${filePath}:extends:${iface.name}:${ext}`;
        relationships.push({
          id: relId,
          sourceSymbolId: iface.id,
          sourceName: iface.name,
          targetName: ext,
          targetSymbolId: undefined, // Will be resolved later
          relationshipKind: 'extends',
        });
      }
    }

    return relationships;
  }
}
