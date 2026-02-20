/**
 * list_files tool implementation
 */

import type { Indexer } from '../../indexer/index.js';
import type { Language } from '../../types/index.js';
import { enforceOutputBudget, formatCompactTable } from './compact-format.js';

// Default patterns to exclude (tests, generated code, etc.)
const DEFAULT_EXCLUDE_PATTERNS = [
  '**/tests/**',
  '**/test/**',
  '**/*.test.*',
  '**/*.spec.*',
  '**/coverage/**',
  '**/node_modules/**',
  '**/__pycache__/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
];
const DEFAULT_MAX_BYTES = 4000;

export interface ListFilesInput {
  directory?: string;
  recursive?: boolean;
  language?: Language;
  limit?: number;              // Default: 50
  offset?: number;             // For pagination
  exclude_patterns?: string[]; // Glob patterns to exclude
  include_tests?: boolean;     // Default: false
  summary_only?: boolean;      // Just counts per directory
  format?: 'compact' | 'markdown';
}

/**
 * Check if a file path matches any of the given glob patterns
 */
function matchesPattern(filePath: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    // Simple glob matching for common patterns
    const regexPattern = pattern
      .replace(/\*\*/g, '{{DOUBLESTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/{{DOUBLESTAR}}/g, '.*')
      .replace(/\./g, '\\.')
      .replace(/\?/g, '.');

    if (new RegExp(regexPattern).test(filePath)) {
      return true;
    }
  }
  return false;
}

function renderCompactSummary(
  filesByDir: Map<string, Array<{ lineCount: number; functions: unknown[]; classes: unknown[] }>>,
  totalFilesAfterFilter: number,
  includeTests: boolean
): string {
  const rows = [...filesByDir.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([dir, dirFiles]) => ({
      directory: `${dir}/`,
      files: dirFiles.length,
      lines: dirFiles.reduce((sum, file) => sum + file.lineCount, 0),
      functions: dirFiles.reduce((sum, file) => sum + file.functions.length, 0),
      classes: dirFiles.reduce((sum, file) => sum + file.classes.length, 0),
    }));
  const columns = ['directory', 'files', 'lines', 'functions', 'classes'];
  const table = rows.length > 0
    ? formatCompactTable(rows, { columns })
    : columns.join('\t');

  return enforceOutputBudget([
    `[DIRECTORIES] total=${totalFilesAfterFilter} include_tests=${includeTests ? 'Y' : 'N'}`,
    table,
  ].join('\n'), DEFAULT_MAX_BYTES);
}

function renderCompactFiles(
  paginatedFiles: Array<{ relativePath: string; language: string; lineCount: number; functions: unknown[]; classes: unknown[] }>,
  totalFilesAfterFilter: number,
  offset: number,
  limit: number
): string {
  const rows = paginatedFiles.map((file) => ({
    path: file.relativePath,
    language: file.language,
    lines: file.lineCount,
    functions: file.functions.length,
    classes: file.classes.length,
  }));
  const columns = ['path', 'language', 'lines', 'functions', 'classes'];
  const table = rows.length > 0
    ? formatCompactTable(rows, { columns })
    : columns.join('\t');
  const hasMore = offset + paginatedFiles.length < totalFilesAfterFilter;
  const sections = [
    `[FILES] total=${totalFilesAfterFilter} offset=${offset} showing=${paginatedFiles.length}`,
    table,
  ];

  if (hasMore) {
    sections.push(`[NEXT_OFFSET] ${offset + limit}`);
  }

  return enforceOutputBudget(sections.join('\n'), DEFAULT_MAX_BYTES);
}

export async function listFilesTool(
  indexer: Indexer,
  input: ListFilesInput
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const limit = input.limit ?? 50;
  const offset = input.offset ?? 0;
  const includeTests = input.include_tests ?? false;
  const summaryOnly = input.summary_only ?? false;
  const outputMode = input.format ?? 'compact';

  // Build exclusion patterns
  const excludePatterns = input.exclude_patterns ?? [];
  if (!includeTests) {
    // Add test exclusion patterns if not including tests
    excludePatterns.push(
      '**/tests/**',
      '**/test/**',
      '**/*.test.*',
      '**/*.spec.*',
      '**/__tests__/**'
    );
  }

  let files = await indexer.listFiles({
    directory: input.directory,
    language: input.language,
  });

  if (files.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'No indexed files found. Run `lazy-load index <directory>` to index your codebase.',
        },
      ],
    };
  }

  // Apply exclusion patterns
  if (excludePatterns.length > 0) {
    files = files.filter(f => !matchesPattern(f.relativePath, excludePatterns));
  }

  const totalFilesAfterFilter = files.length;

  // Group by directory
  const filesByDir = new Map<string, typeof files>();
  for (const file of files) {
    const dir = file.relativePath.split('/').slice(0, -1).join('/') || '.';
    if (!filesByDir.has(dir)) {
      filesByDir.set(dir, []);
    }
    filesByDir.get(dir)!.push(file);
  }

  if (outputMode === 'compact') {
    if (summaryOnly) {
      return {
        content: [
          {
            type: 'text',
            text: renderCompactSummary(filesByDir as Map<string, Array<{ lineCount: number; functions: unknown[]; classes: unknown[] }>>, totalFilesAfterFilter, includeTests),
          },
        ],
      };
    }

    const paginatedFiles = files.slice(offset, offset + limit);
    return {
      content: [
        {
          type: 'text',
          text: renderCompactFiles(
            paginatedFiles as Array<{ relativePath: string; language: string; lineCount: number; functions: unknown[]; classes: unknown[] }>,
            totalFilesAfterFilter,
            offset,
            limit
          ),
        },
      ],
    };
  }

  // Summary only mode - just show counts per directory
  if (summaryOnly) {
    let output = `# Codebase Summary (${totalFilesAfterFilter} files)\n\n`;
    output += '| Directory | Files | Lines | Functions | Classes |\n';
    output += '|-----------|-------|-------|-----------|--------|\n';

    // Sort directories by file count (descending)
    const sortedDirs = [...filesByDir.entries()].sort((a, b) => b[1].length - a[1].length);

    for (const [dir, dirFiles] of sortedDirs) {
      const totalLines = dirFiles.reduce((sum, f) => sum + f.lineCount, 0);
      const totalFuncs = dirFiles.reduce((sum, f) => sum + f.functions.length, 0);
      const totalClasses = dirFiles.reduce((sum, f) => sum + f.classes.length, 0);
      output += `| ${dir}/ | ${dirFiles.length} | ${totalLines} | ${totalFuncs} | ${totalClasses} |\n`;
    }

    output += `\n**Total**: ${totalFilesAfterFilter} files`;
    if (!includeTests) {
      output += ' (excluding tests)';
    }
    output += '\n\nUse `list_files` without `summary_only` to see individual files.';

    return {
      content: [
        {
          type: 'text',
          text: output,
        },
      ],
    };
  }

  // Apply pagination (after filtering but before output generation)
  const paginatedFiles = files.slice(offset, offset + limit);
  const hasMore = offset + limit < totalFilesAfterFilter;

  // Re-group paginated files by directory
  const paginatedByDir = new Map<string, typeof files>();
  for (const file of paginatedFiles) {
    const dir = file.relativePath.split('/').slice(0, -1).join('/') || '.';
    if (!paginatedByDir.has(dir)) {
      paginatedByDir.set(dir, []);
    }
    paginatedByDir.get(dir)!.push(file);
  }

  let output = `# Indexed Files`;
  if (offset > 0 || hasMore) {
    output += ` (${offset + 1}-${offset + paginatedFiles.length} of ${totalFilesAfterFilter})`;
  } else {
    output += ` (${totalFilesAfterFilter} total)`;
  }
  output += '\n\n';

  for (const [dir, dirFiles] of paginatedByDir) {
    output += `## ${dir}/\n\n`;

    for (const file of dirFiles) {
      const fileName = file.relativePath.split('/').pop();
      const funcCount = file.functions.length;
      const classCount = file.classes.length;

      output += `### ${fileName} (${file.lineCount} lines)\n`;
      output += `- **Path**: \`${file.relativePath}\`\n`;
      output += `- **Language**: ${file.language}\n`;
      output += `- **Functions**: ${funcCount}`;
      if (classCount > 0) {
        output += `, **Classes**: ${classCount}`;
      }
      output += '\n';
      if (file.summary) {
        output += `- **Summary**: ${file.summary}\n`;
      }
      output += '\n';
    }
  }

  // Add pagination hint if there are more results
  if (hasMore) {
    output += `---\n\n**More files available.** Use \`offset: ${offset + limit}\` to see next page.\n`;
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
