/**
 * Test fixture utilities
 */

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Get the absolute path to a fixture file
 */
export function getFixturePath(...parts: string[]): string {
  return path.join(__dirname, '../fixtures', ...parts);
}

/**
 * Read a fixture file's contents
 */
export async function readFixture(...parts: string[]): Promise<string> {
  const fixturePath = getFixturePath(...parts);
  return fs.promises.readFile(fixturePath, 'utf-8');
}

export interface TempProjectResult {
  rootDir: string;
  cleanup: () => void;
  addFile: (relativePath: string, content: string) => string;
  removeFile: (relativePath: string) => void;
  getFilePath: (relativePath: string) => string;
}

/**
 * Create a temporary project directory with files
 */
export function createTempProject(files: Record<string, string> = {}): TempProjectResult {
  const rootDir = path.join(os.tmpdir(), `lazyload-project-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(rootDir, { recursive: true });

  // Add initial files
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(rootDir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }

  const cleanup = () => {
    try {
      fs.rmSync(rootDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  };

  const addFile = (relativePath: string, content: string): string => {
    const filePath = path.join(rootDir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
    return filePath;
  };

  const removeFile = (relativePath: string): void => {
    const filePath = path.join(rootDir, relativePath);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  };

  const getFilePath = (relativePath: string): string => {
    return path.join(rootDir, relativePath);
  };

  return { rootDir, cleanup, addFile, removeFile, getFilePath };
}

/**
 * Sample TypeScript content for testing
 */
export const SAMPLE_TYPESCRIPT = `
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

export class UserService {
  private users: Map<string, User> = new Map();

  async findById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async save(user: User): Promise<void> {
    this.users.set(user.id, user);
  }
}

interface User {
  id: string;
  name: string;
  email: string;
}

export type UserId = string;
`;

/**
 * Sample Python content for testing
 */
export const SAMPLE_PYTHON = `
def greet(name: str) -> str:
    """Greet a person by name."""
    return f"Hello, {name}!"

class UserService:
    """Service for managing users."""

    def __init__(self):
        self._users = {}

    async def find_by_id(self, id: str):
        """Find a user by ID."""
        return self._users.get(id)

    async def save(self, user):
        """Save a user."""
        self._users[user.id] = user
`;

/**
 * Sample config file contents
 */
export const VALID_CONFIG = {
  directories: ['.'],
  output: {
    database: '.lazyload/test.db',
  },
  include: ['**/*.ts', '**/*.py'],
  exclude: ['**/node_modules/**'],
  languages: {
    typescript: {
      extractDocumentation: true,
      includePrivate: false,
    },
  },
};

export const MINIMAL_CONFIG = {};

export const INVALID_SCHEMA_CONFIG = {
  directories: 'not-an-array',  // Should be array
  output: {
    database: 123,  // Should be string
  },
};
