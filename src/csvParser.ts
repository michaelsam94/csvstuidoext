export type DelimiterSetting = 'auto' | ',' | ';' | '\t' | '|' | '\\t';

export interface ParseOptions {
  delimiter?: DelimiterSetting;
  hasHeader?: boolean;
  fileName?: string;
}

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  delimiter: string;
  hasHeader: boolean;
}

export interface ParseWarning {
  line: number;
  message: string;
}

export interface ParseResult {
  data: ParsedCsv;
  warnings: ParseWarning[];
}

const DELIMITER_CANDIDATES = [',', ';', '\t', '|'] as const;

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function detectDelimiter(text: string, fileName?: string): string {
  const ext = fileName?.toLowerCase() ?? '';
  if (ext.endsWith('.tsv')) {
    return '\t';
  }

  const sample = text.slice(0, 8192);
  const firstLine = sample.split(/\r?\n/)[0] ?? '';
  let best = ',';
  let bestCount = -1;
  for (const d of DELIMITER_CANDIDATES) {
    const count = countDelimiterOutsideQuotes(firstLine, d);
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

function countDelimiterOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes && ch === delimiter) {
      count++;
    }
  }
  return count;
}

export function resolveDelimiter(setting: DelimiterSetting, text: string, fileName?: string): string {
  if (setting === 'auto') {
    return detectDelimiter(text, fileName);
  }
  if (setting === '\\t' || setting === '\t') {
    return '\t';
  }
  return setting as string;
}

/** Parse CSV/TSV text into headers and rows. */
export function parseCsv(text: string, options: ParseOptions = {}): ParseResult {
  const warnings: ParseWarning[] = [];
  const hasHeader = options.hasHeader ?? true;
  const normalized = stripBom(text.replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
  const delimiter = resolveDelimiter(options.delimiter ?? 'auto', normalized, options.fileName);

  if (normalized.trim() === '') {
    return {
      data: {
        headers: ['Column 1'],
        rows: [['']],
        delimiter,
        hasHeader: true,
      },
      warnings,
    };
  }

  const { records, errors } = parseRecords(normalized, delimiter);
  for (const err of errors) {
    warnings.push(err);
  }

  if (records.length === 0) {
    return {
      data: {
        headers: ['Column 1'],
        rows: [['']],
        delimiter,
        hasHeader: true,
      },
      warnings,
    };
  }

  const colCount = records.reduce((max, row) => Math.max(max, row.length), 0);
  const padRow = (row: string[]): string[] => {
    const out = [...row];
    while (out.length < colCount) {
      out.push('');
    }
    return out;
  };

  const padded = records.map(padRow);

  if (hasHeader) {
    const headers = padded[0] ?? [];
    const rows = padded.slice(1);
    return {
      data: {
        headers: headers.length ? headers : ['Column 1'],
        rows: rows.length ? rows : [headers.map(() => '')],
        delimiter,
        hasHeader: true,
      },
      warnings,
    };
  }

  const headers = Array.from({ length: colCount }, (_, i) => `Column ${i + 1}`);
  return {
    data: {
      headers,
      rows: padded,
      delimiter,
      hasHeader: false,
    },
    warnings,
  };
}

interface RecordParseResult {
  records: string[][];
  errors: ParseWarning[];
}

function parseRecords(text: string, delimiter: string): RecordParseResult {
  const records: string[][] = [];
  const errors: ParseWarning[] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let i = 0;

  const pushField = (): void => {
    row.push(field);
    field = '';
  };

  const pushRow = (): void => {
    records.push(row);
    row = [];
    line++;
  };

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }

    if (ch === delimiter) {
      pushField();
      i++;
      continue;
    }

    if (ch === '\n') {
      pushField();
      pushRow();
      i++;
      continue;
    }

    field += ch;
    i++;
  }

  if (field.length > 0 || row.length > 0 || text.endsWith('\n')) {
    pushField();
    pushRow();
  }

  if (inQuotes) {
    errors.push({ line, message: 'Unclosed quoted field at end of file' });
  }

  // Trim trailing empty row from final newline
  if (
    records.length > 1 &&
    records[records.length - 1].length === 1 &&
    records[records.length - 1][0] === '' &&
    text.endsWith('\n')
  ) {
    const last = records[records.length - 1];
    const allEmpty = last.every((c) => c === '');
    if (allEmpty) {
      records.pop();
    }
  }

  return { records, errors };
}

export interface SerializeOptions {
  delimiter: string;
  hasHeader: boolean;
}

export function serializeCsv(headers: string[], rows: string[][], options: SerializeOptions): string {
  const { delimiter, hasHeader } = options;
  const lines: string[] = [];
  if (hasHeader) {
    lines.push(serializeRow(headers, delimiter));
  }
  for (const row of rows) {
    lines.push(serializeRow(row, delimiter));
  }
  return lines.join('\n') + (lines.length ? '\n' : '');
}

function serializeRow(cells: string[], delimiter: string): string {
  return cells.map((cell) => serializeField(cell, delimiter)).join(delimiter);
}

function serializeField(value: string, delimiter: string): string {
  const needsQuote =
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r');
  if (!needsQuote) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}

export function gridToObjects(headers: string[], rows: string[][]): Record<string, string>[] {
  return rows.map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h || `Column ${i + 1}`] = row[i] ?? '';
    });
    return obj;
  });
}

export function delimiterLabel(delimiter: string): string {
  switch (delimiter) {
    case '\t':
      return 'tab';
    case ',':
      return 'comma';
    case ';':
      return 'semicolon';
    case '|':
      return 'pipe';
    default:
      return delimiter;
  }
}
