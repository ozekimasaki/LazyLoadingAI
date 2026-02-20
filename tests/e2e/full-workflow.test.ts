import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Indexer } from '../../src/indexer/index.js';
import { createTempProject } from '../helpers/fixtures.js';

describe('E2E: Full Workflow', () => {
  let tempProject: ReturnType<typeof createTempProject>;
  let indexer: Indexer;
  let dbPath: string;

  beforeEach(() => {
    tempProject = createTempProject({
      'src/index.ts': `
export { UserService } from './services/user-service.js';
export { ProductService } from './services/product-service.js';
export { formatCurrency, formatDate } from './utils/formatters.js';
`,
      'src/services/user-service.ts': `
export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

export class UserService {
  private users = new Map<string, User>();

  async getUser(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async createUser(name: string, email: string): Promise<User> {
    const user: User = {
      id: crypto.randomUUID(),
      name,
      email,
      createdAt: new Date(),
    };
    this.users.set(user.id, user);
    return user;
  }

  async updateUser(id: string, updates: Partial<Omit<User, 'id' | 'createdAt'>>): Promise<User | null> {
    const user = this.users.get(id);
    if (!user) return null;
    Object.assign(user, updates);
    return user;
  }

  async deleteUser(id: string): Promise<boolean> {
    return this.users.delete(id);
  }

  async listUsers(): Promise<User[]> {
    return Array.from(this.users.values());
  }
}
`,
      'src/services/product-service.ts': `
export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
}

export class ProductService {
  private products = new Map<string, Product>();

  async getProduct(id: string): Promise<Product | null> {
    return this.products.get(id) ?? null;
  }

  async searchProducts(query: string): Promise<Product[]> {
    return Array.from(this.products.values())
      .filter(p => p.name.toLowerCase().includes(query.toLowerCase()));
  }

  async addProduct(product: Omit<Product, 'id'>): Promise<Product> {
    const newProduct: Product = {
      ...product,
      id: crypto.randomUUID(),
    };
    this.products.set(newProduct.id, newProduct);
    return newProduct;
  }
}
`,
      'src/utils/formatters.ts': `
export function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount);
}

export function formatDate(date: Date, locale = 'en-US'): string {
  return new Intl.DateTimeFormat(locale).format(date);
}

export function formatNumber(num: number, decimals = 2): string {
  return num.toFixed(decimals);
}
`,
      'lib/helpers.py': `
"""Helper functions for the Python portion of the project."""

from typing import List, Dict, Any, Optional


def process_data(data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Process a list of data records.

    Args:
        data: List of dictionaries to process

    Returns:
        Processed data with normalized keys
    """
    return [
        {k.lower(): v for k, v in record.items()}
        for record in data
    ]


def validate_email(email: str) -> bool:
    """Validate an email address.

    Args:
        email: The email address to validate

    Returns:
        True if valid, False otherwise
    """
    import re
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$'
    return bool(re.match(pattern, email))


class DataProcessor:
    """A class for processing data records."""

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """Initialize the processor.

        Args:
            config: Optional configuration dictionary
        """
        self.config = config or {}

    def transform(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Transform a data record.

        Args:
            data: The record to transform

        Returns:
            Transformed record
        """
        return {k.strip(): v for k, v in data.items()}
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

  describe('Complete workflow: Index → Search → Retrieve', () => {
    it('should index project, search symbols, and retrieve source', async () => {
      // Step 1: Create and initialize indexer
      indexer = new Indexer({
        rootDirectory: tempProject.rootDir,
        databasePath: dbPath,
        include: ['**/*.ts', '**/*.py'],
        exclude: [],
      });
      await indexer.initialize();

      // Step 2: Index the project
      const indexResult = await indexer.indexDirectory();

      expect(indexResult.totalFiles).toBe(5);
      expect(indexResult.indexedFiles).toBe(5);
      expect(indexResult.errors).toHaveLength(0);

      // Step 3: Verify stats
      const stats = await indexer.getStats();
      expect(stats.totalFiles).toBe(5);
      expect(stats.byLanguage.typescript.files).toBe(4);
      expect(stats.byLanguage.python.files).toBe(1);

      // Step 4: Search for symbols
      const userResults = await indexer.searchSymbols('User');
      expect(userResults.length).toBeGreaterThan(0);
      expect(userResults.some(r => r.symbol.name === 'UserService')).toBe(true);
      expect(userResults.some(r => r.symbol.name === 'User')).toBe(true);

      // Step 5: Retrieve function details
      const userServiceFile = path.join(tempProject.rootDir, 'src/services/user-service.ts');
      const getUserFunc = await indexer.getFunction(userServiceFile, 'getUser');
      expect(getUserFunc).not.toBeNull();
      expect(getUserFunc?.name).toBe('getUser');

      // Step 6: Retrieve source code
      const source = await indexer.getFunctionSource(userServiceFile, 'getUser');
      expect(source).not.toBeNull();
      expect(source).toContain('getUser');
      expect(source).toContain('this.users.get(id)');

      // Step 7: Verify class retrieval
      const userServiceClass = await indexer.getClass(userServiceFile, 'UserService');
      expect(userServiceClass).not.toBeNull();
      expect(userServiceClass?.methods.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('Incremental updates workflow', () => {
    it('should detect and update modified files', async () => {
      indexer = new Indexer({
        rootDirectory: tempProject.rootDir,
        databasePath: dbPath,
        include: ['**/*.ts'],
        exclude: [],
      });
      await indexer.initialize();

      // Initial index
      await indexer.indexDirectory();

      // Verify initial state
      let formattersFile = await indexer.getFile(
        path.join(tempProject.rootDir, 'src/utils/formatters.ts')
      );
      const initialFuncCount = formattersFile?.functions.length;

      // Modify file by adding new function
      const formatterPath = path.join(tempProject.rootDir, 'src/utils/formatters.ts');
      const content = fs.readFileSync(formatterPath, 'utf-8');
      const newContent = content + `

export function formatPercentage(value: number): string {
  return (value * 100).toFixed(1) + '%';
}
`;
      fs.writeFileSync(formatterPath, newContent);

      // Re-index
      const reindexResult = await indexer.indexDirectory();
      expect(reindexResult.indexedFiles).toBe(1);
      expect(reindexResult.skippedFiles).toBe(3); // Other files unchanged

      // Verify new function is indexed
      formattersFile = await indexer.getFile(formatterPath);
      expect(formattersFile?.functions.length).toBeGreaterThan(initialFuncCount!);
      expect(formattersFile?.functions.some(f => f.name === 'formatPercentage')).toBe(true);

      // Search should find new function
      const searchResults = await indexer.searchSymbols('formatPercentage');
      expect(searchResults.length).toBeGreaterThan(0);
    });
  });

  describe('File deletion workflow', () => {
    it('should remove deleted files from index', async () => {
      indexer = new Indexer({
        rootDirectory: tempProject.rootDir,
        databasePath: dbPath,
        include: ['**/*.ts', '**/*.py'],
        exclude: [],
      });
      await indexer.initialize();
      await indexer.indexDirectory();

      // Verify file is indexed
      const helperPath = path.join(tempProject.rootDir, 'lib/helpers.py');
      let helperFile = await indexer.getFile(helperPath);
      expect(helperFile).not.toBeNull();

      // Search for Python symbol
      let searchResults = await indexer.searchSymbols('DataProcessor', { language: 'python' });
      expect(searchResults.length).toBeGreaterThan(0);

      // Remove the file from index
      await indexer.removeFile(helperPath);

      // Verify file is removed
      helperFile = await indexer.getFile(helperPath);
      expect(helperFile).toBeNull();

      // Search should no longer find it
      searchResults = await indexer.searchSymbols('DataProcessor', { language: 'python' });
      expect(searchResults.length).toBe(0);

      // Stats should be updated
      const stats = await indexer.getStats();
      expect(stats.byLanguage.python.files).toBe(0);
    });
  });

  describe('Multi-language indexing', () => {
    it('should handle TypeScript and Python files together', async () => {
      indexer = new Indexer({
        rootDirectory: tempProject.rootDir,
        databasePath: dbPath,
        include: ['**/*.ts', '**/*.py'],
        exclude: [],
      });
      await indexer.initialize();
      await indexer.indexDirectory();

      // Search across languages
      const validateResults = await indexer.searchSymbols('validate');
      expect(validateResults.some(r => r.symbol.filePath.endsWith('.py'))).toBe(true);

      // Filter by language
      const tsResults = await indexer.searchSymbols('Service', { language: 'typescript' });
      const pyResults = await indexer.searchSymbols('Processor', { language: 'python' });

      expect(tsResults.every(r => r.symbol.filePath.endsWith('.ts'))).toBe(true);
      expect(pyResults.every(r => r.symbol.filePath.endsWith('.py'))).toBe(true);

      // Stats by language
      const stats = await indexer.getStats();
      expect(stats.byLanguage.typescript.classes).toBeGreaterThanOrEqual(2);
      expect(stats.byLanguage.python.classes).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Data persistence', () => {
    it('should persist data across indexer instances', async () => {
      // First indexer instance
      indexer = new Indexer({
        rootDirectory: tempProject.rootDir,
        databasePath: dbPath,
        include: ['**/*.ts'],
        exclude: [],
      });
      await indexer.initialize();
      await indexer.indexDirectory();

      // Get stats from first instance
      const firstStats = await indexer.getStats();

      // Close first indexer
      await indexer.close();

      // Create second indexer instance with same DB
      const secondIndexer = new Indexer({
        rootDirectory: tempProject.rootDir,
        databasePath: dbPath,
        include: ['**/*.ts'],
        exclude: [],
      });
      await secondIndexer.initialize();

      // Verify data persisted
      const secondStats = await secondIndexer.getStats();
      expect(secondStats.totalFiles).toBe(firstStats.totalFiles);
      expect(secondStats.totalSymbols).toBe(firstStats.totalSymbols);

      // Search should work
      const results = await secondIndexer.searchSymbols('UserService');
      expect(results.length).toBeGreaterThan(0);

      await secondIndexer.close();
    });
  });

  describe('Complex search scenarios', () => {
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

    it('should find methods within classes', async () => {
      const results = await indexer.searchSymbols('createUser');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.symbol.kind === 'method')).toBe(true);
    });

    it('should find interfaces', async () => {
      const results = await indexer.searchSymbols('User', { type: 'interface' });
      expect(results.length).toBeGreaterThan(0);
    });

    it('should support pagination', async () => {
      // Get first page
      const page1 = await indexer.searchSymbols('', { limit: 5, offset: 0 });

      // Get second page
      const page2 = await indexer.searchSymbols('', { limit: 5, offset: 5 });

      // Pages should be different (if enough results)
      if (page1.length === 5 && page2.length > 0) {
        expect(page1[0]?.symbol.id).not.toBe(page2[0]?.symbol.id);
      }
    });
  });
});
