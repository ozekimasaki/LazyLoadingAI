/**
 * Python parser using tree-sitter
 */

import Parser from 'tree-sitter';
import Python from 'tree-sitter-python';

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

interface TreeSitterNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  children: TreeSitterNode[];
  childForFieldName(name: string): TreeSitterNode | null;
  childrenForFieldName(name: string): TreeSitterNode[];
  namedChildren: TreeSitterNode[];
  parent: TreeSitterNode | null;
}

export class PythonParser extends LanguageParser {
  private parser: Parser;

  constructor(options: ParserOptions = {}) {
    super(options);
    this.parser = new Parser();
    this.parser.setLanguage(Python as unknown as Parser.Language);
  }

  get language(): Language {
    return 'python';
  }

  get extensions(): string[] {
    return ['py', 'pyi'];
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

    try {
      const tree = this.parser.parse(content);
      const root = tree.rootNode as unknown as TreeSitterNode;
      const lines = content.split('\n');

      const functions = this.extractFunctions(root, filePath, lines, null);
      const classes = this.extractClasses(root, filePath, lines);
      const variables = this.extractVariables(root, filePath, lines);
      const imports = this.extractImports(root);
      const exports = this.extractExports(root, functions, classes, variables);

      // Extract references, calls, and type relationships
      const references = this.extractReferences(root, filePath, lines, functions, classes);
      const calls = this.extractCallGraph(root, filePath, lines, functions, classes);
      const typeRelationships = this.extractTypeRelationships(filePath, classes);

      return {
        functions,
        classes,
        interfaces: [], // Python doesn't have interfaces
        typeAliases: [], // Could extract TypedDict, but keeping simple for now
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

  private extractFunctions(
    node: TreeSitterNode,
    filePath: string,
    lines: string[],
    parentClass: string | null
  ): FunctionSignature[] {
    const functions: FunctionSignature[] = [];

    for (const child of node.namedChildren) {
      if (child.type === 'function_definition') {
        const sig = this.parseFunctionDefinition(child, filePath, lines, parentClass);
        if (sig && this.shouldIncludeSymbol(sig.modifiers.isPrivate)) {
          functions.push(sig);
        }
      } else if (child.type === 'decorated_definition') {
        const definition = child.namedChildren.find(
          c => c.type === 'function_definition' || c.type === 'async_function_definition'
        );
        if (definition) {
          const decorators = child.namedChildren
            .filter(c => c.type === 'decorator')
            .map(d => d.text);
          const sig = this.parseFunctionDefinition(definition, filePath, lines, parentClass, decorators);
          if (sig && this.shouldIncludeSymbol(sig.modifiers.isPrivate)) {
            functions.push(sig);
          }
        }
      } else if (child.type === 'async_function_definition') {
        const sig = this.parseFunctionDefinition(child, filePath, lines, parentClass);
        if (sig && this.shouldIncludeSymbol(sig.modifiers.isPrivate)) {
          functions.push(sig);
        }
      }
    }

    return functions;
  }

  private parseFunctionDefinition(
    node: TreeSitterNode,
    filePath: string,
    lines: string[],
    parentClass: string | null,
    decorators: string[] = []
  ): FunctionSignature | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = nameNode.text;
    const isAsync = node.type === 'async_function_definition';
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    const location: Location = { filePath, startLine, endLine };

    const parameters = this.parseParameters(node);
    const returnType = this.parseReturnType(node);
    const documentation = this.parseDocstring(node, lines);

    const isPrivate = name.startsWith('_') && !name.startsWith('__');
    const isDunder = name.startsWith('__') && name.endsWith('__');
    const isStaticMethod = decorators.some(d => d.includes('@staticmethod'));
    const isClassMethod = decorators.some(d => d.includes('@classmethod'));

    // Determine kind
    let kind: 'function' | 'method' | 'constructor' = 'function';
    if (parentClass) {
      kind = name === '__init__' ? 'constructor' : 'method';
    }

    const modifiers: FunctionModifiers = {
      isAsync,
      isExported: !name.startsWith('_') || isDunder,
      isStatic: isStaticMethod,
      isPrivate,
      isProtected: name.startsWith('_') && !name.startsWith('__'),
      isAbstract: decorators.some(d => d.includes('@abstractmethod')),
      isGenerator: this.isGenerator(node),
    };

    const signature = this.buildFunctionSignature(name, parameters, returnType, modifiers, isAsync);

    return {
      id: this.generateId(filePath, parentClass ? `${parentClass}.${name}` : name, kind, startLine),
      name,
      fullyQualifiedName: this.generateFullyQualifiedName(filePath, name, parentClass ?? undefined),
      kind,
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
      decorators: decorators.length > 0 ? decorators : undefined,
    };
  }

  private parseParameters(funcNode: TreeSitterNode): ParameterInfo[] {
    const parameters: ParameterInfo[] = [];
    const paramsNode = funcNode.childForFieldName('parameters');

    if (!paramsNode) return parameters;

    for (const param of paramsNode.namedChildren) {
      if (param.type === 'identifier') {
        // Simple parameter without type annotation
        parameters.push({
          name: param.text,
          type: null,
          defaultValue: null,
          isOptional: false,
          isRest: false,
        });
      } else if (param.type === 'typed_parameter') {
        const name = param.namedChildren[0]?.text ?? '';
        const typeNode = param.childForFieldName('type');
        parameters.push({
          name,
          type: typeNode?.text ?? null,
          defaultValue: null,
          isOptional: false,
          isRest: false,
        });
      } else if (param.type === 'default_parameter') {
        const name = param.namedChildren[0]?.text ?? '';
        const valueNode = param.childForFieldName('value');
        parameters.push({
          name,
          type: null,
          defaultValue: valueNode?.text ?? null,
          isOptional: true,
          isRest: false,
        });
      } else if (param.type === 'typed_default_parameter') {
        const name = param.namedChildren[0]?.text ?? '';
        const typeNode = param.childForFieldName('type');
        const valueNode = param.childForFieldName('value');
        parameters.push({
          name,
          type: typeNode?.text ?? null,
          defaultValue: valueNode?.text ?? null,
          isOptional: true,
          isRest: false,
        });
      } else if (param.type === 'list_splat_pattern') {
        const name = param.namedChildren[0]?.text ?? 'args';
        parameters.push({
          name: `*${name}`,
          type: null,
          defaultValue: null,
          isOptional: true,
          isRest: true,
        });
      } else if (param.type === 'dictionary_splat_pattern') {
        const name = param.namedChildren[0]?.text ?? 'kwargs';
        parameters.push({
          name: `**${name}`,
          type: null,
          defaultValue: null,
          isOptional: true,
          isRest: true,
        });
      }
    }

    return parameters;
  }

  private parseReturnType(funcNode: TreeSitterNode): string | null {
    const returnTypeNode = funcNode.childForFieldName('return_type');
    return returnTypeNode?.text ?? null;
  }

  private parseDocstring(node: TreeSitterNode, lines: string[]): DocumentationInfo | null {
    const body = node.childForFieldName('body');
    if (!body || body.namedChildren.length === 0) return null;

    const firstStatement = body.namedChildren[0];
    if (!firstStatement || firstStatement.type !== 'expression_statement') return null;

    const expr = firstStatement.namedChildren[0];
    if (!expr || expr.type !== 'string') return null;

    const docstring = this.cleanDocstring(expr.text);
    if (!docstring) return null;

    return this.parseDocstringContent(docstring);
  }

  private cleanDocstring(raw: string): string {
    // Remove quotes
    let cleaned = raw;
    if (cleaned.startsWith('"""') || cleaned.startsWith("'''")) {
      cleaned = cleaned.slice(3, -3);
    } else if (cleaned.startsWith('"') || cleaned.startsWith("'")) {
      cleaned = cleaned.slice(1, -1);
    }

    // Trim and normalize whitespace
    return cleaned.trim();
  }

  private parseDocstringContent(docstring: string): DocumentationInfo {
    const lines = docstring.split('\n');
    let description = '';
    const params: DocumentationInfo['params'] = [];
    const tags: DocumentationInfo['tags'] = [];
    let returns: string | undefined;
    const throws: string[] = [];
    const examples: string[] = [];

    let currentSection = 'description';
    let currentParam = '';
    let currentContent: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      // Check for section headers (Google/NumPy style)
      if (/^(Args|Arguments|Parameters):?\s*$/i.test(trimmed)) {
        if (currentSection === 'description') {
          description = currentContent.join('\n').trim();
        }
        currentSection = 'params';
        currentContent = [];
        continue;
      }
      if (/^(Returns?|Yields?):?\s*$/i.test(trimmed)) {
        this.flushParam(params, currentParam, currentContent);
        currentSection = 'returns';
        currentContent = [];
        continue;
      }
      if (/^(Raises?|Throws?|Exceptions?):?\s*$/i.test(trimmed)) {
        if (currentSection === 'returns') {
          returns = currentContent.join('\n').trim();
        }
        this.flushParam(params, currentParam, currentContent);
        currentSection = 'raises';
        currentContent = [];
        continue;
      }
      if (/^Examples?:?\s*$/i.test(trimmed)) {
        if (currentSection === 'returns') {
          returns = currentContent.join('\n').trim();
        }
        this.flushParam(params, currentParam, currentContent);
        currentSection = 'examples';
        currentContent = [];
        continue;
      }

      if (currentSection === 'params') {
        // Check for new parameter (Google style: "name (type): description" or "name: description")
        const paramMatch = trimmed.match(/^(\w+)\s*(?:\([^)]+\))?:\s*(.*)$/);
        if (paramMatch && !trimmed.startsWith(' ')) {
          this.flushParam(params, currentParam, currentContent);
          currentParam = paramMatch[1] ?? '';
          currentContent = paramMatch[2] ? [paramMatch[2]] : [];
          continue;
        }
      }

      if (currentSection === 'raises') {
        const raiseMatch = trimmed.match(/^(\w+):\s*(.*)$/);
        if (raiseMatch && !trimmed.startsWith(' ')) {
          throws.push(`${raiseMatch[1]}: ${raiseMatch[2]}`);
          continue;
        }
      }

      currentContent.push(trimmed);
    }

    // Flush remaining content
    if (currentSection === 'description') {
      description = currentContent.join('\n').trim();
    } else if (currentSection === 'returns') {
      returns = currentContent.join('\n').trim();
    } else if (currentSection === 'params') {
      this.flushParam(params, currentParam, currentContent);
    } else if (currentSection === 'examples') {
      examples.push(currentContent.join('\n').trim());
    }

    return {
      description,
      params,
      returns,
      throws: throws.length > 0 ? throws : undefined,
      examples: examples.length > 0 ? examples : undefined,
      tags,
    };
  }

  private flushParam(
    params: DocumentationInfo['params'],
    name: string,
    content: string[]
  ): void {
    if (name) {
      params.push({ name, description: content.join(' ').trim() });
    }
  }

  private isGenerator(funcNode: TreeSitterNode): boolean {
    const body = funcNode.childForFieldName('body');
    if (!body) return false;

    const checkForYield = (node: TreeSitterNode): boolean => {
      if (node.type === 'yield' || node.type === 'yield_statement') {
        return true;
      }
      for (const child of node.namedChildren) {
        if (checkForYield(child)) return true;
      }
      return false;
    };

    return checkForYield(body);
  }

  private extractClasses(
    node: TreeSitterNode,
    filePath: string,
    lines: string[]
  ): ClassSignature[] {
    const classes: ClassSignature[] = [];

    for (const child of node.namedChildren) {
      if (child.type === 'class_definition') {
        const sig = this.parseClassDefinition(child, filePath, lines);
        if (sig) {
          classes.push(sig);
        }
      } else if (child.type === 'decorated_definition') {
        const definition = child.namedChildren.find(c => c.type === 'class_definition');
        if (definition) {
          const decorators = child.namedChildren
            .filter(c => c.type === 'decorator')
            .map(d => d.text);
          const sig = this.parseClassDefinition(definition, filePath, lines, decorators);
          if (sig) {
            classes.push(sig);
          }
        }
      }
    }

    return classes;
  }

  private parseClassDefinition(
    node: TreeSitterNode,
    filePath: string,
    lines: string[],
    decorators: string[] = []
  ): ClassSignature | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = nameNode.text;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    const location: Location = { filePath, startLine, endLine };

    // Parse base classes
    const bases = this.parseBaseClasses(node);
    const extendsClass: string | null = bases.length > 0 ? (bases[0] ?? null) : null;
    const implementsClasses = bases.slice(1);

    // Parse body for methods and properties
    const body = node.childForFieldName('body');
    const methods: FunctionSignature[] = [];
    const properties: PropertySignature[] = [];
    let constructorSignature: string | null = null;

    if (body) {
      const classMethods = this.extractFunctions(body, filePath, lines, name);
      for (const method of classMethods) {
        if (method.kind === 'constructor') {
          constructorSignature = method.signature;
        }
        methods.push(method);
      }

      // Extract class attributes
      for (const stmt of body.namedChildren) {
        if (stmt.type === 'expression_statement') {
          const expr = stmt.namedChildren[0];
          if (expr && expr.type === 'assignment') {
            const prop = this.parseClassAttribute(expr);
            if (prop) {
              properties.push(prop);
            }
          }
        }
      }
    }

    const documentation = this.parseDocstring(node, lines);
    const signature = this.buildClassSignature(name, extendsClass ?? undefined, implementsClasses);

    return {
      id: this.generateId(filePath, name, 'class', startLine),
      name,
      fullyQualifiedName: this.generateFullyQualifiedName(filePath, name),
      signature,
      extends: extendsClass,
      implements: implementsClasses,
      methods,
      properties,
      methodCount: methods.length,
      propertyCount: properties.length,
      constructorSignature,
      documentation,
      location,
      isExported: !name.startsWith('_'),
      isAbstract: decorators.some(d => d.includes('ABC') || d.includes('abstractmethod')),
      decorators: decorators.length > 0 ? decorators : undefined,
    };
  }

  private parseBaseClasses(classNode: TreeSitterNode): string[] {
    const bases: string[] = [];
    const superclassNode = classNode.childForFieldName('superclasses');

    if (superclassNode) {
      for (const arg of superclassNode.namedChildren) {
        if (arg.type === 'identifier' || arg.type === 'attribute' || arg.type === 'subscript') {
          bases.push(arg.text);
        } else if (arg.type === 'argument_list') {
          for (const child of arg.namedChildren) {
            if (child.type === 'identifier' || child.type === 'attribute' || child.type === 'subscript') {
              bases.push(child.text);
            }
          }
        }
      }
    }

    return bases;
  }

  private parseClassAttribute(node: TreeSitterNode): PropertySignature | null {
    const leftNode = node.namedChildren[0];
    const rightNode = node.namedChildren[1];

    if (!leftNode) return null;

    let name: string;
    let type: string | null = null;

    if (leftNode.type === 'identifier') {
      name = leftNode.text;
    } else if (leftNode.type === 'type') {
      // Typed assignment: name: Type = value
      const identNode = leftNode.namedChildren[0];
      name = identNode?.text ?? '';
      const typeNode = leftNode.childForFieldName('type');
      type = typeNode?.text ?? null;
    } else {
      return null;
    }

    const isPrivate = name.startsWith('_') && !name.startsWith('__');
    const visibility = isPrivate ? 'private' : 'public';

    return {
      name,
      type,
      isOptional: false,
      isReadonly: false,
      isStatic: true, // Class-level attributes are effectively static
      visibility,
      defaultValue: rightNode?.text ?? null,
      documentation: null,
    };
  }

  private extractVariables(
    node: TreeSitterNode,
    filePath: string,
    lines: string[]
  ): VariableSignature[] {
    const variables: VariableSignature[] = [];

    for (const child of node.namedChildren) {
      if (child.type === 'expression_statement') {
        const expr = child.namedChildren[0];
        if (expr && expr.type === 'assignment') {
          const leftNode = expr.namedChildren[0];
          if (leftNode && leftNode.type === 'identifier') {
            const name = leftNode.text;
            const startLine = child.startPosition.row + 1;
            const endLine = child.endPosition.row + 1;

            // Skip if it's a function or class (those are handled elsewhere)
            const isPrivate = name.startsWith('_');
            if (this.shouldIncludeSymbol(isPrivate)) {
              variables.push({
                id: this.generateId(filePath, name, 'variable', startLine),
                name,
                fullyQualifiedName: this.generateFullyQualifiedName(filePath, name),
                type: null, // Could parse type comments
                kind: 'const', // Python doesn't have const, but treating module-level as const
                isExported: !name.startsWith('_'),
                documentation: null,
                location: { filePath, startLine, endLine },
              });
            }
          }
        }
      }
    }

    return variables;
  }

  private extractImports(node: TreeSitterNode): ImportInfo[] {
    const imports: ImportInfo[] = [];

    for (const child of node.namedChildren) {
      if (child.type === 'import_statement') {
        const names = child.namedChildren
          .filter(n => n.type === 'dotted_name' || n.type === 'aliased_import')
          .map(n => {
            if (n.type === 'aliased_import') {
              const name = n.namedChildren[0]?.text ?? '';
              const alias = n.childForFieldName('alias')?.text;
              return { name, alias, isDefault: false, isNamespace: true };
            }
            return { name: n.text, isDefault: false, isNamespace: true };
          });

        if (names.length > 0) {
          imports.push({
            source: names[0]!.name,
            specifiers: names,
            isTypeOnly: false,
          });
        }
      } else if (child.type === 'import_from_statement') {
        const moduleNode = child.childForFieldName('module_name');
        const source = moduleNode?.text ?? '';

        const specifiers: ImportInfo['specifiers'] = [];
        for (const n of child.namedChildren) {
          if (n.type === 'dotted_name' && n !== moduleNode) {
            specifiers.push({ name: n.text, isDefault: false, isNamespace: false });
          } else if (n.type === 'aliased_import') {
            const name = n.namedChildren[0]?.text ?? '';
            const alias = n.childForFieldName('alias')?.text;
            specifiers.push({ name, alias, isDefault: false, isNamespace: false });
          } else if (n.type === 'wildcard_import') {
            specifiers.push({ name: '*', isDefault: false, isNamespace: true });
          }
        }

        if (source || specifiers.length > 0) {
          imports.push({
            source,
            specifiers,
            isTypeOnly: false,
          });
        }
      }
    }

    return imports;
  }

  private extractExports(
    node: TreeSitterNode,
    functions: FunctionSignature[],
    classes: ClassSignature[],
    variables: VariableSignature[]
  ): ExportInfo[] {
    const exports: ExportInfo[] = [];

    // In Python, anything not starting with _ is considered exported
    for (const func of functions) {
      if (func.modifiers.isExported && !func.parentClass) {
        exports.push({
          name: func.name,
          isDefault: false,
          isReExport: false,
        });
      }
    }

    for (const cls of classes) {
      if (cls.isExported) {
        exports.push({
          name: cls.name,
          isDefault: false,
          isReExport: false,
        });
      }
    }

    for (const variable of variables) {
      if (variable.isExported) {
        exports.push({
          name: variable.name,
          isDefault: false,
          isReExport: false,
        });
      }
    }

    // Check for __all__ definition
    for (const child of node.namedChildren) {
      if (child.type === 'expression_statement') {
        const expr = child.namedChildren[0];
        if (expr && expr.type === 'assignment') {
          const left = expr.namedChildren[0];
          if (left && left.type === 'identifier' && left.text === '__all__') {
            // __all__ overrides default exports
            const right = expr.namedChildren[1];
            if (right && right.type === 'list') {
              const explicitExports: ExportInfo[] = [];
              for (const item of right.namedChildren) {
                if (item.type === 'string') {
                  const name = this.cleanDocstring(item.text);
                  explicitExports.push({
                    name,
                    isDefault: false,
                    isReExport: false,
                  });
                }
              }
              return explicitExports;
            }
          }
        }
      }
    }

    return exports;
  }

  private buildFunctionSignature(
    name: string,
    parameters: ParameterInfo[],
    returnType: string | null,
    modifiers: FunctionModifiers,
    isAsync: boolean
  ): string {
    const parts: string[] = [];

    if (isAsync) parts.push('async');
    parts.push('def');

    const paramList = parameters.map(p => {
      let str = p.name;
      if (p.type) str += `: ${p.type}`;
      if (p.defaultValue) str += ` = ${p.defaultValue}`;
      return str;
    }).join(', ');

    let sig = `${name}(${paramList})`;
    if (returnType) {
      sig += ` -> ${returnType}`;
    }

    parts.push(sig);
    return parts.join(' ');
  }

  private buildClassSignature(
    name: string,
    extendsClass?: string,
    implementsClasses?: string[]
  ): string {
    let sig = `class ${name}`;
    const bases: string[] = [];

    if (extendsClass) {
      bases.push(extendsClass);
    }
    if (implementsClasses && implementsClasses.length > 0) {
      bases.push(...implementsClasses);
    }

    if (bases.length > 0) {
      sig += `(${bases.join(', ')})`;
    }

    return sig;
  }

  private shouldIncludeSymbol(isPrivate: boolean): boolean {
    return this.options.includePrivate || !isPrivate;
  }

  /**
   * Extract references to symbols (where identifiers are used)
   */
  private extractReferences(
    root: TreeSitterNode,
    filePath: string,
    lines: string[],
    functions: FunctionSignature[],
    classes: ClassSignature[]
  ): SymbolReference[] {
    const references: SymbolReference[] = [];

    // Build a set of known symbol names
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

    // Find all identifiers
    const findIdentifiers = (node: TreeSitterNode, containingFunc?: string): void => {
      if (node.type === 'identifier') {
        const name = node.text;

        // Skip common keywords and short names
        if (name.length < 2 || ['if', 'in', 'is', 'or', 'as', 'of'].includes(name)) {
          return;
        }

        // Skip if this is part of a definition
        const parent = node.parent;
        if (parent) {
          if (
            parent.type === 'function_definition' ||
            parent.type === 'async_function_definition' ||
            parent.type === 'class_definition' ||
            parent.type === 'parameter' ||
            parent.type === 'typed_parameter' ||
            parent.type === 'default_parameter'
          ) {
            // Check if this is the name being defined
            const nameChild = parent.childForFieldName('name');
            if (nameChild && nameChild.text === name) {
              return;
            }
          }
        }

        // Determine reference kind
        let referenceKind: ReferenceKind = 'read';

        if (parent?.type === 'call') {
          const funcNode = parent.childForFieldName('function');
          if (funcNode && funcNode.text === name) {
            referenceKind = 'call';
          }
        } else if (parent?.type === 'type') {
          referenceKind = 'type';
        } else if (parent?.type === 'import_from_statement' || parent?.type === 'import_statement') {
          referenceKind = 'import';
        } else if (parent?.type === 'assignment') {
          const leftNodes = parent.namedChildren.slice(0, -1);
          if (leftNodes.some(n => n.text === name)) {
            referenceKind = 'write';
          }
        }

        const lineNumber = node.startPosition.row + 1;
        const column = node.startPosition.column;

        // Get context
        const lineText = lines[node.startPosition.row] ?? '';
        const contextStart = Math.max(0, column - 20);
        const contextEnd = Math.min(lineText.length, column + name.length + 20);
        const context = lineText.slice(contextStart, contextEnd).trim();

        const refId = `${filePath}:ref:${name}:${lineNumber}:${column}`;

        references.push({
          id: refId,
          symbolId: '', // Will be resolved later
          symbolName: name,
          referencingFile: filePath,
          referencingSymbolId: undefined,
          referencingSymbolName: containingFunc,
          lineNumber,
          columnNumber: column,
          context,
          referenceKind,
        });
      }

      // Determine if we're entering a new function
      let newContainingFunc = containingFunc;
      if (node.type === 'function_definition' || node.type === 'async_function_definition') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          newContainingFunc = nameNode.text;
        }
      }

      // Recurse into children
      for (const child of node.namedChildren) {
        findIdentifiers(child, newContainingFunc);
      }
    };

    findIdentifiers(root);
    return references;
  }

  /**
   * Extract function call relationships
   */
  private extractCallGraph(
    root: TreeSitterNode,
    filePath: string,
    lines: string[],
    functions: FunctionSignature[],
    classes: ClassSignature[]
  ): CallGraphEdge[] {
    const calls: CallGraphEdge[] = [];
    const callCounts = new Map<string, { edge: CallGraphEdge; count: number }>();

    // Find all call expressions
    const findCalls = (node: TreeSitterNode, containingFunc?: { name: string; id: string; line: number }): void => {
      // Track containing function
      let newContainingFunc = containingFunc;
      if (node.type === 'function_definition' || node.type === 'async_function_definition') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          const funcLine = node.startPosition.row + 1;

          // Check if this is a method inside a class
          let parentClass: TreeSitterNode | null = node.parent;
          while (parentClass && parentClass.type !== 'class_definition') {
            parentClass = parentClass.parent;
          }

          if (parentClass) {
            const classNameNode = parentClass.childForFieldName('name');
            const className = classNameNode?.text ?? '';
            newContainingFunc = {
              name: `${className}.${nameNode.text}`,
              id: this.generateId(filePath, `${className}.${nameNode.text}`, 'method', funcLine),
              line: funcLine,
            };
          } else {
            newContainingFunc = {
              name: nameNode.text,
              id: this.generateId(filePath, nameNode.text, 'function', funcLine),
              line: funcLine,
            };
          }
        }
      }

      if (node.type === 'call') {
        if (newContainingFunc) {
          const funcNode = node.childForFieldName('function');
          if (funcNode) {
            let calleeName = funcNode.text;

            // Simplify method calls (obj.method -> method)
            if (calleeName.includes('.')) {
              const parts = calleeName.split('.');
              calleeName = parts[parts.length - 1] ?? calleeName;
            }

            // Check if call is inside a conditional
            let parentNode: TreeSitterNode | null = node.parent;
            let isConditional = false;
            while (parentNode) {
              if (
                parentNode.type === 'if_statement' ||
                parentNode.type === 'try_statement' ||
                parentNode.type === 'conditional_expression'
              ) {
                isConditional = true;
                break;
              }
              parentNode = parentNode.parent;
            }

            // Check if it's an async call (await)
            let isAsync = false;
            if (node.parent?.type === 'await') {
              isAsync = true;
            }

            const key = `${newContainingFunc.id}:${calleeName}`;

            if (callCounts.has(key)) {
              callCounts.get(key)!.count++;
            } else {
              const edgeId = `${filePath}:call:${newContainingFunc.name}:${calleeName}`;
              callCounts.set(key, {
                edge: {
                  id: edgeId,
                  callerSymbolId: newContainingFunc.id,
                  callerName: newContainingFunc.name,
                  calleeName,
                  calleeSymbolId: undefined, // Will be resolved later
                  callCount: 1,
                  isAsync,
                  isConditional,
                },
                count: 1,
              });
            }
          }
        }
      }

      // Recurse
      for (const child of node.namedChildren) {
        findCalls(child, newContainingFunc);
      }
    };

    findCalls(root);

    // Convert to array with counts
    for (const { edge, count } of callCounts.values()) {
      calls.push({ ...edge, callCount: count });
    }

    return calls;
  }

  /**
   * Extract type relationships (inheritance)
   */
  private extractTypeRelationships(
    filePath: string,
    classes: ClassSignature[]
  ): TypeRelationship[] {
    const relationships: TypeRelationship[] = [];

    for (const cls of classes) {
      // Handle extends (primary base class)
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

      // Handle mixins/additional base classes
      for (const impl of cls.implements) {
        const relId = `${filePath}:mixin:${cls.name}:${impl}`;
        relationships.push({
          id: relId,
          sourceSymbolId: cls.id,
          sourceName: cls.name,
          targetName: impl,
          targetSymbolId: undefined, // Will be resolved later
          relationshipKind: 'mixin',
        });
      }
    }

    return relationships;
  }
}
