import type { CellObject, SheetData } from 'write-excel-file/universal';

import type { DateRange } from '../prompt-model';
import { safeText, type CsvCell, type CsvTable } from '@/lib/csv/csv-write';

export const XLSX_FILE_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The width of the prompt and topic columns; the figures after them share one. */
const WIDE_COLUMNS = [64, 28];
const FIGURE_WIDTH = 18;

/**
 * One cell: a number stays a number, text is typed as text and written so a spreadsheet does not read it as a
 * formula (the same apostrophe the CSV gets; text the export already wrote that way is not changed), and a figure
 * that is unknown is no cell, never 0.
 */
function cellOf(value: CsvCell): CellObject | null {
  if (value === null) return null;
  return typeof value === 'number' ? { value, type: Number } : { value: safeText(value), type: String };
}

/** The table as sheet data: the header row in bold text, then one row for each prompt. */
export function buildPromptSheet(table: CsvTable): SheetData {
  const header = table.header.map((value): CellObject => ({ value, type: String, fontWeight: 'bold' }));
  return [header, ...table.rows.map((row) => row.map(cellOf))];
}

/** The workbook of one sheet under a frozen header row. The writer loads on first use. */
export async function buildPromptWorkbook(table: CsvTable, sheetName: string): Promise<Blob> {
  const { default: writeExcelFile } = await import('write-excel-file/universal');
  return writeExcelFile(buildPromptSheet(table), {
    sheet: sheetName,
    stickyRowsCount: 1,
    columns: table.header.map((_, index) => ({ width: WIDE_COLUMNS[index] ?? FIGURE_WIDTH })),
  }).toBlob();
}

/** The name of a file: what it holds and the window its counts are of. */
export const workbookFileName = (range: DateRange): string => `prompts-${range.from}-to-${range.to}.xlsx`;
