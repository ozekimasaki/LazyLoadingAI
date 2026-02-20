#!/usr/bin/env node

/**
 * LazyLoadingAI CLI
 */

import { Command } from 'commander';
import { indexCommand } from './commands/index-cmd.js';
import { serveCommand } from './commands/serve.js';
import { queryCommand } from './commands/query.js';
import { watchCommand } from './commands/watch.js';
import { statsCommand } from './commands/stats.js';
import { initCommand } from './commands/init.js';

const program = new Command();

program
  .name('lazy-load')
  .description('LazyLoadingAI - MCP server for lazy-loading code context')
  .version('1.0.0');

// Register commands
program.addCommand(initCommand);
program.addCommand(indexCommand);
program.addCommand(serveCommand);
program.addCommand(queryCommand);
program.addCommand(watchCommand);
program.addCommand(statsCommand);

program.parse(process.argv);
