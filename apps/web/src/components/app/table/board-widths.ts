/**
 * The width rules of a resizable BoardTable (docs/33 section 7.2, 12-tables sections 9 and 10): each column has a
 * default, a least and a widest width, the arrow keys move an edge by 16 px (48 with Shift), Home and End go to the
 * least and the widest, Enter goes back to the default.
 */

export interface WidthLimits {
  least: number;
  default: number;
  widest: number;
}

export const WIDTH_STEP = 16;
export const WIDTH_STEP_LARGE = 48;
const LEAST_FLOOR = 56;
const WIDEST_FLOOR = 360;
const WIDEST_CEILING = 560;

/** A column's limits: its own `least` and `widest` when it has them, else 60 percent and double (360 to 560 px). */
export function limitsOf(width: number, least?: number, widest?: number): WidthLimits {
  return {
    least: least ?? Math.min(width, Math.max(LEAST_FLOOR, Math.round(width * 0.6))),
    default: width,
    widest: widest ?? Math.max(width, Math.min(Math.max(width * 2, WIDEST_FLOOR), WIDEST_CEILING)),
  };
}

export const clampWidth = (width: number, limits: WidthLimits): number =>
  Math.min(Math.max(Math.round(width), limits.least), limits.widest);

/** The width a key asks for, or `null` for a key that does not resize. */
export function widthForKey(key: string, shift: boolean, current: number, limits: WidthLimits): number | null {
  const step = shift ? WIDTH_STEP_LARGE : WIDTH_STEP;
  switch (key) {
    case 'ArrowLeft':
      return clampWidth(current - step, limits);
    case 'ArrowRight':
      return clampWidth(current + step, limits);
    case 'Home':
      return limits.least;
    case 'End':
      return limits.widest;
    case 'Enter':
      return limits.default;
    default:
      return null;
  }
}

export type ColumnWidths = Readonly<Record<string, number>>;

/** The saved widths of a table as stored text: only finite numbers survive, anything else is dropped. */
export function parseWidths(text: string | null): Record<string, number> {
  if (text === null) return {};
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, number] => Number.isFinite(entry[1])),
    );
  } catch {
    return {};
  }
}

/** The width a column has now: its saved width within its limits, else its default; `null` for the flexible column. */
export function widthOfColumn(
  column: { id: string; width: number | null; least?: number | undefined; widest?: number | undefined },
  widths: ColumnWidths,
): number | null {
  if (column.width === null) return null;
  const saved = widths[column.id];
  return saved === undefined ? column.width : clampWidth(saved, limitsOf(column.width, column.least, column.widest));
}

/** Whether any column has a width other than its default. */
export const widthsDiffer = (
  columns: readonly { id: string; width: number | null; least?: number | undefined; widest?: number | undefined }[],
  widths: ColumnWidths,
): boolean => columns.some((column) => column.width !== null && widthOfColumn(column, widths) !== column.width);
