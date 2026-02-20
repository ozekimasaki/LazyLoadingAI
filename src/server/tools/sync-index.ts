/**
 * sync_index tool implementation
 * Re-index files after edits to keep the index in sync with the codebase
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Indexer } from '../../indexer/index.js';
import { buildAllChains } from '../../markov/index.js';

export interface SyncIndexInput {
  files?: string[];
  rebuild_chains?: boolean;
}

// Auto-rebuild threshold: rebuild Markov chains when this many files change
const AUTO_REBUILD_THRESHOLD = 5;

export interface SyncIndexResult {
  indexed: string[];
  removed: string[];
  unchanged: string[];
  errors: Array<{ file: string; error: string }>;
  durationMs: number;
  chainsRebuilt?: boolean;
  autoRebuilt?: boolean;  // True if chains were auto-rebuilt due to threshold
}

export async function syncIndexTool(
  indexer: Indexer,
  input: SyncIndexInput
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const startTime = Date.now();
  const result: SyncIndexResult = {
    indexed: [],
    removed: [],
    unchanged: [],
    errors: [],
    durationMs: 0,
  };

  try {
    const storage = indexer.getStorage();

    if (input.files && input.files.length > 0) {
      // Sync specific files
      for (const filePath of input.files) {
        try {
          // Resolve to absolute path if relative
          const absolutePath = path.isAbsolute(filePath)
            ? filePath
            : path.resolve(process.cwd(), filePath);

          // Check if file exists
          const fileExists = await fs.promises.access(absolutePath).then(() => true).catch(() => false);

          if (!fileExists) {
            // File was deleted - remove from index
            await indexer.removeFile(absolutePath);
            result.removed.push(filePath);
          } else {
            // File exists - reindex it (indexer uses its configured root internally)
            const wasIndexed = await indexer.indexFile(absolutePath);
            if (wasIndexed) {
              result.indexed.push(filePath);
            } else {
              result.unchanged.push(filePath);
            }
          }
        } catch (error) {
          result.errors.push({
            file: filePath,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } else {
      // Full incremental sync - scan entire directory
      const indexResult = await indexer.indexDirectory();
      result.indexed = Array(indexResult.indexedFiles).fill('').map((_, i) => `file_${i + 1}`);
      result.unchanged = Array(indexResult.skippedFiles).fill('').map((_, i) => `unchanged_${i + 1}`);
      result.errors = indexResult.errors;
    }

    // Calculate total changes for auto-rebuild decision
    const totalChanges = result.indexed.length + result.removed.length;

    // Rebuild Markov chains if explicitly requested or if enough files changed
    const shouldRebuild = input.rebuild_chains || totalChanges >= AUTO_REBUILD_THRESHOLD;

    if (shouldRebuild && totalChanges > 0) {
      try {
        await storage.resolveSymbolReferences();
        await buildAllChains(storage, ['call_flow', 'cooccurrence', 'type_affinity', 'import_cluster']);
        result.chainsRebuilt = true;
        result.autoRebuilt = !input.rebuild_chains && totalChanges >= AUTO_REBUILD_THRESHOLD;
      } catch (error) {
        // Don't fail the whole operation if chain rebuild fails
        result.errors.push({
          file: 'markov_chains',
          error: `Chain rebuild failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    result.durationMs = Date.now() - startTime;

    // Format output
    let output = '# Index Sync Complete\n\n';

    if (input.files && input.files.length > 0) {
      output += `**Mode**: Targeted sync (${input.files.length} files)\n\n`;
    } else {
      output += `**Mode**: Full incremental sync\n\n`;
    }

    output += '## Summary\n\n';
    output += `| Status | Count |\n`;
    output += `|--------|-------|\n`;
    output += `| Re-indexed | ${result.indexed.length} |\n`;
    output += `| Removed | ${result.removed.length} |\n`;
    output += `| Unchanged | ${result.unchanged.length} |\n`;
    output += `| Errors | ${result.errors.length} |\n\n`;

    if (result.indexed.length > 0 && input.files) {
      output += '## Re-indexed Files\n\n';
      for (const file of result.indexed) {
        output += `- ${file}\n`;
      }
      output += '\n';
    }

    if (result.removed.length > 0) {
      output += '## Removed Files\n\n';
      for (const file of result.removed) {
        output += `- ${file}\n`;
      }
      output += '\n';
    }

    if (result.errors.length > 0) {
      output += '## Errors\n\n';
      for (const err of result.errors) {
        output += `- **${err.file}**: ${err.error}\n`;
      }
      output += '\n';
    }

    if (result.chainsRebuilt) {
      output += '## Markov Chains\n\n';
      if (result.autoRebuilt) {
        output += `Markov chains automatically rebuilt (${totalChanges} files changed, threshold: ${AUTO_REBUILD_THRESHOLD}).\n\n`;
      } else {
        output += 'Markov chains have been rebuilt to reflect the changes.\n\n';
      }
    }

    output += `**Duration**: ${result.durationMs}ms\n\n`;
    output += '---\n\n';
    output += 'Index is now in sync with the codebase.\n';

    return {
      content: [{ type: 'text', text: output }],
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: `# Index Sync Failed\n\n**Error**: ${errorMsg}\n\nMake sure the database path and root directory are correctly configured.`,
        },
      ],
    };
  }
}
