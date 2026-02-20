import { describe, expect, it } from 'vitest';
import {
  formatCompactTable,
  formatCompactSource,
  enforceOutputBudget,
} from '../../../src/server/tools/compact-format.js';

describe('compact-format helpers', () => {
  it('renders records as TSV with header row', () => {
    const output = formatCompactTable([
      { name: 'alpha', kind: 'function' },
      { name: 'beta', kind: 'class' },
    ]);

    expect(output).toBe('name\tkind\nalpha\tfunction\nbeta\tclass');
  });

  it('sanitizes tabs, newlines, and nullish values', () => {
    const output = formatCompactTable([
      {
        col1: 'a\tb',
        col2: 'line1\nline2',
        col3: null,
        col4: undefined,
      },
    ]);

    expect(output).toContain('a    b');
    expect(output).toContain('line1\\nline2');
    expect(output).toContain('col1\tcol2\tcol3\tcol4');
    expect(output.endsWith('\t')).toBe(true);
  });

  it('respects explicit column ordering', () => {
    const output = formatCompactTable(
      [{ b: '2', a: '1' }],
      { columns: ['a', 'b'] }
    );

    expect(output).toBe('a\tb\n1\t2');
  });

  it('supports maxBytes budget enforcement in table output', () => {
    const output = formatCompactTable(
      [{ name: 'x'.repeat(200) }],
      { maxBytes: 40 }
    );

    expect(Buffer.byteLength(output, 'utf8')).toBeLessThanOrEqual(40);
    expect(output).toContain('[truncated]');
  });

  it('renders source sections with delimiters', () => {
    const output = formatCompactSource('src/file.ts:1-2 typescript', 'const x = 1;');

    expect(output).toContain('===SOURCE===');
    expect(output).toContain('===END===');
    expect(output).toContain('const x = 1;');
  });

  it('enforces byte budget deterministically', () => {
    const first = enforceOutputBudget('x'.repeat(100), 25);
    const second = enforceOutputBudget('x'.repeat(100), 25);

    expect(first).toBe(second);
    expect(Buffer.byteLength(first, 'utf8')).toBeLessThanOrEqual(25);
  });
});
