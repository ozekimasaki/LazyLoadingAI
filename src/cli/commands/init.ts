/**
 * init command - Interactive setup wizard for LazyLoadingAI
 */

import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import * as TOML from '@iarna/toml';
import { Indexer } from '../../indexer/index.js';
import {
  generateClaudeMdContent,
  hasLazyLoadingSection as hasClaudeMdSection,
} from '../../templates/claude-md.js';
import {
  generateAgentsMdContent,
  hasLazyLoadingSection as hasAgentsMdSection,
} from '../../templates/agents-md.js';

interface InitOptions {
  claude?: boolean;
  codex?: boolean;
  cursor?: boolean;
  all?: boolean;
  skipIndex?: boolean;
  directories?: string[];
  yes?: boolean;
}

interface ToolSelection {
  claude: boolean;
  codex: boolean;
  cursor: boolean;
}

interface PromptOption {
  name: string;
  value: string;
  checked?: boolean;
}

// ANSI colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message: string): void {
  console.log(message);
}

function logSuccess(message: string): void {
  console.log(`${colors.green}✓${colors.reset} ${message}`);
}

function logWarning(message: string): void {
  console.log(`${colors.yellow}⚠${colors.reset} ${message}`);
}

function logInfo(message: string): void {
  console.log(`${colors.blue}ℹ${colors.reset} ${message}`);
}

function logHeader(message: string): void {
  console.log(`\n${colors.bold}${colors.cyan}${message}${colors.reset}\n`);
}

/**
 * Simple prompt function using readline
 */
async function prompt(question: string, defaultValue?: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const defaultHint = defaultValue ? ` ${colors.dim}(${defaultValue})${colors.reset}` : '';

  return new Promise((resolve) => {
    rl.question(`${question}${defaultHint}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

/**
 * Yes/No prompt
 */
async function confirmPrompt(question: string, defaultYes: boolean = true): Promise<boolean> {
  const hint = defaultYes ? '[Y/n]' : '[y/N]';
  const answer = await prompt(`${question} ${hint}`);

  if (!answer) return defaultYes;
  return answer.toLowerCase().startsWith('y');
}

/**
 * Multi-select prompt using checkboxes
 */
async function multiSelectPrompt(
  question: string,
  options: PromptOption[]
): Promise<string[]> {
  console.log(`\n${question}`);
  console.log(`${colors.dim}(space to toggle, enter to confirm)${colors.reset}\n`);

  const selected = new Set<string>(
    options.filter(o => o.checked).map(o => o.value)
  );

  let currentIndex = 0;

  // Check if we're in an interactive terminal
  if (!process.stdin.isTTY) {
    // Non-interactive mode: return defaults
    return Array.from(selected);
  }

  return new Promise((resolve) => {
    const renderOptions = () => {
      // Move cursor up to re-render
      if (currentIndex > 0 || selected.size > 0) {
        process.stdout.write(`\x1b[${options.length}A`);
      }

      for (let i = 0; i < options.length; i++) {
        const opt = options[i]!;
        const isSelected = selected.has(opt.value);
        const cursor = i === currentIndex ? '>' : ' ';
        const checkbox = isSelected ? '[x]' : '[ ]';
        const line = `${cursor} ${checkbox} ${opt.name}`;

        // Clear line and write
        process.stdout.write(`\x1b[2K${line}\n`);
      }
    };

    // Initial render
    for (const opt of options) {
      const isSelected = selected.has(opt.value);
      const checkbox = isSelected ? '[x]' : '[ ]';
      console.log(`  ${checkbox} ${opt.name}`);
    }

    // Enable raw mode to capture keypresses
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    const onKeypress = (key: Buffer) => {
      const char = key.toString();

      // Handle special keys
      if (char === '\x03') {
        // Ctrl+C
        process.stdin.setRawMode?.(false);
        process.exit(0);
      } else if (char === '\r' || char === '\n') {
        // Enter
        process.stdin.setRawMode?.(false);
        process.stdin.removeListener('data', onKeypress);
        process.stdin.pause();
        console.log('');
        resolve(Array.from(selected));
      } else if (char === ' ') {
        // Space - toggle selection
        const opt = options[currentIndex]!;
        if (selected.has(opt.value)) {
          selected.delete(opt.value);
        } else {
          selected.add(opt.value);
        }
        renderOptions();
      } else if (char === '\x1b[A' || char === 'k') {
        // Up arrow or k
        currentIndex = Math.max(0, currentIndex - 1);
        renderOptions();
      } else if (char === '\x1b[B' || char === 'j') {
        // Down arrow or j
        currentIndex = Math.min(options.length - 1, currentIndex + 1);
        renderOptions();
      }
    };

    process.stdin.on('data', onKeypress);
  });
}

/**
 * Determine which tools to configure based on CLI options or user input
 */
async function selectTools(options: InitOptions): Promise<ToolSelection> {
  // If specific tools are selected via flags
  if (options.claude || options.codex || options.cursor) {
    return {
      claude: !!options.claude,
      codex: !!options.codex,
      cursor: !!options.cursor,
    };
  }

  // If --all flag is set
  if (options.all) {
    return {
      claude: true,
      codex: true,
      cursor: true,
    };
  }

  // If --yes flag, use defaults (all tools)
  if (options.yes) {
    return {
      claude: true,
      codex: true,
      cursor: true,
    };
  }

  // Interactive selection
  const selected = await multiSelectPrompt(
    'Which AI tools do you use?',
    [
      { name: 'Claude Code', value: 'claude', checked: true },
      { name: 'Codex CLI', value: 'codex', checked: true },
      { name: 'Cursor', value: 'cursor', checked: true },
    ]
  );

  return {
    claude: selected.includes('claude'),
    codex: selected.includes('codex'),
    cursor: selected.includes('cursor'),
  };
}

/**
 * Get directories to index
 */
async function promptDirectories(options: InitOptions): Promise<string[]> {
  // If user explicitly specifies directories, use those
  if (options.directories && options.directories.length > 0) {
    return options.directories;
  }

  // Default to current directory - the indexer already ignores node_modules, .git, etc.
  return ['.'];
}

/**
 * Get the path to the LazyLoadingAI CLI
 */
function getCliPath(): string {
  // Get the directory of this script
  const scriptDir = path.dirname(new URL(import.meta.url).pathname);
  // Navigate up to dist/cli/index.js
  const cliPath = path.resolve(scriptDir, '../index.js');
  return cliPath;
}

/**
 * Generate Claude Code .mcp.json config
 */
async function generateClaudeConfig(projectPath: string): Promise<boolean> {
  const configPath = path.join(projectPath, '.mcp.json');
  const cliPath = getCliPath();

  const serverConfig = {
    command: 'node',
    args: [cliPath, 'serve', '--root', '.'],
  };

  let config: Record<string, unknown> = {};

  // Check if file exists and merge
  if (fs.existsSync(configPath)) {
    try {
      const existingContent = await fs.promises.readFile(configPath, 'utf-8');
      config = JSON.parse(existingContent);

      // Check if lazyloadingai is already configured
      const mcpServers = (config['mcpServers'] as Record<string, unknown>) || {};
      if (mcpServers['lazyloadingai']) {
        logWarning('LazyLoadingAI already configured in .mcp.json');
        return false;
      }
    } catch {
      // If parse fails, start fresh
      config = {};
    }
  }

  // Add lazyloadingai server
  if (!config['mcpServers']) {
    config['mcpServers'] = {};
  }
  (config['mcpServers'] as Record<string, unknown>)['lazyloadingai'] = serverConfig;

  await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
  logSuccess('Created .mcp.json (Claude Code)');
  return true;
}

/**
 * Generate Codex CLI config in ~/.codex/config.toml
 */
async function generateCodexConfig(projectPath: string): Promise<boolean> {
  const codexDir = path.join(os.homedir(), '.codex');
  const configPath = path.join(codexDir, 'config.toml');
  const cliPath = getCliPath();

  // Ensure ~/.codex directory exists
  if (!fs.existsSync(codexDir)) {
    await fs.promises.mkdir(codexDir, { recursive: true });
  }

  const serverConfig = {
    command: 'node',
    args: [cliPath, 'serve', '--root', projectPath],
  };

  let config: Record<string, unknown> = {};

  // Check if file exists and merge
  if (fs.existsSync(configPath)) {
    try {
      const existingContent = await fs.promises.readFile(configPath, 'utf-8');
      config = TOML.parse(existingContent);

      // Check if lazyloadingai is already configured - update the root path
      const mcpServers = (config['mcp_servers'] as Record<string, unknown>) || {};
      if (mcpServers['lazyloadingai']) {
        mcpServers['lazyloadingai'] = serverConfig;
        await fs.promises.writeFile(configPath, TOML.stringify(config as TOML.JsonMap));
        logSuccess('Updated ~/.codex/config.toml with new root path (Codex CLI)');
        return true;
      }
    } catch {
      // If parse fails, start fresh
      config = {};
    }
  }

  // Add lazyloadingai server
  if (!config['mcp_servers']) {
    config['mcp_servers'] = {};
  }
  (config['mcp_servers'] as Record<string, unknown>)['lazyloadingai'] = serverConfig;

  await fs.promises.writeFile(configPath, TOML.stringify(config as TOML.JsonMap));
  logSuccess('Updated ~/.codex/config.toml (Codex CLI)');
  return true;
}

/**
 * Generate Cursor .cursor/mcp.json config
 */
async function generateCursorConfig(projectPath: string): Promise<boolean> {
  const cursorDir = path.join(projectPath, '.cursor');
  const configPath = path.join(cursorDir, 'mcp.json');
  const cliPath = getCliPath();

  // Ensure .cursor directory exists
  if (!fs.existsSync(cursorDir)) {
    await fs.promises.mkdir(cursorDir, { recursive: true });
  }

  const serverConfig = {
    command: 'node',
    args: [cliPath, 'serve', '--root', '.'],
  };

  let config: Record<string, unknown> = {};

  // Check if file exists and merge
  if (fs.existsSync(configPath)) {
    try {
      const existingContent = await fs.promises.readFile(configPath, 'utf-8');
      config = JSON.parse(existingContent);

      // Check if lazyloadingai is already configured
      const mcpServers = (config['mcpServers'] as Record<string, unknown>) || {};
      if (mcpServers['lazyloadingai']) {
        logWarning('LazyLoadingAI already configured in .cursor/mcp.json');
        return false;
      }
    } catch {
      // If parse fails, start fresh
      config = {};
    }
  }

  // Add lazyloadingai server
  if (!config['mcpServers']) {
    config['mcpServers'] = {};
  }
  (config['mcpServers'] as Record<string, unknown>)['lazyloadingai'] = serverConfig;

  await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
  logSuccess('Created .cursor/mcp.json (Cursor)');
  return true;
}

/**
 * Generate or update CLAUDE.md
 */
async function generateClaudeMd(projectPath: string): Promise<boolean> {
  const filePath = path.join(projectPath, 'CLAUDE.md');

  if (fs.existsSync(filePath)) {
    const existingContent = await fs.promises.readFile(filePath, 'utf-8');

    if (hasClaudeMdSection(existingContent)) {
      logWarning('CLAUDE.md already has LazyLoadingAI section');
      return false;
    }

    // Append to existing file
    const newContent = existingContent.trimEnd() + '\n\n' + generateClaudeMdContent();
    await fs.promises.writeFile(filePath, newContent);
    logSuccess('Updated CLAUDE.md with usage instructions');
    return true;
  }

  // Create new file
  await fs.promises.writeFile(filePath, generateClaudeMdContent());
  logSuccess('Created CLAUDE.md with usage instructions');
  return true;
}

/**
 * Generate or update AGENTS.md
 */
async function generateAgentsMd(projectPath: string): Promise<boolean> {
  const filePath = path.join(projectPath, 'AGENTS.md');

  if (fs.existsSync(filePath)) {
    const existingContent = await fs.promises.readFile(filePath, 'utf-8');

    if (hasAgentsMdSection(existingContent)) {
      logWarning('AGENTS.md already has LazyLoadingAI section');
      return false;
    }

    // Append to existing file
    const newContent = existingContent.trimEnd() + '\n\n' + generateAgentsMdContent();
    await fs.promises.writeFile(filePath, newContent);
    logSuccess('Updated AGENTS.md with usage instructions');
    return true;
  }

  // Create new file
  await fs.promises.writeFile(filePath, generateAgentsMdContent());
  logSuccess('Created AGENTS.md with usage instructions');
  return true;
}

/**
 * Generate lazyload.config.json
 */
async function generateLazyloadConfig(projectPath: string, directories: string[]): Promise<boolean> {
  const configPath = path.join(projectPath, 'lazyload.config.json');

  if (fs.existsSync(configPath)) {
    logWarning('lazyload.config.json already exists');
    return false;
  }

  const config = {
    directories,
    include: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.js',
      '**/*.jsx',
      '**/*.py',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.git/**',
      '**/venv/**',
      '**/__pycache__/**',
      '**/coverage/**',
    ],
  };

  await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
  logSuccess('Created lazyload.config.json');
  return true;
}

/**
 * Update .gitignore to include .lazyload/
 */
async function updateGitignore(projectPath: string): Promise<boolean> {
  const gitignorePath = path.join(projectPath, '.gitignore');
  const entry = '.lazyload/';

  if (fs.existsSync(gitignorePath)) {
    const content = await fs.promises.readFile(gitignorePath, 'utf-8');

    if (content.includes(entry) || content.includes('.lazyload')) {
      logInfo('.lazyload/ already in .gitignore');
      return false;
    }

    // Append to existing file
    const newContent = content.trimEnd() + '\n\n# LazyLoadingAI index\n' + entry + '\n';
    await fs.promises.writeFile(gitignorePath, newContent);
    logSuccess('Added .lazyload/ to .gitignore');
    return true;
  }

  // Create new .gitignore
  const content = '# LazyLoadingAI index\n' + entry + '\n';
  await fs.promises.writeFile(gitignorePath, content);
  logSuccess('Created .gitignore with .lazyload/');
  return true;
}

/**
 * Run initial indexing
 */
async function runInitialIndex(projectPath: string): Promise<void> {
  const databasePath = path.join(projectPath, '.lazyload/index.db');

  // Ensure .lazyload directory exists
  const lazyloadDir = path.dirname(databasePath);
  if (!fs.existsSync(lazyloadDir)) {
    await fs.promises.mkdir(lazyloadDir, { recursive: true });
  }

  log('\nIndexing codebase...');

  const indexer = new Indexer({
    rootDirectory: projectPath,
    databasePath,
    include: [],
    exclude: [],
  });

  await indexer.initialize();

  const result = await indexer.indexDirectory();

  const stats = await indexer.getStats();
  logSuccess(`Indexed ${result.indexedFiles} files (${stats.totalSymbols} symbols)`);

  await indexer.close();
}

export const initCommand = new Command('init')
  .description('Initialize LazyLoadingAI for Claude Code, Codex, and/or Cursor')
  .option('--claude', 'Configure for Claude Code')
  .option('--codex', 'Configure for Codex CLI')
  .option('--cursor', 'Configure for Cursor IDE')
  .option('--all', 'Configure for all supported tools')
  .option('--skip-index', 'Skip initial indexing')
  .option('-d, --directories <dirs...>', 'Directories to index')
  .option('-y, --yes', 'Accept all defaults (non-interactive)')
  .action(async (options: InitOptions) => {
    const projectPath = process.cwd();

    logHeader('LazyLoadingAI Setup');

    try {
      // 1. Determine which tools to configure
      const tools = await selectTools(options);

      if (!tools.claude && !tools.codex && !tools.cursor) {
        logWarning('No tools selected. Nothing to configure.');
        return;
      }

      // 2. Get directories to index
      const directories = await promptDirectories(options);

      // 3. Ask about indexing
      let runIndex = !options.skipIndex;
      if (!options.skipIndex && !options.yes) {
        runIndex = await confirmPrompt('Run initial indexing now?', true);
      }

      log(''); // Empty line before output

      // 4. Generate configs
      if (tools.claude) await generateClaudeConfig(projectPath);
      if (tools.codex) await generateCodexConfig(projectPath);
      if (tools.cursor) await generateCursorConfig(projectPath);

      // 5. Generate documentation
      if (tools.claude || tools.cursor) await generateClaudeMd(projectPath);
      if (tools.codex) await generateAgentsMd(projectPath);

      // 6. Create lazyload.config.json
      await generateLazyloadConfig(projectPath, directories);

      // 7. Update .gitignore
      await updateGitignore(projectPath);

      // 8. Optionally run indexing
      if (runIndex) {
        await runInitialIndex(projectPath);
      }

      // Final message
      log(`\n${colors.green}${colors.bold}Setup complete!${colors.reset} LazyLoadingAI is ready to use.\n`);

      logInfo('Note: Using local installation paths. After npm publish, update configs to use:');
      log(`  ${colors.dim}npx lazyloadingai serve${colors.reset}\n`);

    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
