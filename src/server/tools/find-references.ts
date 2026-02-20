/**
 * find_references tool implementation
 * Find all usages of a symbol across the codebase
 */

import type { Indexer } from '../../indexer/index.js';
import { enforceOutputBudget, formatCompactTable } from './compact-format.js';

const DEFAULT_MAX_BYTES = 3000;

export interface FindReferencesInput {
  symbolName: string;
  filePath?: string;
  limit?: number;
  format?: 'compact' | 'markdown';
}

export async function findReferencesTool(
  indexer: Indexer,
  input: FindReferencesInput
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const limit = input.limit ?? 50;
  const outputMode = input.format ?? 'compact';

  // Get references by name
  let references = await indexer.getReferencesByName(input.symbolName);

  // Filter by file path if provided
  if (input.filePath) {
    references = references.filter(ref => ref.referencingFile.includes(input.filePath!));
  }

  // Limit results
  const totalCount = references.length;
  references = references.slice(0, limit);

  if (references.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: `No references found for \`${input.symbolName}\`. Try different name or run \`resolve\`.`,
        },
      ],
    };
  }

  if (outputMode === 'compact') {
    const summary = `[REFS "${input.symbolName}" (${totalCount} total${totalCount > references.length ? `, showing ${references.length}` : ''})]`;
    const rows = references.map(ref => ({
      file: ref.referencingFile,
      line: ref.lineNumber,
      kind: ref.referenceKind,
      context: ref.context,
    }));
    const table = formatCompactTable(rows, {
      columns: ['file', 'line', 'kind', 'context'],
    });
    const output = enforceOutputBudget([summary, table].join('\n'), DEFAULT_MAX_BYTES);

    return {
      content: [
        {
          type: 'text',
          text: output,
        },
      ],
    };
  }

  let output = `# References to "${input.symbolName}"\n\n`;
  output += `Found ${totalCount} references`;
  if (totalCount > limit) {
    output += ` (showing first ${limit})`;
  }
  output += '\n\n';

  // Group by file
  const byFile = new Map<string, typeof references>();
  for (const ref of references) {
    const file = ref.referencingFile;
    if (!byFile.has(file)) {
      byFile.set(file, []);
    }
    byFile.get(file)!.push(ref);
  }

  for (const [file, fileRefs] of byFile) {
    output += `## ${file}\n\n`;

    for (const ref of fileRefs) {
      output += `- **Line ${ref.lineNumber}**: \`${ref.context}\`\n`;
      output += `  - Kind: ${ref.referenceKind}`;
      if (ref.referencingSymbolName) {
        output += ` | In: \`${ref.referencingSymbolName}\``;
      }
      output += '\n';
    }

    output += '\n';
  }

  // Only show legend when result count is low
  if (references.length < 5) {
    output += `---\n`;
    output += `Kinds: call, read, write, type, import\n`;
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
