/** A cell of a table written to a file: text, a number, or nothing. */
export type CsvCell = string | number | null;

/** A table as it is written: the header line, then one line for each row. */
export interface CsvTable {
  header: readonly string[];
  rows: readonly (readonly CsvCell[])[];
}

export const CSV_TYPE = 'text/csv;charset=utf-8';

/** A cell that a spreadsheet would read as a formula is written as text (CSV injection). */
export function safeText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** The byte order mark that tells Excel a CSV is UTF-8. */
const BOM = String.fromCharCode(0xfeff);

/** The text of one CSV field (RFC 4180): quoted when it holds a comma, a quote or a line break. */
function field(cell: CsvCell): string {
  if (cell === null) return '';
  const text = String(cell);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Rows as CSV text, each line ended by CRLF as RFC 4180 has it: the one writer of lines (`csv.ts` uses it too). */
export const csvLines = (rows: readonly (readonly CsvCell[])[]): string =>
  rows.map((row) => row.map(field).join(',')).join('\r\n') + '\r\n';

/** The table as CSV with a byte order mark, so Excel reads it as UTF-8. */
export const toCsv = (table: CsvTable): string => `${BOM}${csvLines([table.header, ...table.rows])}`;

export const csvBlob = (table: CsvTable): Blob => new Blob([toCsv(table)], { type: CSV_TYPE });

/** Hands a file to the browser as a download. */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // The browser has been handed the file by the time the click returns; the address is released after
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
