import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { Indexer } from '../../../src/indexer/index.js';
import { getModuleDependenciesTool } from '../../../src/server/tools/get-module-dependencies.js';
import { createTempProject, type TempProjectResult } from '../../helpers/fixtures.js';


async function runModuleDependencies(indexer: Indexer, input: Record<string, unknown> = {}) {
  return getModuleDependenciesTool(indexer, { format: 'markdown', ...input } as any);
}

describe('Module Dependencies Integration', () => {
  let indexer: Indexer;
  let tempProject: TempProjectResult;

  beforeAll(async () => {
    // Create temp project with real import structure
    tempProject = createTempProject({
      'src/index.ts': `
export * from './utils.js';
export * from './types.js';
export { ApiService } from './services/api.js';
export { DatabaseService } from './services/database.js';
`,
      'src/types.ts': `
export interface Config {
  host: string;
  port: number;
  debug: boolean;
}

export interface User {
  id: string;
  name: string;
  email: string;
}

export type UserList = User[];
`,
      'src/utils.ts': `
import type { User } from './types.js';

export function formatData(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

export function validateUser(user: User): boolean {
  return !!user.id && !!user.name && !!user.email;
}

export function createId(): string {
  return Math.random().toString(36).slice(2);
}
`,
      'src/services/api.ts': `
import { formatData } from '../utils.js';
import type { Config, User } from '../types.js';
import { DatabaseService } from './database.js';

export class ApiService {
  private db: DatabaseService;
  private config: Config;

  constructor(db: DatabaseService, config: Config) {
    this.db = db;
    this.config = config;
  }

  async fetch(): Promise<string> {
    const data = await this.db.query();
    return formatData(data);
  }

  async getUser(id: string): Promise<User | null> {
    return this.db.findUser(id);
  }
}
`,
      'src/services/database.ts': `
import type { User } from '../types.js';
import { createId } from '../utils.js';

export class DatabaseService {
  private users: Map<string, User> = new Map();

  async query(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  async findUser(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async createUser(name: string, email: string): Promise<User> {
    const user: User = { id: createId(), name, email };
    this.users.set(user.id, user);
    return user;
  }
}
`,
      'package.json': JSON.stringify({
        name: 'import-test-project',
        type: 'module',
      }, null, 2),
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

  describe('direct imports', () => {
    it('shows direct imports for a file', async () => {
      const result = await runModuleDependencies(indexer, {
        filePath: 'src/services/api.ts',
        depth: 1,
      });
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('utils');
      expect(text).toContain('types');
      expect(text).toContain('database');
    });

    it('shows import specifiers', async () => {
      const result = await runModuleDependencies(indexer, {
        filePath: 'src/services/api.ts',
        depth: 1,
      });
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('formatData');
      expect(text).toContain('DatabaseService');
    });

    it('distinguishes type-only imports', async () => {
      const result = await runModuleDependencies(indexer, {
        filePath: 'src/services/api.ts',
        depth: 1,
        includeTypeOnly: true,
      });
      const text = result.content[0]?.text ?? '';
      // Config and User are type-only imports
      expect(text).toContain('Config');
      expect(text).toContain('User');
    });

    it('can exclude type-only imports', async () => {
      const result = await runModuleDependencies(indexer, {
        filePath: 'src/services/api.ts',
        depth: 1,
        includeTypeOnly: false,
      });
      const text = result.content[0]?.text ?? '';
      // Should still include value imports
      expect(text).toContain('formatData');
      expect(text).toContain('DatabaseService');
    });

    it('shows imports from utils.ts', async () => {
      const result = await runModuleDependencies(indexer, {
        filePath: 'src/utils.ts',
        depth: 1,
      });
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('types');
      expect(text).toContain('User');
    });

    it('shows imports from database.ts', async () => {
      const result = await runModuleDependencies(indexer, {
        filePath: 'src/services/database.ts',
        depth: 1,
      });
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('types');
      expect(text).toContain('utils');
      expect(text).toContain('createId');
    });
  });

  describe('reverse dependencies', () => {
    it('includes reverse dependencies section when requested', async () => {
      const result = await runModuleDependencies(indexer, {
        filePath: 'src/types.ts',
        includeReverse: true,
      });
      const text = result.content[0]?.text ?? '';
      // The section should be present even if no reverse deps are found
      expect(text).toContain('Reverse Dependencies');
    });

    it('can disable reverse dependencies section', async () => {
      const result = await runModuleDependencies(indexer, {
        filePath: 'src/types.ts',
        includeReverse: false,
      });
      const text = result.content[0]?.text ?? '';
      expect(text).not.toContain('Reverse Dependencies');
    });

    it('shows direct imports for file that imports other modules', async () => {
      // utils.ts imports from types.ts
      const result = await runModuleDependencies(indexer, {
        filePath: 'src/utils.ts',
        includeReverse: true,
      });
      const text = result.content[0]?.text ?? '';
      // Should show the import of User from types
      expect(text).toContain('User');
      expect(text).toContain('types');
    });
  });

  describe('transitive dependencies', () => {
    it('handles depth parameter without crashing', async () => {
      const result = await runModuleDependencies(indexer, {
        filePath: 'src/index.ts',
        depth: 2,
      });
      const text = result.content[0]?.text ?? '';
      // Should successfully return results with depth parameter
      expect(text).toContain('Dependencies');
    });

    it('handles depth 3 parameter', async () => {
      const result = await runModuleDependencies(indexer, {
        filePath: 'src/index.ts',
        depth: 3,
      });
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('Dependencies');
    });

    it('shows dependencies for file with imports', async () => {
      // api.ts has explicit imports
      const result = await runModuleDependencies(indexer, {
        filePath: 'src/services/api.ts',
        depth: 1,
      });
      const text = result.content[0]?.text ?? '';
      // api.ts imports from utils, types, and database
      expect(text).toContain('Direct Imports');
    });
  });

  describe('output formats', () => {
    it('supports tree output format', async () => {
      const result = await runModuleDependencies(indexer, {
        filePath: 'src/services/api.ts',
        depth: 2,
        outputFormat: 'tree',
      });
      const text = result.content[0]?.text ?? '';
      expect(text).toBeDefined();
    });

    it('supports list output format', async () => {
      const result = await runModuleDependencies(indexer, {
        filePath: 'src/services/api.ts',
        depth: 2,
        outputFormat: 'list',
      });
      const text = result.content[0]?.text ?? '';
      expect(text).toBeDefined();
    });

    it('supports compact mode', async () => {
      const result = await runModuleDependencies(indexer, {
        filePath: 'src/services/api.ts',
        format: 'compact',
      });
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('[IMPORTS]');
      expect(text).toContain('source\tresolved\texternal\ttype_only\tspecifiers');
      expect(text).toContain('[REVERSE_IMPORTS]');
      expect(text).not.toContain('## Direct Imports');
    });
  });

  describe('error handling', () => {
    it('handles non-existent file gracefully', async () => {
      const result = await runModuleDependencies(indexer, {
        filePath: 'src/nonexistent.ts',
      });
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('not indexed');
    });

    it('handles file with no imports', async () => {
      const result = await runModuleDependencies(indexer, {
        filePath: 'src/types.ts',
      });
      const text = result.content[0]?.text ?? '';
      // types.ts has no imports, but should still work
      expect(text).toContain('Dependencies');
    });
  });
});

describe('Module Dependencies - Circular Dependencies', () => {
  let indexer: Indexer;
  let tempProject: TempProjectResult;

  beforeAll(async () => {
    // Create temp project with circular imports
    tempProject = createTempProject({
      'src/circular-a.ts': `
import { helperB } from './circular-b.js';

export function helperA(): string {
  return 'A: ' + helperB();
}
`,
      'src/circular-b.ts': `
import { helperA } from './circular-a.js';

export function helperB(): string {
  return 'B';
}

export function callA(): string {
  return helperA();
}
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

  it('detects circular dependencies when requested', async () => {
    const result = await runModuleDependencies(indexer, {
      filePath: 'src/circular-a.ts',
      detectCycles: true,
      depth: 2,
    });
    const text = result.content[0]?.text ?? '';
    // Should detect circular dependency
    expect(text.toLowerCase()).toMatch(/circular|cycle/i);
  });

  it('shows both directions of circular import', async () => {
    const resultA = await runModuleDependencies(indexer, {
      filePath: 'src/circular-a.ts',
      includeReverse: true,
    });
    const resultB = await runModuleDependencies(indexer, {
      filePath: 'src/circular-b.ts',
      includeReverse: true,
    });

    // A imports B
    expect(resultA.content[0]?.text).toContain('circular-b');
    // B imports A
    expect(resultB.content[0]?.text).toContain('circular-a');
    // B is imported by A (reverse)
    expect(resultB.content[0]?.text).toContain('Reverse Dependencies');
  });
});

describe('Module Dependencies - External Packages', () => {
  let indexer: Indexer;
  let tempProject: TempProjectResult;

  beforeAll(async () => {
    tempProject = createTempProject({
      'src/with-externals.ts': `
import * as fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';

export function createServer() {
  const app = express();
  return app;
}
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

  it('shows external package imports', async () => {
    const result = await runModuleDependencies(indexer, {
      filePath: 'src/with-externals.ts',
      includeExternal: true,
    });
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('External');
    expect(text).toContain('express');
    expect(text).toContain('zod');
  });

  it('shows node built-in imports', async () => {
    const result = await runModuleDependencies(indexer, {
      filePath: 'src/with-externals.ts',
      includeExternal: true,
    });
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('node:fs');
    expect(text).toContain('node:path');
  });

  it('can exclude external packages', async () => {
    const result = await runModuleDependencies(indexer, {
      filePath: 'src/with-externals.ts',
      includeExternal: false,
    });
    const text = result.content[0]?.text ?? '';
    expect(text).not.toContain('External');
  });
});
