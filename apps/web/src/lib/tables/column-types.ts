/**
 * The column types of 12-tables.md section 5: width, alignment and sort fixed per type, so screens never
 * set them by hand. Widths are pixels; a screen may pick its own default between a type's minimum and
 * maximum (24-page-templates.md section 9).
 */

export type ColumnType =
  'select' | 'keyword' | 'text' | 'count' | 'volume' | 'currency' | 'date' | 'badge' | 'status' | 'actions';

export interface ColumnTypeSpec {
  width: number;
  min: number;
  max: number;
  align: 'left' | 'right' | 'center';
  /** The direction of a first click on the header; `null` when the type does not sort. */
  defaultDesc: boolean | null;
  /** The identity column takes the width the others leave, between its minimum and maximum. */
  flex: boolean;
}

export const COLUMN_TYPES: Readonly<Record<ColumnType, ColumnTypeSpec>> = {
  select: { width: 40, min: 40, max: 40, align: 'center', defaultDesc: null, flex: false },
  keyword: { width: 280, min: 200, max: 480, align: 'left', defaultDesc: false, flex: true },
  // Short text such as a group path or tags; not in section 5's list, sized like a badge
  text: { width: 160, min: 104, max: 240, align: 'left', defaultDesc: false, flex: false },
  count: { width: 88, min: 72, max: 120, align: 'right', defaultDesc: true, flex: false },
  volume: { width: 88, min: 72, max: 120, align: 'right', defaultDesc: true, flex: false },
  currency: { width: 96, min: 80, max: 128, align: 'right', defaultDesc: true, flex: false },
  date: { width: 120, min: 104, max: 160, align: 'right', defaultDesc: true, flex: false },
  badge: { width: 120, min: 88, max: 180, align: 'left', defaultDesc: false, flex: false },
  status: { width: 120, min: 96, max: 180, align: 'left', defaultDesc: false, flex: false },
  actions: { width: 40, min: 40, max: 40, align: 'right', defaultDesc: null, flex: false },
};

/** A column as the width resolver sees it. */
export interface SizedColumn {
  id: string;
  width: number;
  min: number;
  max: number;
  flex: boolean;
}

/**
 * The widths of the visible columns in a region `available` pixels wide (24-page-templates.md section 9.3,
 * "Width resolution"): the flex column takes what the others leave, at least its minimum, so the table
 * always fills its panel (past its usual maximum when few columns are shown, rather than leaving an empty
 * strip beside the table); when the set does not fit, the flex column shrinks to its minimum, then the
 * others shrink toward theirs in proportion; what still does not fit scrolls sideways (the sum then
 * exceeds `available`).
 */
export function resolveWidths(columns: readonly SizedColumn[], available: number): Map<string, number> {
  const widths = new Map(columns.map((column) => [column.id, column.width]));
  const flex = columns.find((column) => column.flex);
  const fixedTotal = columns.reduce((sum, column) => sum + (column.flex ? 0 : column.width), 0);
  if (flex !== undefined) {
    widths.set(flex.id, Math.max(flex.min, available - fixedTotal));
  }
  const total = (): number => [...widths.values()].reduce((sum, width) => sum + width, 0);
  const excess = total() - available;
  if (excess <= 0) return widths;
  // Shrink the others toward their minimums, each by its share of the room it has
  const shrinkable = columns.filter((column) => !column.flex && column.width > column.min);
  const room = shrinkable.reduce((sum, column) => sum + (column.width - column.min), 0);
  if (room === 0) return widths;
  const ratio = Math.min(1, excess / room);
  for (const column of shrinkable) {
    widths.set(column.id, Math.round(column.width - (column.width - column.min) * ratio));
  }
  return widths;
}
