/**
 * stats command - Show index statistics
 */

import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs';
import { Indexer } from '../../indexer/index.js';

export const statsCommand = new Command('stats')
  .description('Show index statistics')
  .option('-d, --database <path>', 'Path to the index database', '.lazyload/index.db')
  .option('--json', 'Output as JSON', false)
  .action(async (options) => {
    try {
      const databasePath = path.resolve(options.database);

      if (!fs.existsSync(databasePath)) {
        console.error(`Database not found: ${databasePath}`);
        console.error('Run `lazy-load index` first to create the index.');
        process.exit(1);
      }

      const indexer = new Indexer({
        rootDirectory: process.cwd(),
        databasePath,
        include: [],
        exclude: [],
      });

      await indexer.initialize();

      const stats = await indexer.getStats();

      if (options.json) {
        console.log(JSON.stringify(stats, null, 2));
      } else {
        console.log('Index Statistics\n');
        console.log(`Database: ${databasePath}`);
        console.log(`Total Files: ${stats.totalFiles}`);
        console.log(`Total Symbols: ${stats.totalSymbols}`);

        console.log('\nBy Language:');
        for (const [lang, langStats] of Object.entries(stats.byLanguage)) {
          if (langStats.files > 0) {
            console.log(`\n  ${lang.charAt(0).toUpperCase() + lang.slice(1)}:`);
            console.log(`    Files:       ${langStats.files}`);
            console.log(`    Functions:   ${langStats.functions}`);
            console.log(`    Classes:     ${langStats.classes}`);
            console.log(`    Interfaces:  ${langStats.interfaces}`);
            console.log(`    Type Aliases: ${langStats.typeAliases}`);
            console.log(`    Variables:   ${langStats.variables}`);
          }
        }

        // Show database size
        const dbStats = fs.statSync(databasePath);
        const sizeKB = Math.round(dbStats.size / 1024);
        console.log(`\nDatabase Size: ${sizeKB} KB`);
      }

      await indexer.close();

    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
