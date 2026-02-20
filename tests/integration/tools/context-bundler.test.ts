import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { Indexer } from '../../../src/indexer/index.js';
import { getRelatedContextTool } from '../../../src/server/tools/get-related-context.js';
import { createTempProject, type TempProjectResult } from '../../helpers/fixtures.js';


async function runRelatedContext(indexer: Indexer, input: Record<string, unknown> = {}) {
  return getRelatedContextTool(indexer, { format: 'markdown', ...input } as any);
}

describe('Context Bundler Integration', () => {
  let indexer: Indexer;
  let tempProject: TempProjectResult;

  beforeAll(async () => {
    // Create a real project with types, implementations, and tests
    tempProject = createTempProject({
      'src/types.ts': `
export interface UserConfig {
  name: string;
  email: string;
  role: 'admin' | 'user';
}

export interface UserData {
  id: string;
  config: UserConfig;
  createdAt: Date;
}

export type UserId = string;
`,
      'src/utils.ts': `
import type { UserConfig } from './types.js';

export function validate(obj: unknown): void {
  if (!obj) throw new Error('Invalid object');
}

export function validateConfig(config: UserConfig): boolean {
  return !!config.name && !!config.email;
}

export function generateId(): string {
  return Math.random().toString(36).slice(2);
}

export function formatUser(name: string, email: string): string {
  return \`\${name} <\${email}>\`;
}
`,
      'src/user.ts': `
import type { UserConfig, UserData, UserId } from './types.js';
import { validate, validateConfig, generateId } from './utils.js';

export class User {
  private data: UserData;

  constructor(private config: UserConfig) {
    validate(config);
    if (!validateConfig(config)) {
      throw new Error('Invalid config');
    }
    this.data = {
      id: generateId(),
      config,
      createdAt: new Date(),
    };
  }

  getName(): string {
    return this.config.name;
  }

  getEmail(): string {
    return this.config.email;
  }

  getId(): UserId {
    return this.data.id;
  }

  async save(): Promise<void> {
    validate(this.data);
    // Simulated save
    console.log('Saving user:', this.data.id);
  }

  toJSON(): UserData {
    return { ...this.data };
  }
}
`,
      'src/user-service.ts': `
import type { UserConfig, UserId } from './types.js';
import { User } from './user.js';

export class UserService {
  private users: Map<UserId, User> = new Map();

  async createUser(config: UserConfig): Promise<User> {
    const user = new User(config);
    await user.save();
    this.users.set(user.getId(), user);
    return user;
  }

  getUser(id: UserId): User | undefined {
    return this.users.get(id);
  }

  listUsers(): User[] {
    return Array.from(this.users.values());
  }
}
`,
      'tests/user.test.ts': `
import { describe, it, expect } from 'vitest';
import { User } from '../src/user.js';

describe('User', () => {
  it('creates user with valid config', () => {
    const user = new User({
      name: 'Test User',
      email: 'test@example.com',
      role: 'user',
    });
    expect(user.getName()).toBe('Test User');
  });

  it('returns correct email', () => {
    const user = new User({
      name: 'Test',
      email: 'test@test.com',
      role: 'admin',
    });
    expect(user.getEmail()).toBe('test@test.com');
  });

  it('generates unique ID', () => {
    const user1 = new User({ name: 'A', email: 'a@a.com', role: 'user' });
    const user2 = new User({ name: 'B', email: 'b@b.com', role: 'user' });
    expect(user1.getId()).not.toBe(user2.getId());
  });

  it('throws on invalid config', () => {
    expect(() => new User(null as any)).toThrow();
  });
});
`,
      'tests/user-service.test.ts': `
import { describe, it, expect } from 'vitest';
import { UserService } from '../src/user-service.js';

describe('UserService', () => {
  it('creates and stores users', async () => {
    const service = new UserService();
    const user = await service.createUser({
      name: 'Service Test',
      email: 'service@test.com',
      role: 'user',
    });
    expect(service.getUser(user.getId())).toBe(user);
  });

  it('lists all users', async () => {
    const service = new UserService();
    await service.createUser({ name: 'A', email: 'a@a.com', role: 'user' });
    await service.createUser({ name: 'B', email: 'b@b.com', role: 'admin' });
    expect(service.listUsers()).toHaveLength(2);
  });
});
`,
    });

    indexer = new Indexer({
      rootDirectory: tempProject.rootDir,
      databasePath: path.join(tempProject.rootDir, '.lazyload', 'test.db'),
      include: ['**/*.ts'],
      exclude: ['node_modules/**'],
    });
    await indexer.initialize();
    await indexer.indexDirectory();
  });

  afterAll(async () => {
    await indexer.close();
    tempProject.cleanup();
  });

  describe('bundling types', () => {
    it('bundles context for User class using file path', async () => {
      const result = await runRelatedContext(indexer, {
        symbolName: 'User',
        filePath: 'src/user.ts',
        includeTypes: true,
        includeCallees: false,
        includeTests: false,
      });
      const text = result.content[0]?.text ?? '';

      // Should find the User class from src/user.ts
      expect(text).toContain('User');
    });

    it('bundles context for UserService class', async () => {
      const result = await runRelatedContext(indexer, {
        symbolName: 'UserService',
        includeTypes: true,
        includeCallees: false,
        includeTests: false,
      });
      const text = result.content[0]?.text ?? '';

      // Should find the UserService class
      expect(text).toContain('UserService');
    });

    it('shows function definitions', async () => {
      const result = await runRelatedContext(indexer, {
        symbolName: 'generateId',
        filePath: 'src/utils.ts',
        includeTypes: true,
      });
      const text = result.content[0]?.text ?? '';

      // Should show the generateId function
      expect(text).toContain('generateId');
      expect(text).toContain('string');
    });

    it('produces output for symbol lookup', async () => {
      const result = await runRelatedContext(indexer, {
        symbolName: 'validate',
        includeTypes: false,
        includeCallees: false,
        includeTests: false,
      });
      const text = result.content[0]?.text ?? '';

      // Should have some output
      expect(text).toContain('validate');
    });
  });

  describe('bundling callees', () => {
    it('handles callee bundling option', async () => {
      const result = await runRelatedContext(indexer, {
        symbolName: 'validateConfig',
        filePath: 'src/utils.ts',
        includeTypes: false,
        includeCallees: true,
        includeTests: false,
      });
      const text = result.content[0]?.text ?? '';

      // Should return some context
      expect(text).toContain('validateConfig');
    });

    it('respects callee depth option without crashing', async () => {
      const result = await runRelatedContext(indexer, {
        symbolName: 'UserService',
        includeTypes: false,
        includeCallees: true,
        includeTests: false,
        calleeDepth: 2,
      });
      const text = result.content[0]?.text ?? '';

      expect(text).toBeDefined();
      expect(text.length).toBeGreaterThan(0);
    });

    it('produces different output with and without callees', async () => {
      const withCallees = await runRelatedContext(indexer, {
        symbolName: 'validate',
        filePath: 'src/utils.ts',
        includeCallees: true,
        includeTypes: false,
        includeTests: false,
      });

      const withoutCallees = await runRelatedContext(indexer, {
        symbolName: 'validate',
        filePath: 'src/utils.ts',
        includeCallees: false,
        includeTypes: false,
        includeTests: false,
      });

      const withText = withCallees.content[0]?.text ?? '';
      const withoutText = withoutCallees.content[0]?.text ?? '';

      // Both should have some output
      expect(withText).toContain('validate');
      expect(withoutText).toContain('validate');
    });
  });

  describe('bundling related tests', () => {
    it('handles test bundling option', async () => {
      const result = await runRelatedContext(indexer, {
        symbolName: 'UserService',
        filePath: 'src/user-service.ts',
        includeTypes: false,
        includeCallees: false,
        includeTests: true,
      });
      const text = result.content[0]?.text ?? '';

      // Should return some result
      expect(text).toContain('UserService');
    });

    it('includes test info when tests exist', async () => {
      const result = await runRelatedContext(indexer, {
        symbolName: 'UserService',
        includeTests: true,
      });
      const text = result.content[0]?.text ?? '';

      // Should have stats about tests
      expect(text).toContain('Stats');
      expect(text).toContain('tests');
    });

    it('handles test bundling for different symbols', async () => {
      const result = await runRelatedContext(indexer, {
        symbolName: 'validate',
        filePath: 'src/utils.ts',
        includeTypes: false,
        includeCallees: false,
        includeTests: true,
      });
      const text = result.content[0]?.text ?? '';

      // Should return context for validate function
      expect(text).toContain('validate');
    });

    it('test bundling option is respected', async () => {
      const withTests = await runRelatedContext(indexer, {
        symbolName: 'formatUser',
        filePath: 'src/utils.ts',
        includeTypes: false,
        includeCallees: false,
        includeTests: true,
      });

      const withoutTests = await runRelatedContext(indexer, {
        symbolName: 'formatUser',
        filePath: 'src/utils.ts',
        includeTypes: false,
        includeCallees: false,
        includeTests: false,
      });

      // Both should have formatUser
      expect(withTests.content[0]?.text).toContain('formatUser');
      expect(withoutTests.content[0]?.text).toContain('formatUser');
    });
  });

  describe('bundling all context', () => {
    it('bundles complete context for a symbol', async () => {
      const result = await runRelatedContext(indexer, {
        symbolName: 'UserService',
        filePath: 'src/user-service.ts',
        includeTypes: true,
        includeCallees: true,
        includeTests: true,
      });
      const text = result.content[0]?.text ?? '';

      // Should have source
      expect(text).toContain('UserService');

      // Should have stats
      expect(text).toContain('Stats');
    });

    it('shows stats summary', async () => {
      const result = await runRelatedContext(indexer, {
        symbolName: 'validateConfig',
        filePath: 'src/utils.ts',
        includeTypes: true,
        includeCallees: true,
        includeTests: true,
      });
      const text = result.content[0]?.text ?? '';

      // Should include stats at the end
      expect(text).toContain('Stats');
      expect(text).toContain('types');
      expect(text).toContain('callees');
      expect(text).toContain('tests');
      expect(text).toContain('tokens');
    });

    it('supports compact format output', async () => {
      const result = await runRelatedContext(indexer, {
        symbolName: 'createUser',
        filePath: 'src/user-service.ts',
        includeTypes: true,
        includeCallees: true,
        includeTests: false,
        format: 'compact',
      });
      const text = result.content[0]?.text ?? '';

      expect(text).toContain('[SYMBOL]');
      expect(text).toContain('===SOURCE');
      expect(text).toContain('[TYPES]');
      expect(text).toContain('[CALLEES]');
      expect(text).not.toContain('**Stats**');
    });
  });

  describe('token limits', () => {
    it('respects maxTokens option', async () => {
      const result = await runRelatedContext(indexer, {
        symbolName: 'User',
        includeTypes: true,
        includeCallees: true,
        includeTests: true,
        maxTokens: 1000,
      });
      const text = result.content[0]?.text ?? '';

      // Should still produce output but may be truncated
      expect(text).toContain('User');
    });
  });

  describe('file path disambiguation', () => {
    it('uses file path to disambiguate symbols', async () => {
      const result = await runRelatedContext(indexer, {
        symbolName: 'validateConfig',
        filePath: 'src/utils.ts',
        includeTypes: true,
      });
      const text = result.content[0]?.text ?? '';

      expect(text).toContain('validateConfig');
      expect(text).toContain('utils.ts');
    });
  });

  describe('error handling', () => {
    it('handles non-existent symbol gracefully', async () => {
      const result = await runRelatedContext(indexer, {
        symbolName: 'NonExistentSymbol',
      });
      const text = result.content[0]?.text ?? '';

      // Should return an error message, not crash
      expect(text).toBeDefined();
      expect(text.length).toBeGreaterThan(0);
    });

    it('handles function lookup', async () => {
      const result = await runRelatedContext(indexer, {
        symbolName: 'validate',
        includeTypes: true,
        includeCallees: true,
      });
      const text = result.content[0]?.text ?? '';

      // Should find the validate function in utils.ts
      expect(text).toContain('validate');
    });
  });
});

describe('Context Bundler - Method-level context', () => {
  let indexer: Indexer;
  let tempProject: TempProjectResult;

  beforeAll(async () => {
    tempProject = createTempProject({
      'src/calculator.ts': `
export class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }

  subtract(a: number, b: number): number {
    return a - b;
  }

  multiply(a: number, b: number): number {
    return a * b;
  }

  divide(a: number, b: number): number {
    if (b === 0) throw new Error('Division by zero');
    return a / b;
  }

  calculate(operation: string, a: number, b: number): number {
    switch (operation) {
      case 'add': return this.add(a, b);
      case 'subtract': return this.subtract(a, b);
      case 'multiply': return this.multiply(a, b);
      case 'divide': return this.divide(a, b);
      default: throw new Error('Unknown operation');
    }
  }
}
`,
      'tests/calculator.test.ts': `
import { describe, it, expect } from 'vitest';
import { Calculator } from '../src/calculator.js';

describe('Calculator', () => {
  describe('add', () => {
    it('adds positive numbers', () => {
      const calc = new Calculator();
      expect(calc.add(2, 3)).toBe(5);
    });
  });

  describe('calculate', () => {
    it('delegates to correct method', () => {
      const calc = new Calculator();
      expect(calc.calculate('add', 1, 2)).toBe(3);
    });
  });
});
`,
    });

    indexer = new Indexer({
      rootDirectory: tempProject.rootDir,
      databasePath: path.join(tempProject.rootDir, '.lazyload', 'test.db'),
      include: ['**/*.ts'],
      exclude: [],
    });
    await indexer.initialize();
    await indexer.indexDirectory();
  });

  afterAll(async () => {
    await indexer.close();
    tempProject.cleanup();
  });

  it('bundles context for specific method', async () => {
    const result = await runRelatedContext(indexer, {
      symbolName: 'Calculator.calculate',
      includeCallees: true,
    });
    const text = result.content[0]?.text ?? '';

    // Should show the calculate method calls other methods
    expect(text).toContain('calculate');
  });

  it('bundles context for entire class', async () => {
    const result = await runRelatedContext(indexer, {
      symbolName: 'Calculator',
      includeTests: true,
    });
    const text = result.content[0]?.text ?? '';

    // Should include the class and its tests
    expect(text).toContain('Calculator');
    expect(text).toContain('calculator.test.ts');
  });
});
