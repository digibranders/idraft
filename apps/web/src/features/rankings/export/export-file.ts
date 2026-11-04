import type { ExportCell, KeywordExport } from './export-model';
import { toCsv } from './export-model';

/** The file types of the Export menu. */
export type ExportFormat = 'xlsx' | 'csv';

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const CSV_TYPE = 'text/csv;charset=utf-8';

/** A line of facts above the table: what was exported, and how. */
export type ContextLine = readonly [label: string, value: string];

const WIDTH_MIN = 8;
const WIDTH_MAX = 50;

function widthOf(column: number, table: KeywordExport): number {
  const longest = Math.max(
    String(table.header[column] ?? '').length,
    ...table.rows.map((row) => String(row[column] ?? '').length),
  );
  return Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, longest + 2));
}

/**
 * The workbook: the title and what was exported, the counts of the strip, then the table under its header.
 * Everything sits on one sheet, so the counts stay above the table they sum up. The writer loads on first use.
 */
export async function buildWorkbook(
  title: string,
  context: readonly ContextLine[],
  table: KeywordExport,
): Promise<Blob> {
  const { default: writeExcelFile } = await import('write-excel-file/universal');
  const bold = { fontWeight: 'bold' as const };
  const text = (value: string, style: object = {}): { value: string; type: StringConstructor } => ({
    value,
    type: String,
    ...style,
  });
  const cell = (value: ExportCell, style: object = {}): object | null => {
    if (value === null) return null;
    return typeof value === 'number' ? { value, type: Number, ...style } : { value, type: String, ...style };
  };
  const data = [
    [text(title, { fontWeight: 'bold', fontSize: 14 })],
    ...context.map(([label, value]) => [text(label, bold), text(value)]),
    [],
    ...table.kpis.map((kpi) => [text(kpi.label, bold), { value: kpi.value, type: Number, align: 'left' as const }]),
    [],
    table.header.map((label) => text(label, { ...bold, bottomBorderStyle: 'thin' })),
    ...table.rows.map((row) => row.map((value) => cell(value))),
  ];
  const columns = table.header.map((_, index) => ({ width: widthOf(index, table) }));
  return writeExcelFile(data as never, { columns, sheet: title }).toBlob();
}

export const buildCsv = (table: KeywordExport): Blob => new Blob([toCsv(table)], { type: CSV_TYPE });

/** The name of a file: what it holds and the day, in UTC. */
export function fileName(format: ExportFormat, now: Date): string {
  return `keywords-${now.toISOString().slice(0, 10)}.${format}`;
}

/** Hands a file to the browser as a download. */
export function download(blob: Blob, name: string): void {
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
