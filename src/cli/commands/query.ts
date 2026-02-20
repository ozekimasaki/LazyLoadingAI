/**
 * query command - Query the index from CLI
 */

import { Command } from 'commander';
import path from 'node:path';
import { Indexer } from '../../indexer/index.js';

export const queryCommand = new Command('query')
  .description('Query the index for symbols')
  .argument('<pattern>', 'Search pattern (supports fuzzy matching)')
  .option('-d, --database <path>', 'Path to the index database', '.lazyload/index.db')
  .option('-t, --type <type>', 'Filter by symbol type (function, class, interface, type, variable)')
  .option('-l, --language <lang>', 'Filter by language (typescript, javascript, python)')
  .option('-n, --limit <number>', 'Maximum number of results', '20')
  .option('--json', 'Output as JSON', false)
  .action(async (pattern, options) => {
    try {
      const databasePath = path.resolve(options.database);

      const indexer = new Indexer({
        rootDirectory: process.cwd(),
        databasePath,
        include: [],
        exclude: [],
      });

      await indexer.initialize();

      const results = await indexer.searchSymbols(pattern, {
        type: options.type,
        language: options.language,
        limit: parseInt(options.limit, 10),
      });

      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        if (results.length === 0) {
          console.log(`No symbols found matching "${pattern}"`);
        } else {
          console.log(`Found ${results.length} symbols matching "${pattern}":\n`);

          for (const result of results) {
            const { symbol, score } = result;
            const relevance = Math.round(score * 100);

            console.log(`${symbol.name} (${symbol.kind})`);
            console.log(`  File: ${symbol.filePath}:${symbol.line}`);
            console.log(`  Relevance: ${relevance}%`);
            console.log(`  Signature: ${symbol.signature}`);
            console.log('');
          }
        }
      }

      await indexer.close();

    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
