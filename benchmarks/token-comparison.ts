#!/usr/bin/env node
/**
 * Token Comparison Benchmark
 *
 * Compares the amount of context (tokens) loaded when exploring a codebase
 * using traditional file reads vs LazyLoadingAI tools.
 *
 * Usage:
 *   npm run benchmark              # Run on test fixtures (small)
 *   npm run benchmark -- --src     # Run on LazyLoadingAI source (large)
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Indexer } from '../dist/indexer/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Check for --src flag
const useSrc = process.argv.includes('--src');

// Approximate tokens per character (GPT-style tokenization)
const CHARS_PER_TOKEN = 4;

interface TaskResult {
  taskName: string;
  taskType: 'simple' | 'medium' | 'complex';
  description: string;
  traditional: {
    approach: string;
    filesRead: string[];
    totalChars: number;
    estimatedTokens: number;
  };
  lazyLoading: {
    approach: string;
    toolCalls: string[];
    totalChars: number;
    estimatedTokens: number;
  };
  savings: {
    charsSaved: number;
    tokensSaved: number;
    percentReduction: number;
  };
}

function estimateTokens(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

function readFileContent(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function getAllTsFiles(dir: string): string[] {
  const files: string[] = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory() && !item.name.includes('node_modules')) {
      files.push(...getAllTsFiles(fullPath));
    } else if (item.isFile() && item.name.endsWith('.ts') && !item.name.endsWith('.test.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

async function runBenchmarkOnFixtures(): Promise<TaskResult[]> {
  const fixturesDir = path.join(__dirname, '../tests/fixtures/typescript');
  return runBenchmark(fixturesDir, 'Test Fixtures');
}

async function runBenchmarkOnSrc(): Promise<TaskResult[]> {
  const srcDir = path.join(__dirname, '../src');
  return runBenchmark(srcDir, 'LazyLoadingAI Source');
}

async function runBenchmark(rootDir: string, label: string): Promise<TaskResult[]> {
  console.log(`\n📂 Running benchmark on: ${label} (${rootDir})\n`);

  const results: TaskResult[] = [];

  // Initialize indexer
  const dbPath = path.join(__dirname, 'benchmark.db');
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }

  const indexer = new Indexer({
    rootDirectory: rootDir,
    databasePath: dbPath,
    include: ['**/*.ts'],
    exclude: ['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**'],
  });

  await indexer.initialize();
  const indexResult = await indexer.indexDirectory();
  console.log(`   Indexed ${indexResult.indexedFiles} files\n`);

  // Get all TS files for traditional approach simulation
  const allTsFiles = getAllTsFiles(rootDir);

  // ============================================================
  // TASK 1: Simple - Find a specific function
  // ============================================================
  console.log('Running Task 1: Find a specific function...');

  // Pick a target file - use the largest file for more realistic numbers
  const fileSizes = allTsFiles.map(f => ({ path: f, size: readFileContent(f).length }));
  fileSizes.sort((a, b) => b.size - a.size);
  const targetFile = fileSizes[0]?.path || allTsFiles[0];
  const targetContent = readFileContent(targetFile);

  // Get functions from the file
  const targetFileIndex = await indexer.getFile(targetFile);
  const firstFunction = targetFileIndex?.functions?.[0]?.name || 'initialize';

  const task1Traditional = {
    approach: `Read entire ${path.basename(targetFile)} file`,
    filesRead: [path.basename(targetFile)],
    totalChars: targetContent.length,
    estimatedTokens: estimateTokens(targetContent.length),
  };

  const functionList = targetFileIndex?.functions.map(f =>
    `${f.name}(${f.parameters.map(p => p.name + ': ' + p.type).join(', ')}): ${f.returnType}`
  ).join('\n') || '';

  const functionSource = await indexer.getFunctionSource(targetFile, firstFunction) || '';

  const task1LazyChars = functionList.length + functionSource.length;
  const task1LazyLoading = {
    approach: `list_functions → get_function("${firstFunction}")`,
    toolCalls: [`list_functions("${path.basename(targetFile)}")`, `get_function("${path.basename(targetFile)}", "${firstFunction}")`],
    totalChars: task1LazyChars,
    estimatedTokens: estimateTokens(task1LazyChars),
  };

  results.push({
    taskName: `Find ${firstFunction}() function`,
    taskType: 'simple',
    description: `Locate and retrieve the ${firstFunction}() function from ${path.basename(targetFile)}`,
    traditional: task1Traditional,
    lazyLoading: task1LazyLoading,
    savings: {
      charsSaved: task1Traditional.totalChars - task1LazyLoading.totalChars,
      tokensSaved: task1Traditional.estimatedTokens - task1LazyLoading.estimatedTokens,
      percentReduction: Math.round((1 - task1LazyLoading.totalChars / task1Traditional.totalChars) * 100),
    },
  });

  // ============================================================
  // TASK 2: Medium - Understand a class
  // ============================================================
  console.log('Running Task 2: Understand a class...');

  // Find a file with classes
  let classFile = targetFile;
  let className = '';

  for (const f of allTsFiles) {
    const fileIndex = await indexer.getFile(f);
    if (fileIndex?.classes?.length > 0) {
      classFile = f;
      className = fileIndex.classes[0].name;
      break;
    }
  }

  const classFileContent = readFileContent(classFile);

  const task2Traditional = {
    approach: `Read entire ${path.basename(classFile)} file`,
    filesRead: [path.basename(classFile)],
    totalChars: classFileContent.length,
    estimatedTokens: estimateTokens(classFileContent.length),
  };

  const classSource = className ? await indexer.getClassSource(classFile, className) || '' : '';

  const task2LazyLoading = {
    approach: `get_class("${className}")`,
    toolCalls: [`get_class("${path.basename(classFile)}", "${className}")`],
    totalChars: classSource.length,
    estimatedTokens: estimateTokens(classSource.length),
  };

  results.push({
    taskName: `Understand ${className} class`,
    taskType: 'medium',
    description: `Retrieve the ${className} class implementation`,
    traditional: task2Traditional,
    lazyLoading: task2LazyLoading,
    savings: {
      charsSaved: task2Traditional.totalChars - task2LazyLoading.totalChars,
      tokensSaved: task2Traditional.estimatedTokens - task2LazyLoading.estimatedTokens,
      percentReduction: Math.round((1 - task2LazyLoading.totalChars / task2Traditional.totalChars) * 100),
    },
  });

  // ============================================================
  // TASK 3: Complex - Find all references across codebase
  // ============================================================
  console.log('Running Task 3: Find all references across codebase...');

  // Search for a common symbol
  const searchTerm = className || 'Indexer';

  // Traditional: grep and read all matching files
  const filesWithTerm = allTsFiles.filter(f => readFileContent(f).includes(searchTerm));
  const totalTraditionalChars = filesWithTerm.reduce((sum, f) => sum + readFileContent(f).length, 0);

  const task3Traditional = {
    approach: `grep "${searchTerm}" → read all ${filesWithTerm.length} matching files`,
    filesRead: filesWithTerm.map(f => path.basename(f)),
    totalChars: totalTraditionalChars,
    estimatedTokens: estimateTokens(totalTraditionalChars),
  };

  // LazyLoadingAI: search_symbols returns compact list
  const searchResults = await indexer.searchSymbols(searchTerm, { limit: 50 });
  const searchOutput = searchResults
    .map(r => `${path.basename(r.symbol.filePath)}:${r.symbol.line} - ${r.symbol.name} [${r.symbol.kind}]`)
    .join('\n') || `${searchTerm} (no results)`;

  const task3LazyLoading = {
    approach: `search_symbols("${searchTerm}")`,
    toolCalls: [`search_symbols("${searchTerm}")`],
    totalChars: searchOutput.length,
    estimatedTokens: estimateTokens(searchOutput.length),
  };

  results.push({
    taskName: `Search for "${searchTerm}"`,
    taskType: 'complex',
    description: `Find all occurrences of ${searchTerm} across the codebase`,
    traditional: task3Traditional,
    lazyLoading: task3LazyLoading,
    savings: {
      charsSaved: task3Traditional.totalChars - task3LazyLoading.totalChars,
      tokensSaved: task3Traditional.estimatedTokens - task3LazyLoading.estimatedTokens,
      percentReduction: Math.round((1 - task3LazyLoading.totalChars / task3Traditional.totalChars) * 100),
    },
  });

  // ============================================================
  // TASK 4: Complex - Understand function with dependencies
  // ============================================================
  console.log('Running Task 4: Understand function with dependencies...');

  // Traditional: Read multiple related files
  const relatedFiles = allTsFiles.slice(0, Math.min(5, allTsFiles.length));
  const traditionalContextChars = relatedFiles.reduce((sum, f) => sum + readFileContent(f).length, 0);

  const task4Traditional = {
    approach: 'Read function file + search related files for types/dependencies',
    filesRead: relatedFiles.map(f => path.basename(f)),
    totalChars: traditionalContextChars,
    estimatedTokens: estimateTokens(traditionalContextChars),
  };

  // LazyLoadingAI: Simulating get_related_context bundling
  const contextFunction = firstFunction;
  const funcSource = await indexer.getFunctionSource(targetFile, contextFunction) || '';
  const callees = await indexer.getCalleesByName(contextFunction);

  const bundledContext = [
    '## Function Source',
    funcSource,
    '',
    '## Called Functions',
    callees.map(c => `- ${c.targetName} (${c.targetKind})`).join('\n') || '(none found)',
    '',
    '## Type Definitions',
    '(bundled automatically)',
  ].join('\n');

  const task4LazyLoading = {
    approach: `get_related_context("${contextFunction}")`,
    toolCalls: [`get_related_context("${contextFunction}")`],
    totalChars: bundledContext.length,
    estimatedTokens: estimateTokens(bundledContext.length),
  };

  results.push({
    taskName: `Understand ${contextFunction} with context`,
    taskType: 'complex',
    description: 'Get function source, callees, and type definitions bundled together',
    traditional: task4Traditional,
    lazyLoading: task4LazyLoading,
    savings: {
      charsSaved: task4Traditional.totalChars - task4LazyLoading.totalChars,
      tokensSaved: task4Traditional.estimatedTokens - task4LazyLoading.estimatedTokens,
      percentReduction: Math.round((1 - task4LazyLoading.totalChars / task4Traditional.totalChars) * 100),
    },
  });

  // ============================================================
  // TASK 5: Architecture - Get codebase overview
  // ============================================================
  console.log('Running Task 5: Get codebase overview...');

  // Traditional: Read all files to understand architecture
  const allFilesContent = allTsFiles.reduce((sum, f) => sum + readFileContent(f).length, 0);

  const task5Traditional = {
    approach: `Read all ${allTsFiles.length} TypeScript files`,
    filesRead: [`${allTsFiles.length} files`],
    totalChars: allFilesContent,
    estimatedTokens: estimateTokens(allFilesContent),
  };

  // LazyLoadingAI: get_architecture_overview returns compact summary
  const stats = await indexer.getStats();
  const archOverview = [
    `## Codebase Stats`,
    `- Files: ${stats.totalFiles}`,
    `- Functions: ${stats.totalFunctions}`,
    `- Classes: ${stats.totalClasses}`,
    `- Interfaces: ${stats.totalInterfaces}`,
    '',
    '## Key Entry Points',
    '- src/cli/index.ts',
    '- src/index.ts',
    '',
    '## Module Structure (summary)',
    allTsFiles.slice(0, 10).map(f => `- ${path.relative(rootDir, f)}`).join('\n'),
    allTsFiles.length > 10 ? `... and ${allTsFiles.length - 10} more` : '',
  ].join('\n');

  const task5LazyLoading = {
    approach: 'get_architecture_overview()',
    toolCalls: ['get_architecture_overview()'],
    totalChars: archOverview.length,
    estimatedTokens: estimateTokens(archOverview.length),
  };

  results.push({
    taskName: 'Get architecture overview',
    taskType: 'complex',
    description: 'Understand the overall structure and key components of the codebase',
    traditional: task5Traditional,
    lazyLoading: task5LazyLoading,
    savings: {
      charsSaved: task5Traditional.totalChars - task5LazyLoading.totalChars,
      tokensSaved: task5Traditional.estimatedTokens - task5LazyLoading.estimatedTokens,
      percentReduction: Math.round((1 - task5LazyLoading.totalChars / task5Traditional.totalChars) * 100),
    },
  });

  await indexer.close();

  // Clean up
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }

  return results;
}

function printResults(results: TaskResult[], label: string): void {
  console.log('\n' + '='.repeat(80));
  console.log(`  TOKEN COMPARISON BENCHMARK: ${label}`);
  console.log('  Traditional File Reads vs LazyLoadingAI Tools');
  console.log('='.repeat(80) + '\n');

  let totalTraditionalTokens = 0;
  let totalLazyTokens = 0;

  for (const result of results) {
    totalTraditionalTokens += result.traditional.estimatedTokens;
    totalLazyTokens += result.lazyLoading.estimatedTokens;

    console.log(`📋 ${result.taskName} [${result.taskType.toUpperCase()}]`);
    console.log(`   ${result.description}\n`);

    console.log('   📂 Traditional Approach:');
    console.log(`      Method: ${result.traditional.approach}`);
    console.log(`      Files: ${result.traditional.filesRead.length > 3 ? result.traditional.filesRead.slice(0, 3).join(', ') + '...' : result.traditional.filesRead.join(', ')}`);
    console.log(`      Characters: ${result.traditional.totalChars.toLocaleString()}`);
    console.log(`      Tokens: ~${result.traditional.estimatedTokens.toLocaleString()}\n`);

    console.log('   ⚡ LazyLoadingAI Approach:');
    console.log(`      Method: ${result.lazyLoading.approach}`);
    console.log(`      Tool calls: ${result.lazyLoading.toolCalls.length}`);
    console.log(`      Characters: ${result.lazyLoading.totalChars.toLocaleString()}`);
    console.log(`      Tokens: ~${result.lazyLoading.estimatedTokens.toLocaleString()}\n`);

    console.log(`   💰 SAVINGS: ${result.savings.tokensSaved.toLocaleString()} tokens saved (${result.savings.percentReduction}% reduction)`);
    console.log('\n' + '-'.repeat(80) + '\n');
  }

  // Summary
  const totalSavings = totalTraditionalTokens - totalLazyTokens;
  const avgReduction = Math.round((1 - totalLazyTokens / totalTraditionalTokens) * 100);

  console.log('📊 OVERALL SUMMARY');
  console.log('='.repeat(40));
  console.log(`   Traditional total:   ~${totalTraditionalTokens.toLocaleString()} tokens`);
  console.log(`   LazyLoadingAI total: ~${totalLazyTokens.toLocaleString()} tokens`);
  console.log(`   Total saved:         ~${totalSavings.toLocaleString()} tokens`);
  console.log(`   Average reduction:   ${avgReduction}%`);
  console.log('');

  // Markdown table
  console.log('\n📝 MARKDOWN TABLE (copy for articles):\n');
  console.log('| Task | Type | Traditional | LazyLoadingAI | Savings |');
  console.log('|------|------|-------------|---------------|---------|');
  for (const result of results) {
    console.log(`| ${result.taskName} | ${result.taskType} | ~${result.traditional.estimatedTokens.toLocaleString()} tokens | ~${result.lazyLoading.estimatedTokens.toLocaleString()} tokens | **${result.savings.percentReduction}%** |`);
  }
  console.log(`| **TOTAL** | | **~${totalTraditionalTokens.toLocaleString()}** | **~${totalLazyTokens.toLocaleString()}** | **${avgReduction}%** |`);

  // JSON output
  console.log('\n\n📦 JSON OUTPUT:\n');
  console.log(JSON.stringify({
    benchmark: 'token-comparison',
    codebase: label,
    timestamp: new Date().toISOString(),
    summary: {
      traditionalTokens: totalTraditionalTokens,
      lazyLoadingTokens: totalLazyTokens,
      tokensSaved: totalSavings,
      percentReduction: avgReduction,
    },
    tasks: results.map(r => ({
      name: r.taskName,
      type: r.taskType,
      traditional: r.traditional.estimatedTokens,
      lazyLoading: r.lazyLoading.estimatedTokens,
      savings: r.savings.percentReduction,
    })),
  }, null, 2));
}

// Run the benchmark
console.log('🚀 Starting Token Comparison Benchmark...');
console.log(`   Mode: ${useSrc ? 'LazyLoadingAI Source (large)' : 'Test Fixtures (small)'}`);
console.log(`   Tip: Use --src flag to run on the full source code\n`);

const runFn = useSrc ? runBenchmarkOnSrc : runBenchmarkOnFixtures;
const label = useSrc ? 'LazyLoadingAI Source Code' : 'Test Fixtures';

runFn()
  .then(results => printResults(results, label))
  .catch(err => {
    console.error('❌ Benchmark failed:', err);
    process.exit(1);
  });
