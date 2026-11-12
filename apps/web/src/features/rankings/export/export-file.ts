import type { CellObject, SheetData } from 'write-excel-file/universal';

import type { WorkbookColors } from './export-colors';
import type { ExportCell, ExportColumnKind, KeywordExport } from './export-model';
import { csvBlob } from '@/lib/csv/csv-write';

/** The file types of the Export menu. */
export type ExportFormat = 'xlsx' | 'csv';

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** A line of facts above the table: what was exported, and how. */
export type ContextLine = readonly [label: string, value: string];

/** Row heights in points. The rows above the table are frozen with it, so they stay compact. */
const HEIGHT = { title: 30, context: 18, gap: 6, kpiLabel: 15, kpiValue: 28, gapBeforeTable: 8, header: 26, row: 20 };

const KPI_COUNT = 4;
const FONT = 'Calibri';
const BODY_SIZE = 11;

/** A color as a cell style; no style where the color could not be read, so the sheet keeps its default. */
const textOf = (color: string): Partial<CellObject> => (color === '' ? {} : { textColor: color });
const fillOf = (color: string): Partial<CellObject> => (color === '' ? {} : { backgroundColor: color });

/** Ranks in the top 3, the top 10 and the top 20 get a color; beyond that a rank is plain. */
function rankStyle(value: ExportCell, colors: WorkbookColors): Partial<CellObject> {
  if (typeof value !== 'number') return textOf(colors.muted);
  if (value <= 3) return { ...textOf(colors.positive), ...fillOf(colors.positiveSubtle), fontWeight: 'bold' };
  if (value <= 10) return { ...textOf(colors.brand), ...fillOf(colors.brandSubtle), fontWeight: 'bold' };
  if (value <= 20) return { ...textOf(colors.warning), ...fillOf(colors.warningSubtle) };
  return {};
}

const CENTERED: ReadonlySet<ExportColumnKind> = new Set(['rank', 'difficulty', 'priority']);
const RIGHT: ReadonlySet<ExportColumnKind> = new Set(['volume', 'clicks', 'impressions', 'cpc']);
const NUMBER_FORMAT: Partial<Record<ExportColumnKind, string>> = {
  volume: '#,##0',
  clicks: '#,##0',
  impressions: '#,##0',
  difficulty: '0',
  cpc: '[$$-409]#,##0.00',
  priority: '0',
};
/** Columns with a width of their own; the others are sized from what they hold. */
const FIXED_WIDTH: Partial<Record<ExportColumnKind, number>> = {
  rank: 12,
  volume: 15,
  clicks: 20,
  impressions: 24,
  difficulty: 9,
  cpc: 12,
  intent: 16,
  priority: 10,
  checked: 22,
};
const DATA_WIDTH: Partial<Record<ExportColumnKind, readonly [min: number, max: number]>> = {
  keyword: [26, 46],
  url: [30, 46],
  groups: [18, 30],
};

function alignOf(kind: ExportColumnKind): 'left' | 'center' | 'right' {
  if (CENTERED.has(kind)) return 'center';
  return RIGHT.has(kind) ? 'right' : 'left';
}

/** Text that starts at the left edge of its cell is set in by one step, so it does not touch a figure beside it. */
const indentOf = (kind: ExportColumnKind): number => (alignOf(kind) === 'left' ? 1 : 0);

function widthOf(column: number, table: KeywordExport): number {
  const kind = table.kinds[column] ?? 'keyword';
  const header = String(table.header[column] ?? '').length + 3;
  const fixed = FIXED_WIDTH[kind];
  if (fixed !== undefined) return Math.max(fixed, header);
  const [min, max] = DATA_WIDTH[kind] ?? [10, 30];
  const longest = Math.max(header, ...table.rows.map((row) => String(row[column] ?? '').length + 2));
  return Math.min(max, Math.max(min, longest));
}

/** A cell that covers `span` columns: the cell, then the cells it covers, which a workbook leaves empty. */
const spanned = (cell: CellObject, span: number): (CellObject | null)[] => [
  { ...cell, columnSpan: span },
  ...Array.from({ length: Math.max(0, span - 1) }, () => null),
];

/**
 * How many columns each tile covers, so the tiles are about as wide as one another: a tile takes columns
 * until it reaches its share of the table's width, and leaves at least one column for each tile after it.
 */
export function tileSpans(widths: readonly number[], tiles: number = KPI_COUNT): number[] {
  const share = widths.reduce((sum, width) => sum + width, 0) / tiles;
  const spans: number[] = [];
  let next = 0;
  for (let tile = 0; tile < tiles; tile += 1) {
    const last = tile === tiles - 1;
    const room = widths.length - next - (tiles - 1 - tile);
    let span = 1;
    let covered = widths[next] ?? 0;
    while (!last && span < room && covered + (widths[next + span] ?? 0) / 2 < share) {
      covered += widths[next + span] ?? 0;
      span += 1;
    }
    spans.push(last ? Math.max(1, widths.length - next) : span);
    next += spans[tile] ?? 1;
  }
  return spans;
}

function tileRow(
  table: KeywordExport,
  spans: readonly number[],
  colors: WorkbookColors,
  cellOf: (kpi: KeywordExport['kpis'][number]) => CellObject,
): (CellObject | null)[] {
  return table.kpis.slice(0, KPI_COUNT).flatMap((kpi, index) => {
    const cell: CellObject = {
      ...cellOf(kpi),
      ...fillOf(colors.brandSubtle),
      ...(index === 0 || colors.surface === ''
        ? {}
        : { leftBorderStyle: 'thick' as const, leftBorderColor: colors.surface }),
    };
    return spanned(cell, spans[index] ?? 1);
  });
}

/**
 * The workbook, on one sheet so the counts stay above the table they sum up: the title and what was exported,
 * the four counts as tiles, then the table under a frozen header. Ranks in the top 3, 10 and 20 are colored,
 * figures carry their number format, and the keyword column is frozen. The writer loads on first use.
 */
export async function buildWorkbook(
  title: string,
  context: readonly ContextLine[],
  table: KeywordExport,
  colors: WorkbookColors,
): Promise<Blob> {
  const { default: writeExcelFile } = await import('write-excel-file/universal');
  const columns = table.header.length;
  const widths = table.header.map((_, index) => widthOf(index, table));
  const spans = tileSpans(widths);
  const plain: CellObject = { fontFamily: FONT, alignVertical: 'center' };

  const gap = (height: number): CellObject[] => [{ ...plain, height }];
  const titleRow = spanned(
    {
      ...plain,
      ...textOf(colors.ink),
      value: title,
      type: String,
      fontSize: 18,
      fontWeight: 'bold',
      height: HEIGHT.title,
    },
    columns,
  );
  const contextRow = spanned(
    {
      ...plain,
      ...textOf(colors.muted),
      value: context.map(([label, value]) => `${label}: ${value}`).join('     |     '),
      type: String,
      fontSize: 10,
      height: HEIGHT.context,
    },
    columns,
  );
  const kpiLabels = tileRow(table, spans, colors, (kpi) => ({
    ...plain,
    ...textOf(colors.muted),
    value: kpi.label,
    type: String,
    fontSize: 10,
    indent: 1,
    height: HEIGHT.kpiLabel,
  }));
  const kpiValues = tileRow(table, spans, colors, (kpi) => ({
    ...plain,
    ...textOf(colors.brand),
    value: kpi.value,
    type: Number,
    format: '#,##0',
    align: 'left',
    fontSize: 20,
    fontWeight: 'bold',
    indent: 1,
    height: HEIGHT.kpiValue,
  }));
  const headerRow = table.header.map((label, index): CellObject => ({
    ...plain,
    ...textOf(colors.onInk),
    ...fillOf(colors.ink),
    value: label,
    type: String,
    fontSize: 10.5,
    fontWeight: 'bold',
    align: alignOf(table.kinds[index] ?? 'keyword'),
    indent: indentOf(table.kinds[index] ?? 'keyword'),
    height: HEIGHT.header,
  }));
  const lastRow = table.rows.length - 1;
  const bodyRows = table.rows.map((row, rowIndex) =>
    row.map((value, index): CellObject => {
      const kind = table.kinds[index] ?? 'keyword';
      const style: CellObject = {
        ...plain,
        ...textOf(colors.ink),
        fontSize: BODY_SIZE,
        align: alignOf(kind),
        indent: indentOf(kind),
        height: HEIGHT.row,
        ...(rowIndex % 2 === 1 ? fillOf(colors.stripe) : {}),
        ...(rowIndex === lastRow && colors.line !== ''
          ? { bottomBorderStyle: 'thin' as const, bottomBorderColor: colors.line }
          : {}),
      };
      if (kind === 'keyword') style.fontWeight = 'bold';
      if (kind === 'url') Object.assign(style, textOf(colors.brand), { fontSize: 10 });
      if (kind === 'checked') Object.assign(style, textOf(colors.muted), { fontSize: 10 });
      if (kind === 'rank') Object.assign(style, rankStyle(value, colors));
      // An empty cell keeps its fill but takes no number format: the writer refuses a format on a cell without a type
      if (value === null) return style;
      const format = NUMBER_FORMAT[kind];
      if (format !== undefined) style.format = format;
      return typeof value === 'number' ? { ...style, value, type: Number } : { ...style, value, type: String };
    }),
  );

  const data: SheetData = [
    titleRow,
    contextRow,
    gap(HEIGHT.gap),
    kpiLabels,
    kpiValues,
    gap(HEIGHT.gapBeforeTable),
    headerRow,
    ...bodyRows,
  ];
  return writeExcelFile(
    data,
    {
      columns: widths.map((width) => ({ width })),
      sheet: title,
      showGridLines: false,
      orientation: 'landscape',
      stickyRowsCount: data.length - bodyRows.length,
      stickyColumnsCount: 1,
    },
    { fontFamily: FONT, fontSize: BODY_SIZE },
  ).toBlob();
}

/** The table alone: the counts above it would break it for most tools, so they are left to the workbook. */
export const buildCsv = (table: KeywordExport): Blob => csvBlob(table);

/** The name of a file: what it holds and the day, in UTC. */
export function fileName(format: ExportFormat, now: Date): string {
  return `keywords-${now.toISOString().slice(0, 10)}.${format}`;
}
