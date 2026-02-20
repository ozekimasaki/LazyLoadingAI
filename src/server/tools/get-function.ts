/**
 * get_function tool implementation
 */

import type { Indexer } from '../../indexer/index.js';
import { enforceOutputBudget, formatCompactSource, formatCompactTable } from './compact-format.js';

export interface GetFunctionInput {
  filePath: string;
  functionName: string;
  includeContext?: boolean;
  contextLines?: number;
  format?: 'compact' | 'markdown';
}

const DEFAULT_MAX_BYTES = 6000;

export async function getFunctionTool(
  indexer: Indexer,
  input: GetFunctionInput
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
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

  // Try the storage's getFunctionWithDetails for better error messages
  const funcResult = await indexer.getFunctionWithDetails(resolvedPath, input.functionName);

  if (funcResult.success) {
    return getFunctionSource(
      indexer,
      { ...input, filePath: resolvedPath },
      funcResult.function,
      autoResolveNote,
      resolved.result.relativePath
    );
  }

  // If not found directly, try to find the function in classes (for methods)
  const file = await indexer.getFile(resolvedPath);
  if (file) {
    // Check for method match - both direct name and qualified name
    for (const cls of file.classes) {
      const method = cls.methods.find(m =>
        m.name === input.functionName ||
        m.localName === input.functionName ||
        `${cls.name}.${m.localName}` === input.functionName
      );
      if (method) {
        return getFunctionSource(
          indexer,
          { ...input, filePath: resolvedPath },
          method,
          autoResolveNote,
          resolved.result.relativePath
        );
      }
    }

    // Check for nested function by local name if ambiguous
    if (funcResult.suggestions && funcResult.suggestions.length > 1) {
      return {
        content: [
          {
            type: 'text',
            text: `${funcResult.error}\n\nAvailable matches:\n${funcResult.suggestions.map(s => `  - ${s}`).join('\n')}\n\nUse the qualified name (e.g., \`parentFunction.nestedFunction\`) to retrieve the specific function.`,
          },
        ],
      };
    }
  }

  return {
    content: [
      {
        type: 'text',
        text: `Function \`${input.functionName}\` not found in ${resolved.result.relativePath}. Use \`list_functions\` to see available.`,
      },
    ],
  };
}

async function getFunctionSource(
  indexer: Indexer,
  input: GetFunctionInput,
  func: import('../../types/index.js').FunctionSignature,
  autoResolveNote: string = '',
  relativePath?: string
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const outputMode = input.format ?? 'compact';
  let source: string | null;
  let startLine = func.location.startLine;
  let endLine = func.location.endLine;

  if (input.includeContext) {
    const result = await indexer.getSourceWithContext(
      input.filePath,
      func.location.startLine,
      func.location.endLine,
      input.contextLines ?? 3
    );

    if (result) {
      source = result.source;
      startLine = result.actualStartLine;
      endLine = result.actualEndLine;
    } else {
      source = null;
    }
  } else {
    source = await indexer.getFunctionSource(input.filePath, input.functionName);
  }

  if (!source) {
    return {
      content: [
        {
          type: 'text',
          text: `Could not read source: ${input.filePath}. File may have moved since indexing.`,
        },
      ],
    };
  }

  const file = await indexer.getFile(input.filePath);
  const language = file?.language ?? 'typescript';
  const displayPath = relativePath ?? file?.relativePath ?? input.filePath;

  if (outputMode === 'compact') {
    const metadata = formatCompactTable([
      {
        name: func.name,
        kind: func.kind,
        file: displayPath,
        line: `${startLine}-${endLine}`,
        class: func.parentClass ?? '',
        async: func.modifiers.isAsync ? 'Y' : 'N',
        exported: func.modifiers.isExported ? 'Y' : 'N',
        signature: func.signature,
      },
    ], {
      columns: ['name', 'kind', 'file', 'line', 'class', 'async', 'exported', 'signature'],
    });

    const compactOutput = enforceOutputBudget([
      '[FUNCTION]',
      metadata,
      formatCompactSource(`${displayPath}:${startLine}-${endLine} ${language}`, source),
    ].join('\n'), DEFAULT_MAX_BYTES);

    return {
      content: [
        {
          type: 'text',
          text: compactOutput,
        },
      ],
    };
  }

  let output = autoResolveNote;
  output += `# ${func.name}\n\n`;
  output += `**File**: \`${displayPath}\`\n`;
  output += `**Lines**: ${startLine}-${endLine}\n`;
  output += `**Kind**: ${func.kind}\n`;

  if (func.parentClass) {
    output += `**Class**: ${func.parentClass}\n`;
  }

  if (func.documentation?.description) {
    output += `\n## Description\n\n${func.documentation.description}\n`;
  }

  if (func.documentation?.params && func.documentation.params.length > 0) {
    output += `\n## Parameters\n\n`;
    for (const param of func.documentation.params) {
      output += `- **${param.name}**: ${param.description}\n`;
    }
  }

  if (func.documentation?.returns) {
    output += `\n## Returns\n\n${func.documentation.returns}\n`;
  }

  output += `\n## Source Code\n\n`;
  output += '```' + language + '\n';
  output += source + '\n';
  output += '```\n';

  return {
    content: [
      {
        type: 'text',
        text: output,
      },
    ],
  };
}
