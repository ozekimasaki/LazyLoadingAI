/**
 * index command - Index a codebase
 */

import { Command } from 'commander';
import path from 'node:path';
import { Indexer } from '../../indexer/index.js';
import { loadConfig, getDefaultConfig } from '../../config/loader.js';

export const indexCommand = new Command('index')
  .description('Index a codebase for lazy-loading')
  .argument('[directory]', 'Directory to index', '.')
  .option('-c, --config <path>', 'Path to config file')
  .option('-o, --output <path>', 'Path to output database', '.lazyload/index.db')
  .option('--include <patterns...>', 'Glob patterns to include')
  .option('--exclude <patterns...>', 'Glob patterns to exclude')
  .option('--verbose', 'Show verbose output', false)
  .action(async (directory, options) => {
    const startTime = Date.now();
    const rootDirectory = path.resolve(directory);

    console.log(`Indexing ${rootDirectory}...\n`);

    try {
      // Load config
      let config = options.config
        ? await loadConfig(options.config)
        : await loadConfig(path.join(rootDirectory, 'lazyload.config.json')).catch(() => getDefaultConfig());

      // Override with CLI options
      const databasePath = path.resolve(rootDirectory, options.output);

      const indexer = new Indexer({
        rootDirectory,
        databasePath,
        include: options.include ?? config.include,
        exclude: options.exclude ?? config.exclude,
      });

      await indexer.initialize();

      const result = await indexer.indexDirectory();

      console.log(`Indexing complete!\n`);
      console.log(`  Total files:   ${result.totalFiles}`);
      console.log(`  Indexed:       ${result.indexedFiles}`);
      console.log(`  Skipped:       ${result.skippedFiles}`);
      console.log(`  Errors:        ${result.errors.length}`);
      console.log(`  Duration:      ${result.durationMs}ms`);
      console.log(`  Database:      ${databasePath}\n`);

      if (result.errors.length > 0 && options.verbose) {
        console.log('Errors:');
        for (const error of result.errors) {
          console.log(`  ${error.file}: ${error.error}`);
        }
        console.log('');
      }

      // Show stats
      const stats = await indexer.getStats();
      console.log('Index statistics:');
      console.log(`  Total symbols: ${stats.totalSymbols}`);

      for (const [lang, langStats] of Object.entries(stats.byLanguage)) {
        if (langStats.files > 0) {
          console.log(`\n  ${lang}:`);
          console.log(`    Files:      ${langStats.files}`);
          console.log(`    Functions:  ${langStats.functions}`);
          console.log(`    Classes:    ${langStats.classes}`);
          if (langStats.interfaces > 0) {
            console.log(`    Interfaces: ${langStats.interfaces}`);
          }
          if (langStats.typeAliases > 0) {
            console.log(`    Types:      ${langStats.typeAliases}`);
          }
        }
      }

      await indexer.close();

    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
