/**
 * Shared compact serialization helpers for MCP tool responses.
 */

export type CompactField = string | number | boolean | null | undefined;
export type CompactRecord = Record<string, CompactField>;

function sanitizeCompactValue(value: CompactField): string {
  if (value == null) return '';
  return String(value)
    .replaceAll('\t', '    ')
    .replaceAll('\r\n', '\\n')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\n');
}

/**
 * Render records as TSV: header row + one row per record.
 */
export function formatCompactTable(
  records: CompactRecord[],
  opts?: { maxBytes?: number; columns?: string[] }
): string {
  const columns = opts?.columns?.length
    ? opts.columns
    : Array.from(
        records.reduce((keys, record) => {
          for (const key of Object.keys(record)) {
            keys.add(key);
          }
          return keys;
        }, new Set<string>())
      );

  if (columns.length === 0) {
    return '';
  }

  const header = columns.join('\t');
  const rows = records.map((record) =>
    columns.map((column) => sanitizeCompactValue(record[column])).join('\t')
  );
  const output = [header, ...rows].join('\n');

  if (opts?.maxBytes != null) {
    return enforceOutputBudget(output, opts.maxBytes);
  }

  return output;
}

/**
 * Render source code with explicit delimiters instead of markdown fences.
 * Line numbers are prepended to each line when a start line can be parsed
 * from the label (format: "file:startLine-endLine lang").
 */
export function formatCompactSource(label: string, code: string): string {
  const startLine = parseStartLine(label);
  const numberedCode = startLine != null
    ? addLineNumbers(code, startLine)
    : code;
  return `===SOURCE=== ${sanitizeCompactValue(label)}\n${numberedCode}\n===END===`;
}

function parseStartLine(label: string): number | null {
  // Match patterns like "file.ts:42-100 typescript" or "file.ts:42-100"
  const match = label.match(/:(\d+)-\d+/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function addLineNumbers(code: string, startLine: number): string {
  const lines = code.split('\n');
  const maxLineNum = startLine + lines.length - 1;
  const pad = String(maxLineNum).length;
  return lines
    .map((line, i) => `${String(startLine + i).padStart(pad)}| ${line}`)
    .join('\n');
}

/**
 * Enforce a UTF-8 byte budget with deterministic truncation marker.
 */
export function enforceOutputBudget(output: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';

  const marker = '\n...[truncated]';
  if (Buffer.byteLength(output, 'utf8') <= maxBytes) {
    return output;
  }

  if (Buffer.byteLength(marker, 'utf8') >= maxBytes) {
    return marker.slice(0, maxBytes);
  }

  const allowedBytes = maxBytes - Buffer.byteLength(marker, 'utf8');
  const buffer = Buffer.from(output, 'utf8');
  let truncated = buffer.toString('utf8', 0, allowedBytes);

  while (Buffer.byteLength(truncated, 'utf8') > allowedBytes) {
    truncated = truncated.slice(0, -1);
  }

  return `${truncated}${marker}`;
}
