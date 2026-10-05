/**
 * CSV as the import reads and the report writes it (RFC 4180): fields separated by commas, a field in double
 * quotes may hold commas, quotes (doubled) and line breaks, lines end in LF, CRLF or a lone CR, and a byte
 * order mark at the start is dropped. Blank lines are skipped.
 */

export function parseCsv(text: string): string[][] {
  const input = text.startsWith('﻿') ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const endRow = (): void => {
    row.push(field);
    if (!(row.length === 1 && row[0]?.trim() === '')) rows.push(row);
    row = [];
    field = '';
  };
  for (let index = 0; index < input.length; index += 1) {
    const char = input.charAt(index);
    if (quoted) {
      if (char !== '"') field += char;
      else if (input.charAt(index + 1) === '"') {
        field += '"';
        index += 1;
      } else quoted = false;
    } else if (char === '"' && field === '') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') endRow();
    else if (char === '\r') {
      // CRLF ends the line at its LF; a CR on its own is a line break of its own (an old Mac export)
      if (input.charAt(index + 1) !== '\n') endRow();
    } else field += char;
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

const quote = (value: string): string => (/[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);

/** Rows as CSV text, each line ended by CRLF as RFC 4180 has it. */
export const toCsv = (rows: readonly (readonly string[])[]): string =>
  rows.map((row) => row.map(quote).join(',')).join('\r\n') + '\r\n';
