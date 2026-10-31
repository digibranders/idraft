/**
 * The column types of 12-tables.md section 5: width, alignment and sort fixed per type, so screens never
 * set them by hand. Widths are pixels; a screen may pick its own default between a type's minimum and
 * maximum (24-page-templates.md section 9).
 */

export type ColumnType =
  | 'select'
  | 'keyword'
  | 'text'
  | 'count'
  | 'volume'
  | 'currency'
  | 'date'
  | 'badge'
  | 'status'
  | 'rank'
  | 'rankDelta'
  | 'url'
  | 'features'
  | 'aiOverview'
  | 'sparkline'
  | 'competitor'
  | 'actions';

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
  // Minimums are what the sorted header needs in capitals (type-table-header, 0.04em) with its 14 px arrow, 4 px gap
  // and 12 px padding each side, measured in Chrome on 2026-10-29 (e2e/flows/table-style.spec.ts): "KD" 60,
  // "Volume" 95, "CPC (USD)" 106, "Rank" 78, "Change" 95, "Updated" 99. A longer label ("Priority" 100, "Estimate
  // (USD)" 139, "Best rank" 112) sets its own width, and its own `minWidth` where it must not be squeezed
  count: { width: 88, min: 72, max: 120, align: 'left', defaultDesc: true, flex: false },
  volume: { width: 96, min: 96, max: 120, align: 'left', defaultDesc: true, flex: false },
  currency: { width: 128, min: 112, max: 144, align: 'left', defaultDesc: true, flex: false },
  date: { width: 120, min: 104, max: 160, align: 'left', defaultDesc: true, flex: false },
  badge: { width: 120, min: 88, max: 180, align: 'left', defaultDesc: false, flex: false },
  status: { width: 120, min: 96, max: 180, align: 'left', defaultDesc: false, flex: false },
  // Best (lowest) rank first, and the biggest improvement first (12-tables.md section 5)
  rank: { width: 80, min: 80, max: 112, align: 'left', defaultDesc: false, flex: false },
  // 12-tables.md gave 56 / 48 / 72. The header "CHANGE" with its sort arrow needs 95 px (84 in sentence case), and
  // the width resolver shrinks a column toward its minimum when the table is tight, so the minimum is 96
  rankDelta: { width: 96, min: 96, max: 96, align: 'left', defaultDesc: true, flex: false },
  // The identity place stays with the keyword column: a ranking URL is a plain column here
  // 160 px holds the 127 px capital header "RANKING URL" with its arrow; the path shows middle-truncated
  url: { width: 260, min: 160, max: 480, align: 'left', defaultDesc: false, flex: false },
  features: { width: 140, min: 112, max: 220, align: 'left', defaultDesc: true, flex: false },
  aiOverview: { width: 112, min: 96, max: 140, align: 'left', defaultDesc: false, flex: false },
  sparkline: { width: 88, min: 88, max: 120, align: 'left', defaultDesc: null, flex: false },
  competitor: { width: 160, min: 120, max: 240, align: 'left', defaultDesc: false, flex: false },
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
