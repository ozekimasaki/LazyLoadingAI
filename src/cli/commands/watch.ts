/**
 * watch command - Watch directory and re-index on changes
 */

import { Command } from 'commander';
import path from 'node:path';
import { Indexer, Watcher } from '../../indexer/index.js';
import { loadConfig, getDefaultConfig } from '../../config/loader.js';

export const watchCommand = new Command('watch')
  .description('Watch a directory and re-index on file changes')
  .argument('[directory]', 'Directory to watch', '.')
  .option('-c, --config <path>', 'Path to config file')
  .option('-d, --database <path>', 'Path to the index database', '.lazyload/index.db')
  .option('--verbose', 'Show verbose output', false)
  .action(async (directory, options) => {
    const rootDirectory = path.resolve(directory);
    const databasePath = path.resolve(rootDirectory, options.database);

    console.log(`Watching ${rootDirectory} for changes...`);
    console.log(`Database: ${databasePath}\n`);

    try {
      // Load config
      let config = options.config
        ? await loadConfig(options.config)
        : await loadConfig(path.join(rootDirectory, 'lazyload.config.json')).catch(() => getDefaultConfig());

      // Create indexer
      const indexer = new Indexer({
        rootDirectory,
        databasePath,
        include: config.include,
        exclude: config.exclude,
      });

      await indexer.initialize();

      // Initial index
      console.log('Performing initial index...');
      const result = await indexer.indexDirectory();
      console.log(`Indexed ${result.indexedFiles} files\n`);

      // Create watcher
      const watcher = new Watcher(
        indexer,
        rootDirectory,
        config.include,
        config.exclude,
        { debounceMs: 300 }
      );

      watcher.on('indexed', ({ filePath, isNew }) => {
        const relativePath = path.relative(rootDirectory, filePath);
        if (options.verbose || isNew) {
          console.log(`${isNew ? 'Indexed' : 'Updated'}: ${relativePath}`);
        }
      });

      watcher.on('removed', ({ filePath }) => {
        const relativePath = path.relative(rootDirectory, filePath);
        console.log(`Removed: ${relativePath}`);
      });

      watcher.on('error', ({ filePath, error }) => {
        const relativePath = path.relative(rootDirectory, filePath);
        console.error(`Error indexing ${relativePath}: ${error.message}`);
      });

      watcher.on('ready', () => {
        console.log('Watching for changes... (Press Ctrl+C to stop)\n');
      });

      await watcher.start();

      // Handle shutdown
      const shutdown = async () => {
        console.log('\nShutting down...');
        await watcher.stop();
        await indexer.close();
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
