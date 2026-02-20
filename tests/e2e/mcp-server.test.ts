import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { Indexer } from '../../src/indexer/index.js';
import { listFilesTool } from '../../src/server/tools/list-files.js';
import { listFunctionsTool } from '../../src/server/tools/list-functions.js';
import { getFunctionTool } from '../../src/server/tools/get-function.js';
import { getClassTool } from '../../src/server/tools/get-class.js';
import { searchSymbolsTool } from '../../src/server/tools/search-symbols.js';
import { createTempProject, SAMPLE_TYPESCRIPT, SAMPLE_PYTHON } from '../helpers/fixtures.js';

describe('E2E: MCP Server Tools', () => {
  let tempProject: ReturnType<typeof createTempProject>;
  let indexer: Indexer;
  let dbPath: string;

  beforeEach(async () => {
    tempProject = createTempProject({
      'src/services/user-service.ts': `
/**
 * User service module
 */
export interface User {
  id: string;
  name: string;
  email: string;
}

/**
 * Service for managing users
 */
export class UserService {
  private users = new Map<string, User>();

  /**
   * Find a user by ID
   * @param id - User identifier
   */
  async findById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  /**
   * Create a new user
   * @param name - User name
   * @param email - User email
   */
  async createUser(name: string, email: string): Promise<User> {
    const user: User = { id: Date.now().toString(), name, email };
    this.users.set(user.id, user);
    return user;
  }
}

/**
 * Validate email format
 */
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
`,
      'lib/calculator.py': `
"""Calculator module."""

def add(a: float, b: float) -> float:
    """Add two numbers."""
    return a + b

def multiply(a: float, b: float) -> float:
    """Multiply two numbers."""
    return a * b

class Calculator:
    """A simple calculator."""

    def calculate(self, op: str, a: float, b: float) -> float:
        """Perform calculation."""
        if op == 'add':
            return add(a, b)
        elif op == 'multiply':
            return multiply(a, b)
        raise ValueError(f"Unknown operation: {op}")
`,
    });

    dbPath = path.join(tempProject.rootDir, '.lazyload', 'test.db');

    indexer = new Indexer({
      rootDirectory: tempProject.rootDir,
      databasePath: dbPath,
      include: ['**/*.ts', '**/*.py'],
      exclude: [],
    });

    await indexer.initialize();
    await indexer.indexDirectory();
  });

  afterEach(async () => {
    await indexer.close();
    tempProject.cleanup();
  });

  describe('list_files tool', () => {
    it('should list all indexed files', async () => {
      const result = await listFilesTool(indexer, {});

      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe('text');

      const text = result.content[0]?.text ?? '';
      expect(text).toContain('user-service.ts');
      expect(text).toContain('helpers.ts');
      expect(text).toContain('calculator.py');
    });

    it('should filter by language', async () => {
      const result = await listFilesTool(indexer, { language: 'typescript' });

      const text = result.content[0]?.text ?? '';
      expect(text).toContain('.ts');
      expect(text).not.toContain('.py');
    });

    it('should filter by directory', async () => {
      // Use relative path for directory filtering (not absolute path)
      const result = await listFilesTool(indexer, { directory: 'src' });

      const text = result.content[0]?.text ?? '';
      expect(text).toContain('user-service.ts');
      expect(text).toContain('helpers.ts');
      expect(text).not.toContain('calculator.py');
    });
  });

  describe('list_functions tool', () => {
    it('should list functions and classes in a file', async () => {
      const filePath = path.join(tempProject.rootDir, 'src/services/user-service.ts');
      const result = await listFunctionsTool(indexer, { filePath });

      const text = result.content[0]?.text ?? '';
      expect(text).toContain('validateEmail');
      expect(text).toContain('UserService');
      expect(text).toContain('findById');
      expect(text).toContain('createUser');
    });

    it('should include method signatures', async () => {
      const filePath = path.join(tempProject.rootDir, 'src/services/user-service.ts');
      const result = await listFunctionsTool(indexer, { filePath });

      const text = result.content[0]?.text ?? '';
      expect(text).toContain('Promise');
    });

    it('should handle non-existent file', async () => {
      const result = await listFunctionsTool(indexer, {
        filePath: '/non/existent/file.ts',
      });

      const text = result.content[0]?.text ?? '';
      expect(text.toLowerCase()).toContain('not found');
    });
  });

  describe('get_function tool', () => {
    it('should retrieve function source code', async () => {
      const filePath = path.join(tempProject.rootDir, 'src/services/user-service.ts');
      const result = await getFunctionTool(indexer, {
        filePath,
        functionName: 'validateEmail',
      });

      const text = result.content[0]?.text ?? '';
      expect(text).toContain('validateEmail');
      expect(text).toContain('[FUNCTION]');
      expect(text).toContain('===SOURCE===');
      expect(text).toContain('return');
    });

    it('should retrieve class method source code', async () => {
      const filePath = path.join(tempProject.rootDir, 'src/services/user-service.ts');
      const result = await getFunctionTool(indexer, {
        filePath,
        functionName: 'findById',
      });

      const text = result.content[0]?.text ?? '';
      expect(text).toContain('findById');
    });

    it('should include context lines when requested', async () => {
      const filePath = path.join(tempProject.rootDir, 'src/services/user-service.ts');
      const result = await getFunctionTool(indexer, {
        filePath,
        functionName: 'validateEmail',
        includeContext: true,
        contextLines: 2,
      });

      const text = result.content[0]?.text ?? '';
      expect(text).toContain('[FUNCTION]');
      expect(text).toContain('===SOURCE===');
      expect(text).toContain('Validate email format');
    });

    it('should handle non-existent function', async () => {
      const filePath = path.join(tempProject.rootDir, 'src/services/user-service.ts');
      const result = await getFunctionTool(indexer, {
        filePath,
        functionName: 'nonexistent',
      });

      const text = result.content[0]?.text ?? '';
      expect(text.toLowerCase()).toContain('not found');
    });
  });

  describe('get_class tool', () => {
    it('should retrieve class source code', async () => {
      const filePath = path.join(tempProject.rootDir, 'src/services/user-service.ts');
      const result = await getClassTool(indexer, {
        filePath,
        className: 'UserService',
      });

      const text = result.content[0]?.text ?? '';
      expect(text).toContain('UserService');
      expect(text).toContain('[CLASS]');
      expect(text).toContain('===SOURCE===');
      expect(text).toContain('class UserService');
    });

    it('should show only signatures when methodsOnly is true', async () => {
      const filePath = path.join(tempProject.rootDir, 'src/services/user-service.ts');
      const result = await getClassTool(indexer, {
        filePath,
        className: 'UserService',
        methodsOnly: true,
      });

      const text = result.content[0]?.text ?? '';
      expect(text).toContain('[CLASS]');
      expect(text).toContain('[METHODS]');
      expect(text).not.toContain('===SOURCE===');
    });

    it('should handle non-existent class', async () => {
      const filePath = path.join(tempProject.rootDir, 'src/services/user-service.ts');
      const result = await getClassTool(indexer, {
        filePath,
        className: 'NonexistentClass',
      });

      const text = result.content[0]?.text ?? '';
      expect(text.toLowerCase()).toContain('not found');
    });

    it('should work with Python classes', async () => {
      const filePath = path.join(tempProject.rootDir, 'lib/calculator.py');
      const result = await getClassTool(indexer, {
        filePath,
        className: 'Calculator',
      });

      const text = result.content[0]?.text ?? '';
      expect(text).toContain('Calculator');
    });
  });

  describe('search_symbols tool', () => {
    it('should search for symbols by name', async () => {
      const result = await searchSymbolsTool(indexer, {
        query: 'validate',
      });

      const text = result.content[0]?.text ?? '';
      expect(text).toContain('validateEmail');
      expect(text).toContain('name\tkind\tfile\tline\tscore\tsignature');
    });

    it('should filter by type', async () => {
      const result = await searchSymbolsTool(indexer, {
        query: 'User',
        type: 'class',
      });

      const text = result.content[0]?.text ?? '';
      expect(text).toContain('UserService');
      // Should not include User interface when filtering for classes
    });

    it('should filter by language', async () => {
      const result = await searchSymbolsTool(indexer, {
        query: 'add',  // Search for a symbol that exists in Python
        language: 'python',
      });

      const text = result.content[0]?.text ?? '';
      expect(text).toContain('.py');
    });

    it('should handle no results', async () => {
      const result = await searchSymbolsTool(indexer, {
        query: 'xyznonexistent123',
      });

      const text = result.content[0]?.text ?? '';
      // Short error message now
      expect(text).toContain('No matches for');
    });

    it('should support fuzzy matching', async () => {
      const result = await searchSymbolsTool(indexer, {
        query: 'usrserv', // Typo for UserService
      });

      const text = result.content[0]?.text ?? '';
      // Fuzzy search should find UserService or similar
      expect(text.toLowerCase()).toContain('user');
    });

    it('should support type-based search without query', async () => {
      const result = await searchSymbolsTool(indexer, {
        return_type: 'User',
      });

      const text = result.content[0]?.text ?? '';
      expect(text).toContain('name\tkind\tfile\tline\tscore\tsignature');
      expect(text).toContain('createUser');
    });

    it('should reject incompatible symbol type filter in type mode', async () => {
      const result = await searchSymbolsTool(indexer, {
        return_type: 'User',
        type: 'class',
      });

      const text = result.content[0]?.text ?? '';
      expect(text).toContain('Type-based search only supports');
    });
  });

  describe('Tool response format', () => {
    it('should return MCP-compliant content format', async () => {
      const result = await listFilesTool(indexer, {});

      expect(result).toHaveProperty('content');
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content[0]).toHaveProperty('type');
      expect(result.content[0]).toHaveProperty('text');
    });
  });

  describe('Cross-tool workflows', () => {
    it('should enable search → get function workflow', async () => {
      // Step 1: Search for a symbol
      const searchResult = await searchSymbolsTool(indexer, {
        query: 'validateEmail',
      });

      const searchText = searchResult.content[0]?.text ?? '';
      expect(searchText).toContain('validateEmail');

      // Step 2: Get the function source
      const filePath = path.join(tempProject.rootDir, 'src/services/user-service.ts');
      const getResult = await getFunctionTool(indexer, {
        filePath,
        functionName: 'validateEmail',
      });

      const getText = getResult.content[0]?.text ?? '';
      expect(getText).toContain('return email.includes');
    });

    it('should enable list files → list functions → get function workflow', async () => {
      // Step 1: List files
      const listFilesResult = await listFilesTool(indexer, { language: 'typescript' });
      const filesText = listFilesResult.content[0]?.text ?? '';
      expect(filesText).toContain('user-service.ts');

      // Step 2: List functions in a file
      const filePath = path.join(tempProject.rootDir, 'src/services/user-service.ts');
      const listFuncsResult = await listFunctionsTool(indexer, { filePath });
      const funcsText = listFuncsResult.content[0]?.text ?? '';
      expect(funcsText).toContain('createUser');

      // Step 3: Get specific function
      const getFuncResult = await getFunctionTool(indexer, {
        filePath,
        functionName: 'createUser',
      });
      const funcText = getFuncResult.content[0]?.text ?? '';
      expect(funcText).toContain('this.users.set');
    });
  });
});
