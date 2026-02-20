import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { Indexer } from '../../src/indexer/index.js';
import { createTempProject, SAMPLE_TYPESCRIPT, SAMPLE_PYTHON } from '../helpers/fixtures.js';

describe('Indexer-Storage Integration', () => {
  let tempProject: ReturnType<typeof createTempProject>;
  let indexer: Indexer;
  let dbPath: string;

  beforeEach(() => {
    tempProject = createTempProject({
      'src/users/user-service.ts': `
export interface User {
  id: string;
  name: string;
  email: string;
}

export class UserService {
  private users: Map<string, User> = new Map();

  async findById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async createUser(name: string, email: string): Promise<User> {
    const user: User = { id: Date.now().toString(), name, email };
    this.users.set(user.id, user);
    return user;
  }

  async deleteUser(id: string): Promise<boolean> {
    return this.users.delete(id);
  }
}

export function validateEmail(email: string): boolean {
  return email.includes('@');
}
`,
      'src/utils/helpers.ts': `
export function formatDate(date: Date): string {
  return date.toISOString();
}

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export const DEFAULT_TIMEOUT = 5000;
`,
      'src/core/calculator.py': `
"""Calculator module with basic operations."""

def add(a: float, b: float) -> float:
    """Add two numbers."""
    return a + b

def subtract(a: float, b: float) -> float:
    """Subtract b from a."""
    return a - b

def multiply(a: float, b: float) -> float:
    """Multiply two numbers."""
    return a * b

class Calculator:
    """A simple calculator class."""

    def __init__(self):
        self.history = []

    def calculate(self, operation: str, a: float, b: float) -> float:
        """Perform a calculation."""
        if operation == 'add':
            result = add(a, b)
        elif operation == 'subtract':
            result = subtract(a, b)
        elif operation == 'multiply':
            result = multiply(a, b)
        else:
            raise ValueError(f"Unknown operation: {operation}")

        self.history.append((operation, a, b, result))
        return result
`,
    });
    dbPath = path.join(tempProject.rootDir, '.lazyload', 'test.db');
  });

  afterEach(async () => {
    if (indexer) {
      await indexer.close();
    }
    tempProject.cleanup();
  });

  describe('Full Indexing Pipeline', () => {
    it('should index all files and store them correctly', async () => {
      indexer = new Indexer({
        rootDirectory: tempProject.rootDir,
        databasePath: dbPath,
        include: ['**/*.ts', '**/*.py'],
        exclude: [],
      });
      await indexer.initialize();

      const result = await indexer.indexDirectory();

      expect(result.totalFiles).toBe(3);
      expect(result.indexedFiles).toBe(3);
      expect(result.errors).toHaveLength(0);

      // Verify stats
      const stats = await indexer.getStats();
      expect(stats.totalFiles).toBe(3);
      expect(stats.byLanguage.typescript.files).toBe(2);
      expect(stats.byLanguage.python.files).toBe(1);
    });

    it('should extract all symbol types correctly', async () => {
      indexer = new Indexer({
        rootDirectory: tempProject.rootDir,
        databasePath: dbPath,
        include: ['**/*.ts', '**/*.py'],
        exclude: [],
      });
      await indexer.initialize();
      await indexer.indexDirectory();

      // TypeScript file
      const userServiceFile = await indexer.getFile(
        path.join(tempProject.rootDir, 'src/users/user-service.ts')
      );
      expect(userServiceFile).not.toBeNull();
      expect(userServiceFile?.functions.length).toBeGreaterThan(0);
      expect(userServiceFile?.classes.length).toBe(1);
      expect(userServiceFile?.interfaces.length).toBe(1);

      // Python file
      const calculatorFile = await indexer.getFile(
        path.join(tempProject.rootDir, 'src/core/calculator.py')
      );
      expect(calculatorFile).not.toBeNull();
      expect(calculatorFile?.functions.length).toBeGreaterThanOrEqual(3);
      expect(calculatorFile?.classes.length).toBe(1);
    });
  });

  describe('Incremental Updates', () => {
    beforeEach(async () => {
      indexer = new Indexer({
        rootDirectory: tempProject.rootDir,
        databasePath: dbPath,
        include: ['**/*.ts', '**/*.py'],
        exclude: [],
      });
      await indexer.initialize();
      await indexer.indexDirectory();
    });

    it('should skip unchanged files on re-index', async () => {
      const result = await indexer.indexDirectory();

      expect(result.indexedFiles).toBe(0);
      expect(result.skippedFiles).toBe(3);
    });

    it('should re-index modified files', async () => {
      const filePath = path.join(tempProject.rootDir, 'src/utils/helpers.ts');
      const newContent = `
export function formatDate(date: Date): string {
  return date.toISOString();
}

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function newFunction(): void {
  console.log('Added function');
}

export const DEFAULT_TIMEOUT = 5000;
`;
      tempProject.addFile('src/utils/helpers.ts', newContent);

      const result = await indexer.indexDirectory();

      expect(result.indexedFiles).toBe(1);
      expect(result.skippedFiles).toBe(2);

      // Verify new function is indexed
      const file = await indexer.getFile(filePath);
      expect(file?.functions.some(f => f.name === 'newFunction')).toBe(true);
    });
  });

  describe('Search Across Indexed Files', () => {
    beforeEach(async () => {
      indexer = new Indexer({
        rootDirectory: tempProject.rootDir,
        databasePath: dbPath,
        include: ['**/*.ts', '**/*.py'],
        exclude: [],
      });
      await indexer.initialize();
      await indexer.indexDirectory();
    });

    it('should find symbols by exact name', async () => {
      const results = await indexer.searchSymbols('validateEmail');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.symbol.name).toBe('validateEmail');
    });

    it('should find symbols by prefix', async () => {
      const results = await indexer.searchSymbols('User');

      expect(results.length).toBeGreaterThan(0);
      // Should find UserService class and User interface
      expect(results.some(r => r.symbol.name === 'UserService')).toBe(true);
    });

    it('should search across multiple languages', async () => {
      const results = await indexer.searchSymbols('add');

      expect(results.length).toBeGreaterThan(0);
      // Should find Python add function
      expect(results.some(r => r.symbol.filePath.endsWith('.py'))).toBe(true);
    });

    it('should filter search by type', async () => {
      const classResults = await indexer.searchSymbols('', { type: 'class' });
      const funcResults = await indexer.searchSymbols('', { type: 'function' });

      // All results should be classes
      expect(classResults.every(r => r.symbol.kind === 'class')).toBe(true);

      // All results should be functions/methods
      expect(funcResults.every(r =>
        ['function', 'method', 'constructor'].includes(r.symbol.kind)
      )).toBe(true);
    });

    it('should filter search by language', async () => {
      const tsResults = await indexer.searchSymbols('', { language: 'typescript' });
      const pyResults = await indexer.searchSymbols('', { language: 'python' });

      expect(tsResults.every(r => r.symbol.filePath.endsWith('.ts'))).toBe(true);
      expect(pyResults.every(r => r.symbol.filePath.endsWith('.py'))).toBe(true);
    });
  });

  describe('Stats Accuracy', () => {
    beforeEach(async () => {
      indexer = new Indexer({
        rootDirectory: tempProject.rootDir,
        databasePath: dbPath,
        include: ['**/*.ts', '**/*.py'],
        exclude: [],
      });
      await indexer.initialize();
      await indexer.indexDirectory();
    });

    it('should report accurate file counts', async () => {
      const stats = await indexer.getStats();

      expect(stats.totalFiles).toBe(3);
      expect(stats.byLanguage.typescript.files).toBe(2);
      expect(stats.byLanguage.python.files).toBe(1);
    });

    it('should report accurate symbol counts', async () => {
      const stats = await indexer.getStats();

      // TypeScript: UserService class, User interface, validateEmail func, formatDate, capitalize
      // Plus class methods: findById, createUser, deleteUser
      expect(stats.byLanguage.typescript.classes).toBeGreaterThanOrEqual(1);
      expect(stats.byLanguage.typescript.functions).toBeGreaterThanOrEqual(3);
      expect(stats.byLanguage.typescript.interfaces).toBeGreaterThanOrEqual(1);

      // Python: Calculator class, add, subtract, multiply functions
      expect(stats.byLanguage.python.classes).toBeGreaterThanOrEqual(1);
      expect(stats.byLanguage.python.functions).toBeGreaterThanOrEqual(3);
    });

    it('should update stats after file deletion', async () => {
      const filePath = path.join(tempProject.rootDir, 'src/core/calculator.py');
      await indexer.removeFile(filePath);

      const stats = await indexer.getStats();

      expect(stats.totalFiles).toBe(2);
      expect(stats.byLanguage.python.files).toBe(0);
    });
  });

  describe('Source Code Retrieval', () => {
    beforeEach(async () => {
      indexer = new Indexer({
        rootDirectory: tempProject.rootDir,
        databasePath: dbPath,
        include: ['**/*.ts', '**/*.py'],
        exclude: [],
      });
      await indexer.initialize();
      await indexer.indexDirectory();
    });

    it('should retrieve function source code', async () => {
      const filePath = path.join(tempProject.rootDir, 'src/utils/helpers.ts');
      const source = await indexer.getFunctionSource(filePath, 'formatDate');

      expect(source).not.toBeNull();
      expect(source).toContain('formatDate');
      expect(source).toContain('toISOString');
    });

    it('should retrieve class source code', async () => {
      const filePath = path.join(tempProject.rootDir, 'src/users/user-service.ts');
      const source = await indexer.getClassSource(filePath, 'UserService');

      expect(source).not.toBeNull();
      expect(source).toContain('class UserService');
      expect(source).toContain('findById');
      expect(source).toContain('createUser');
    });

    it('should retrieve source with context', async () => {
      const filePath = path.join(tempProject.rootDir, 'src/utils/helpers.ts');
      const func = await indexer.getFunction(filePath, 'formatDate');

      if (func) {
        const result = await indexer.getSourceWithContext(
          filePath,
          func.location.startLine,
          func.location.endLine,
          2
        );

        expect(result).not.toBeNull();
        expect(result?.actualStartLine).toBeLessThan(func.location.startLine);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty directories', async () => {
      const emptyProject = createTempProject({});
      const emptyDbPath = path.join(emptyProject.rootDir, '.lazyload', 'test.db');

      const emptyIndexer = new Indexer({
        rootDirectory: emptyProject.rootDir,
        databasePath: emptyDbPath,
        include: ['**/*.ts'],
        exclude: [],
      });

      try {
        await emptyIndexer.initialize();
        const result = await emptyIndexer.indexDirectory();

        expect(result.totalFiles).toBe(0);
        expect(result.indexedFiles).toBe(0);
      } finally {
        await emptyIndexer.close();
        emptyProject.cleanup();
      }
    });

    it('should handle files with parse errors', async () => {
      tempProject.addFile('broken.ts', 'this is { not valid typescript');

      indexer = new Indexer({
        rootDirectory: tempProject.rootDir,
        databasePath: dbPath,
        include: ['**/*.ts', '**/*.py'],
        exclude: [],
      });
      await indexer.initialize();

      const result = await indexer.indexDirectory();

      // Should still index other files
      expect(result.indexedFiles).toBeGreaterThan(0);
    });

    it('should handle special characters in file paths', async () => {
      tempProject.addFile('src/special-chars_file.ts', 'export const x = 1;');

      indexer = new Indexer({
        rootDirectory: tempProject.rootDir,
        databasePath: dbPath,
        include: ['**/*.ts'],
        exclude: [],
      });
      await indexer.initialize();

      const result = await indexer.indexDirectory();

      expect(result.totalFiles).toBeGreaterThan(0);
    });
  });
});
