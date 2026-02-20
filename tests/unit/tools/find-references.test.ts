/**
 * Unit tests for find-references tool
 */

import { describe, it, expect } from 'vitest';
import { findReferencesTool } from '../../../src/server/tools/find-references.js';
import { createMockIndexer } from '../../helpers/mocks/indexer.js';
import { createTestSymbolReference } from '../../helpers/database.js';


async function runFindReferences(indexer: any, input: Record<string, unknown> = {}) {
  return findReferencesTool(indexer, { format: 'markdown', ...input } as any);
}

describe('findReferencesTool', () => {
  describe('finding references', () => {
    it('finds symbol references across multiple files', async () => {
      const mockIndexer = createMockIndexer({
        symbolReferences: [
          createTestSymbolReference({
            symbolName: 'validateUser',
            referencingFile: '/src/auth/login.ts',
            lineNumber: 15,
            context: 'validateUser(user)',
            referenceKind: 'call',
          }),
          createTestSymbolReference({
            symbolName: 'validateUser',
            referencingFile: '/src/api/users.ts',
            lineNumber: 42,
            context: 'if (validateUser(u))',
            referenceKind: 'call',
          }),
        ],
      });

      const result = await runFindReferences(mockIndexer as any, {
        symbolName: 'validateUser',
      });

      expect(result.content[0].text).toContain('References to "validateUser"');
      expect(result.content[0].text).toContain('/src/auth/login.ts');
      expect(result.content[0].text).toContain('/src/api/users.ts');
      expect(result.content[0].text).toContain('Found 2 references');
    });

    it('filters by filePath when provided', async () => {
      const mockIndexer = createMockIndexer({
        symbolReferences: [
          createTestSymbolReference({
            symbolName: 'formatDate',
            referencingFile: '/src/utils/date.ts',
            lineNumber: 10,
            context: 'formatDate(d)',
          }),
          createTestSymbolReference({
            symbolName: 'formatDate',
            referencingFile: '/src/components/DatePicker.tsx',
            lineNumber: 25,
            context: 'formatDate(selected)',
          }),
          createTestSymbolReference({
            symbolName: 'formatDate',
            referencingFile: '/src/api/events.ts',
            lineNumber: 8,
            context: 'formatDate(event.date)',
          }),
        ],
      });

      const result = await runFindReferences(mockIndexer as any, {
        symbolName: 'formatDate',
        filePath: 'components',
      });

      expect(result.content[0].text).toContain('DatePicker');
      expect(result.content[0].text).not.toContain('events.ts');
      expect(result.content[0].text).toContain('Found 1 references');
    });
  });

  describe('no references found', () => {
    it('returns helpful message when no references found', async () => {
      const mockIndexer = createMockIndexer({
        symbolReferences: [],
      });

      const result = await runFindReferences(mockIndexer as any, {
        symbolName: 'unusedFunction',
      });

      expect(result.content[0].text).toContain('No references found');
      expect(result.content[0].text).toContain('unusedFunction');
      // Short error message now
      expect(result.content[0].text).toContain('resolve');
    });
  });

  describe('limit parameter', () => {
    it('respects limit parameter', async () => {
      const references = [];
      for (let i = 0; i < 10; i++) {
        references.push(
          createTestSymbolReference({
            symbolName: 'commonHelper',
            referencingFile: `/src/file${i}.ts`,
            lineNumber: i + 1,
            context: `commonHelper()`,
          })
        );
      }

      const mockIndexer = createMockIndexer({ symbolReferences: references });

      const result = await runFindReferences(mockIndexer as any, {
        symbolName: 'commonHelper',
        limit: 3,
      });

      expect(result.content[0].text).toContain('Found 10 references');
      expect(result.content[0].text).toContain('showing first 3');
    });
  });

  describe('grouping by file', () => {
    it('groups references by file with line numbers', async () => {
      const mockIndexer = createMockIndexer({
        symbolReferences: [
          createTestSymbolReference({
            symbolName: 'Logger',
            referencingFile: '/src/services/user.ts',
            lineNumber: 5,
            context: 'new Logger()',
          }),
          createTestSymbolReference({
            symbolName: 'Logger',
            referencingFile: '/src/services/user.ts',
            lineNumber: 20,
            context: 'Logger.info()',
          }),
          createTestSymbolReference({
            symbolName: 'Logger',
            referencingFile: '/src/api/handler.ts',
            lineNumber: 3,
            context: 'import { Logger }',
          }),
        ],
      });

      const result = await runFindReferences(mockIndexer as any, {
        symbolName: 'Logger',
      });

      const text = result.content[0].text;
      expect(text).toContain('/src/services/user.ts');
      expect(text).toContain('Line 5');
      expect(text).toContain('Line 20');
      expect(text).toContain('/src/api/handler.ts');
      expect(text).toContain('Line 3');
    });
  });

  describe('reference kinds', () => {
    it('shows all reference kinds (call, read, write, type, import)', async () => {
      const mockIndexer = createMockIndexer({
        symbolReferences: [
          createTestSymbolReference({
            symbolName: 'config',
            referencingFile: '/src/app.ts',
            lineNumber: 1,
            context: 'import { config }',
            referenceKind: 'import',
          }),
          createTestSymbolReference({
            symbolName: 'config',
            referencingFile: '/src/app.ts',
            lineNumber: 10,
            context: 'const port = config.port',
            referenceKind: 'read',
          }),
          createTestSymbolReference({
            symbolName: 'config',
            referencingFile: '/src/app.ts',
            lineNumber: 15,
            context: 'config.debug = true',
            referenceKind: 'write',
          }),
        ],
      });

      const result = await runFindReferences(mockIndexer as any, {
        symbolName: 'config',
      });

      const text = result.content[0].text;
      expect(text).toContain('Kind: import');
      expect(text).toContain('Kind: read');
      expect(text).toContain('Kind: write');
    });
  });

  describe('referencingSymbolName', () => {
    it('includes referencingSymbolName when available', async () => {
      const mockIndexer = createMockIndexer({
        symbolReferences: [
          createTestSymbolReference({
            symbolName: 'validateEmail',
            referencingFile: '/src/validation.ts',
            lineNumber: 25,
            context: 'validateEmail(email)',
            referenceKind: 'call',
            referencingSymbolName: 'validateUserInput',
          }),
        ],
      });

      const result = await runFindReferences(mockIndexer as any, {
        symbolName: 'validateEmail',
      });

      expect(result.content[0].text).toContain('In: `validateUserInput`');
    });
  });

  describe('output formatting', () => {
    it('includes reference kinds legend when results are few', async () => {
      const mockIndexer = createMockIndexer({
        symbolReferences: [
          createTestSymbolReference({
            symbolName: 'helper',
            referencingFile: '/src/file.ts',
            lineNumber: 1,
          }),
        ],
      });

      const result = await runFindReferences(mockIndexer as any, {
        symbolName: 'helper',
      });

      // Compact legend now: "Kinds: call, read, write, type, import"
      expect(result.content[0].text).toContain('Kinds:');
      expect(result.content[0].text).toContain('call');
      expect(result.content[0].text).toContain('read');
    });

    it('supports compact output format', async () => {
      const mockIndexer = createMockIndexer({
        symbolReferences: [
          createTestSymbolReference({
            symbolName: 'Reply',
            referencingFile: '/src/server.ts',
            lineNumber: 45,
            context: 'const reply = new Reply(res)',
            referenceKind: 'call',
          }),
        ],
      });

      const result = await runFindReferences(mockIndexer as any, {
        symbolName: 'Reply',
        format: 'compact',
      });

      const text = result.content[0].text;
      expect(text).toContain('[REFS "Reply"');
      expect(text).toContain('file\tline\tkind\tcontext');
      expect(text).toContain('/src/server.ts\t45\tcall\tconst reply = new Reply(res)');
    });
  });
});
