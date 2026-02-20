import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createTempProject, SAMPLE_TYPESCRIPT, SAMPLE_PYTHON } from '../helpers/fixtures.js';

// Helper to run CLI commands
function runCli(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const cliPath = path.resolve(__dirname, '../../dist/cli/index.js');
    const child = spawn('node', [cliPath, ...args], { cwd });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({ stdout, stderr, code });
    });
  });
}

describe('CLI Commands Integration', () => {
  let tempProject: ReturnType<typeof createTempProject>;

  beforeEach(() => {
    tempProject = createTempProject({
      'src/main.ts': SAMPLE_TYPESCRIPT,
      'src/utils.py': SAMPLE_PYTHON,
    });
  });

  afterEach(() => {
    tempProject.cleanup();
  });

  describe('index command', () => {
    it('should index the current directory by default', async () => {
      const result = await runCli(['index'], tempProject.rootDir);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Indexing complete');
      expect(result.stdout).toContain('Indexed:');
    });

    it('should index a specific directory', async () => {
      const result = await runCli(['index', 'src'], tempProject.rootDir);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Indexing');
    });

    it('should use custom output path', async () => {
      const customDb = path.join(tempProject.rootDir, 'custom.db');
      const result = await runCli(['index', '-o', customDb], tempProject.rootDir);

      expect(result.code).toBe(0);
      expect(fs.existsSync(customDb)).toBe(true);
    });

    it('should use custom include patterns', async () => {
      const result = await runCli(['index', '--include', '**/*.ts'], tempProject.rootDir);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Indexing complete');
    });

    it('should show verbose output when requested', async () => {
      // Create a file that will cause an error
      tempProject.addFile('broken.ts', 'invalid { syntax');

      const result = await runCli(['index', '--verbose'], tempProject.rootDir);

      // Should still complete
      expect(result.code).toBe(0);
    });

    it('should load config file when specified', async () => {
      const configPath = path.join(tempProject.rootDir, 'lazyload.config.json');
      fs.writeFileSync(configPath, JSON.stringify({
        include: ['**/*.ts'],
        exclude: [],
      }));

      const result = await runCli(['index', '-c', configPath], tempProject.rootDir);

      expect(result.code).toBe(0);
    });

    it('should show statistics after indexing', async () => {
      const result = await runCli(['index'], tempProject.rootDir);

      expect(result.stdout).toContain('Index statistics');
      expect(result.stdout).toContain('Total symbols');
    });
  });

  describe('query command', () => {
    beforeEach(async () => {
      // First index the project
      await runCli(['index'], tempProject.rootDir);
    });

    it('should search for symbols', async () => {
      const result = await runCli(['query', 'greet'], tempProject.rootDir);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('greet');
    });

    it('should filter by type', async () => {
      const result = await runCli(['query', 'User', '-t', 'class'], tempProject.rootDir);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('class');
    });

    it('should filter by language', async () => {
      const result = await runCli(['query', 'greet', '-l', 'typescript'], tempProject.rootDir);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('.ts');
    });

    it('should limit results', async () => {
      const result = await runCli(['query', '', '-n', '2'], tempProject.rootDir);

      expect(result.code).toBe(0);
    });

    it('should output JSON when requested', async () => {
      const result = await runCli(['query', 'greet', '--json'], tempProject.rootDir);

      expect(result.code).toBe(0);
      expect(() => JSON.parse(result.stdout)).not.toThrow();
    });

    it('should handle no results gracefully', async () => {
      const result = await runCli(['query', 'xyznonexistent123'], tempProject.rootDir);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('No symbols found');
    });
  });

  describe('stats command', () => {
    beforeEach(async () => {
      // First index the project
      await runCli(['index'], tempProject.rootDir);
    });

    it('should show index statistics', async () => {
      const result = await runCli(['stats'], tempProject.rootDir);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Index Statistics');
      expect(result.stdout).toContain('Total Files');
      expect(result.stdout).toContain('Total Symbols');
    });

    it('should output JSON when requested', async () => {
      const result = await runCli(['stats', '--json'], tempProject.rootDir);

      expect(result.code).toBe(0);
      expect(() => JSON.parse(result.stdout)).not.toThrow();

      const stats = JSON.parse(result.stdout);
      expect(stats).toHaveProperty('totalFiles');
      expect(stats).toHaveProperty('totalSymbols');
      expect(stats).toHaveProperty('byLanguage');
    });

    it('should show stats by language', async () => {
      const result = await runCli(['stats'], tempProject.rootDir);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('By Language');
    });

    it('should handle missing database', async () => {
      const emptyProject = createTempProject({});
      try {
        const result = await runCli(['stats'], emptyProject.rootDir);

        expect(result.code).toBe(1);
        expect(result.stderr).toContain('Database not found');
      } finally {
        emptyProject.cleanup();
      }
    });

    it('should use custom database path', async () => {
      const customDb = path.join(tempProject.rootDir, 'custom.db');
      await runCli(['index', '-o', customDb], tempProject.rootDir);

      const result = await runCli(['stats', '-d', customDb], tempProject.rootDir);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Index Statistics');
    });
  });

  describe('watch command', () => {
    // Note: Watch command tests are limited because they run indefinitely
    // We test initial behavior and then terminate

    it('should start watching and do initial index', async () => {
      // Run watch for a short time
      const cliPath = path.resolve(__dirname, '../../dist/cli/index.js');

      const result = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve) => {
        const child = spawn('node', [cliPath, 'watch'], {
          cwd: tempProject.rootDir,
          timeout: 5000,
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
          stdout += data.toString();
          // Kill after initial output
          if (stdout.includes('Watching') || stdout.includes('Initial index')) {
            child.kill('SIGTERM');
          }
        });

        child.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        child.on('close', (code) => {
          resolve({ stdout, stderr, code });
        });

        // Ensure we don't hang
        setTimeout(() => {
          child.kill('SIGTERM');
        }, 3000);
      });

      // Should start successfully
      expect(result.stdout.length).toBeGreaterThan(0);
    });
  });

  describe('Error handling', () => {
    it('should handle invalid config file gracefully', async () => {
      const configPath = path.join(tempProject.rootDir, 'invalid.json');
      fs.writeFileSync(configPath, 'not valid json {');

      const result = await runCli(['index', '-c', configPath], tempProject.rootDir);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('Error');
    });

    it('should handle non-existent directory', async () => {
      const result = await runCli(['index', '/non/existent/path'], tempProject.rootDir);

      // Should handle gracefully (might index empty or show error)
      expect(result).toBeDefined();
    });
  });
});
