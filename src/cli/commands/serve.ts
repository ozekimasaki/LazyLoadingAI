/**
 * serve command - Start the MCP server
 */

import { Command } from 'commander';
import path from 'node:path';
import { Indexer } from '../../indexer/index.js';
import { startStdioServer } from '../../server/index.js';

export const serveCommand = new Command('serve')
  .description('Start the MCP server for lazy-loading code context')
  .option('-d, --database <path>', 'Path to the index database')
  .option('-r, --root <path>', 'Root directory of the indexed codebase')
  .action(async (options) => {
    try {
      // Determine database path
      const databasePath = options.database
        ?? process.env['LAZYLOAD_DATABASE']
        ?? path.join(process.cwd(), '.lazyload/index.db');

      const rootDirectory = options.root
        ?? process.env['LAZYLOAD_ROOT']
        ?? process.cwd();

      // Create indexer
      const indexer = new Indexer({
        rootDirectory: path.resolve(rootDirectory),
        databasePath: path.resolve(databasePath),
        include: [],
        exclude: [],
      });

      await indexer.initialize();

      // Start MCP server
      await startStdioServer(indexer, {
        name: 'lazyloading-ai',
        version: '1.0.0',
      });

    } catch (error) {
      // Log to stderr since stdout is used for MCP communication
      console.error('Error starting server:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
