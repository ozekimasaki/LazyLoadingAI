/**
 * get_class tool implementation
 */

import fs from 'node:fs';
import type { Indexer } from '../../indexer/index.js';
import type { ClassSignature, InterfaceSignature } from '../../types/index.js';
import { enforceOutputBudget, formatCompactSource, formatCompactTable } from './compact-format.js';

export interface GetClassInput {
  filePath: string;
  className: string;
  methodsOnly?: boolean;
  includeContext?: boolean;
  format?: 'compact' | 'markdown';
}

const DEFAULT_MAX_BYTES = 6000;

/**
 * Read source code from a file given location info
 */
async function getSourceByLocation(
  filePath: string,
  location: { startLine: number; endLine: number }
): Promise<string | null> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    const startLine = location.startLine - 1;
    const endLine = location.endLine;
    return lines.slice(startLine, endLine).join('\n');
  } catch {
    return null;
  }
}

function renderCompactClassOrInterface(
  result: { type: 'class'; data: ClassSignature } | { type: 'interface'; data: InterfaceSignature },
  relativePath: string,
  language: string,
  methodsOnly: boolean,
  source: string | null
): string {
  const kindLabel = result.type === 'class' ? 'CLASS' : 'INTERFACE';
  const lineRange = `${result.data.location.startLine}-${result.data.location.endLine}`;
  const methodRows = result.data.methods.map((method) => ({
    name: method.localName || method.name,
    line: `${method.location.startLine}-${method.location.endLine}`,
    exported: method.modifiers.isExported ? 'Y' : 'N',
    async: method.modifiers.isAsync ? 'Y' : 'N',
    static: method.modifiers.isStatic ? 'Y' : 'N',
    abstract: method.modifiers.isAbstract ? 'Y' : 'N',
    visibility: method.modifiers.isPrivate ? 'private' : method.modifiers.isProtected ? 'protected' : 'public',
    signature: method.signature,
  }));
  const propertyRows = result.data.properties.map((property) => ({
    name: property.name,
    type: property.type ?? 'unknown',
    optional: property.isOptional ? 'Y' : 'N',
    readonly: property.isReadonly ? 'Y' : 'N',
    static: property.isStatic ? 'Y' : 'N',
    visibility: property.visibility,
  }));
  const methodsCount = result.type === 'class' ? result.data.methodCount : result.data.methods.length;
  const propertiesCount = result.type === 'class' ? result.data.propertyCount : result.data.properties.length;
  const extendsValue = result.type === 'class'
    ? (result.data.extends ?? '')
    : result.data.extends.join(', ');
  const implementsValue = result.type === 'class'
    ? result.data.implements.join(', ')
    : '';
  const abstractValue = result.type === 'class' ? (result.data.isAbstract ? 'Y' : 'N') : '';
  const metadata = formatCompactTable([
    {
      name: result.data.name,
      kind: result.type,
      file: relativePath,
      line: lineRange,
      exported: result.data.isExported ? 'Y' : 'N',
      abstract: abstractValue,
      extends: extendsValue,
      implements: implementsValue,
      methods: methodsCount,
      properties: propertiesCount,
      signature: result.data.signature,
    },
  ], {
    columns: ['name', 'kind', 'file', 'line', 'exported', 'abstract', 'extends', 'implements', 'methods', 'properties', 'signature'],
  });
  const methodColumns = ['name', 'line', 'exported', 'async', 'static', 'abstract', 'visibility', 'signature'];
  const propertyColumns = ['name', 'type', 'optional', 'readonly', 'static', 'visibility'];
  const methodsTable = methodRows.length > 0
    ? formatCompactTable(methodRows, { columns: methodColumns })
    : methodColumns.join('\t');
  const propertiesTable = propertyRows.length > 0
    ? formatCompactTable(propertyRows, { columns: propertyColumns })
    : propertyColumns.join('\t');

  const sections: string[] = [
    `[${kindLabel}] ${result.data.name} (${relativePath}:${lineRange})`,
    metadata,
    '[METHODS]',
    methodsTable,
    '[PROPERTIES]',
    propertiesTable,
  ];

  if (!methodsOnly && source) {
    sections.push(formatCompactSource(`${relativePath}:${lineRange} ${language}`, source));
  }

  return enforceOutputBudget(sections.join('\n'), DEFAULT_MAX_BYTES);
}

/**
 * Format class output
 */
function formatClassOutput(
  cls: ClassSignature,
  relativePath: string,
  language: string,
  methodsOnly: boolean,
  source: string | null
): string {
  let output = `# ${cls.name} (class)\n\n`;
  output += `**File**: \`${relativePath}\`\n`;
  output += `**Lines**: ${cls.location.startLine}-${cls.location.endLine}\n`;

  if (cls.extends) {
    output += `**Extends**: ${cls.extends}\n`;
  }

  if (cls.implements.length > 0) {
    output += `**Implements**: ${cls.implements.join(', ')}\n`;
  }

  output += `**Methods**: ${cls.methodCount}\n`;
  output += `**Properties**: ${cls.propertyCount}\n`;

  if (cls.isAbstract) {
    output += `**Abstract**: Yes\n`;
  }

  if (cls.documentation?.description) {
    output += `\n## Description\n\n${cls.documentation.description}\n`;
  }

  if (methodsOnly) {
    // Just show signatures, not full source
    output += `\n## Signature\n\n`;
    output += '```' + language + '\n';
    output += cls.signature + ' {\n';

    if (cls.constructorSignature) {
      output += `  ${cls.constructorSignature};\n`;
    }

    for (const prop of cls.properties) {
      const visibility = prop.visibility !== 'public' ? `${prop.visibility} ` : '';
      const readonly = prop.isReadonly ? 'readonly ' : '';
      const staticMod = prop.isStatic ? 'static ' : '';
      const optional = prop.isOptional ? '?' : '';
      output += `  ${visibility}${staticMod}${readonly}${prop.name}${optional}: ${prop.type ?? 'unknown'};\n`;
    }

    if (cls.properties.length > 0 && cls.methods.length > 0) {
      output += '\n';
    }

    for (const method of cls.methods) {
      output += `  ${method.signature};\n`;
    }

    output += '}\n';
    output += '```\n';
  } else {
    // Show full source code
    output += `\n## Properties\n\n`;

    if (cls.properties.length === 0) {
      output += `_No properties_\n`;
    } else {
      for (const prop of cls.properties) {
        output += `- **${prop.name}**: \`${prop.type ?? 'unknown'}\``;
        if (prop.visibility !== 'public') {
          output += ` _(${prop.visibility})_`;
        }
        if (prop.isStatic) {
          output += ` _(static)_`;
        }
        if (prop.isReadonly) {
          output += ` _(readonly)_`;
        }
        if (prop.documentation?.description) {
          output += ` - ${prop.documentation.description}`;
        }
        output += '\n';
      }
    }

    output += `\n## Methods\n\n`;

    if (cls.methods.length === 0) {
      output += `_No methods_\n`;
    } else {
      for (const method of cls.methods) {
        const modifiers: string[] = [];
        if (method.modifiers.isStatic) modifiers.push('static');
        if (method.modifiers.isAsync) modifiers.push('async');
        if (method.modifiers.isAbstract) modifiers.push('abstract');
        if (method.modifiers.isPrivate) modifiers.push('private');
        if (method.modifiers.isProtected) modifiers.push('protected');

        output += `- **${method.name}**`;
        if (modifiers.length > 0) {
          output += ` _(${modifiers.join(', ')})_`;
        }
        output += ` - Line ${method.location.startLine}\n`;
      }
    }

    if (source) {
      output += `\n## Source Code\n\n`;
      output += '```' + language + '\n';
      output += source + '\n';
      output += '```\n';
    }
  }

  return output;
}

/**
 * Format interface output
 */
function formatInterfaceOutput(
  iface: InterfaceSignature,
  relativePath: string,
  language: string,
  methodsOnly: boolean,
  source: string | null
): string {
  let output = `# ${iface.name} (interface)\n\n`;
  output += `**File**: \`${relativePath}\`\n`;
  output += `**Lines**: ${iface.location.startLine}-${iface.location.endLine}\n`;

  if (iface.extends.length > 0) {
    output += `**Extends**: ${iface.extends.join(', ')}\n`;
  }

  output += `**Methods**: ${iface.methods.length}\n`;
  output += `**Properties**: ${iface.properties.length}\n`;

  if (iface.documentation?.description) {
    output += `\n## Description\n\n${iface.documentation.description}\n`;
  }

  if (methodsOnly) {
    // Just show signatures, not full source
    output += `\n## Signature\n\n`;
    output += '```' + language + '\n';
    output += iface.signature + ' {\n';

    for (const prop of iface.properties) {
      const readonly = prop.isReadonly ? 'readonly ' : '';
      const optional = prop.isOptional ? '?' : '';
      output += `  ${readonly}${prop.name}${optional}: ${prop.type ?? 'unknown'};\n`;
    }

    if (iface.properties.length > 0 && iface.methods.length > 0) {
      output += '\n';
    }

    for (const method of iface.methods) {
      output += `  ${method.signature};\n`;
    }

    output += '}\n';
    output += '```\n';
  } else {
    // Show full source code
    output += `\n## Properties\n\n`;

    if (iface.properties.length === 0) {
      output += `_No properties_\n`;
    } else {
      for (const prop of iface.properties) {
        output += `- **${prop.name}**: \`${prop.type ?? 'unknown'}\``;
        if (prop.isReadonly) {
          output += ` _(readonly)_`;
        }
        if (prop.documentation?.description) {
          output += ` - ${prop.documentation.description}`;
        }
        output += '\n';
      }
    }

    output += `\n## Methods\n\n`;

    if (iface.methods.length === 0) {
      output += `_No methods_\n`;
    } else {
      for (const method of iface.methods) {
        output += `- **${method.name}** - Line ${method.location.startLine}\n`;
      }
    }

    if (source) {
      output += `\n## Source Code\n\n`;
      output += '```' + language + '\n';
      output += source + '\n';
      output += '```\n';
    }
  }

  return output;
}

export async function getClassTool(
  indexer: Indexer,
  input: GetClassInput
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const outputMode = input.format ?? 'compact';

  // First resolve the path
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

  const resolvedPath = resolved.result.resolvedPath;

  // Show auto-resolution message if applicable
  let autoResolveNote = '';
  if (resolved.result.autoResolved && resolved.result.originalInput) {
    autoResolveNote = `> Auto-resolved \`${resolved.result.originalInput}\` → \`${resolved.result.relativePath}\`\n\n`;
  }

  const result = await indexer.getClassOrInterface(resolvedPath, input.className);

  if (!result) {
    return {
      content: [
        {
          type: 'text',
          text: `Class/interface \`${input.className}\` not found in ${resolved.result.relativePath}. Use \`list_functions\` to see available.`,
        },
      ],
    };
  }

  const file = await indexer.getFile(resolvedPath);
  const language = file?.language ?? 'typescript';

  // Get source code if not methodsOnly
  let source: string | null = null;
  if (!input.methodsOnly) {
    source = await getSourceByLocation(resolvedPath, result.data.location);
    if (!source) {
      return {
        content: [
          {
            type: 'text',
            text: `Could not read source: ${resolved.result.relativePath}. File may have moved since indexing.`,
          },
        ],
      };
    }
  }

  if (outputMode === 'compact') {
    return {
      content: [
        {
          type: 'text',
          text: renderCompactClassOrInterface(
            result as { type: 'class'; data: ClassSignature } | { type: 'interface'; data: InterfaceSignature },
            resolved.result.relativePath,
            language,
            input.methodsOnly ?? false,
            source
          ),
        },
      ],
    };
  }

  let output = autoResolveNote;
  if (result.type === 'class') {
    output += formatClassOutput(result.data, resolved.result.relativePath, language, input.methodsOnly ?? false, source);
  } else {
    output += formatInterfaceOutput(result.data, resolved.result.relativePath, language, input.methodsOnly ?? false, source);
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
