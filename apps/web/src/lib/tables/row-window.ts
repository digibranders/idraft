/**
 * Which rows a table renders while it scrolls (12-tables.md section 12). Rows have one fixed height per
 * density, so the window follows from the scroll offset alone, without measuring. Tables up to
 * `WINDOW_FROM` rows render every row.
 */

/** Tables with more rows than this render only the rows in view, plus the overscan. */
export const WINDOW_FROM = 100;
/** Rows rendered beyond each edge of the view. */
export const OVERSCAN = 10;
/**
 * The table keeps its scroll offset rounded down to this many pixels, so a scroll renders again only every
 * 160 px instead of on every event. Half the overscan at the compact height: the rows the rounding leaves
 * out at the bottom are always inside the overscan.
 */
export const SCROLL_STEP = (OVERSCAN / 2) * 32;

/** Rows `start` to `end - 1`. */
export interface RowRange {
  start: number;
  end: number;
}

/**
 * The ranges of rows to render at `scrollTop` in a view `viewport` pixels tall, in order. The focused row
 * (`keep`) is always rendered, as a range of its own when it is out of view, so keyboard focus never lands
 * on a row that is not in the document and the rows between it and the view are not rendered.
 */
export function rowWindow({
  count,
  rowHeight,
  scrollTop,
  viewport,
  keep,
}: {
  count: number;
  rowHeight: number;
  scrollTop: number;
  viewport: number;
  keep: number | null;
}): RowRange[] {
  if (count <= WINDOW_FROM) return [{ start: 0, end: count }];
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const visible = Math.ceil(Math.max(0, viewport) / rowHeight) + 1;
  const start = Math.min(Math.max(0, first - OVERSCAN), count);
  const end = Math.min(count, first + visible + OVERSCAN);
  const view: RowRange = { start, end };
  if (keep === null || keep < 0 || keep >= count || (keep >= start && keep < end)) return [view];
  const kept: RowRange = { start: keep, end: keep + 1 };
  // A kept row next to the view joins it, so no zero-height spacer sits between them
  if (keep === end) return [{ start, end: end + 1 }];
  if (keep === start - 1) return [{ start: keep, end }];
  return keep < start ? [kept, view] : [view, kept];
}

/** The space, in pixels, before each range and after the last, so the scroll height matches every row. */
export function rangeGaps(ranges: readonly RowRange[], count: number, rowHeight: number): number[] {
  const gaps: number[] = [];
  let previous = 0;
  for (const range of ranges) {
    gaps.push((range.start - previous) * rowHeight);
    previous = range.end;
  }
  gaps.push((count - previous) * rowHeight);
  return gaps;
}

/** The scroll offset that brings `row` into a view `viewport` pixels tall, or `null` when it is in view. */
export function scrollToRow({
  row,
  rowHeight,
  scrollTop,
  viewport,
  header,
}: {
  row: number;
  rowHeight: number;
  scrollTop: number;
  viewport: number;
  /** The sticky header's height, which covers the top of the view. */
  header: number;
}): number | null {
  const top = row * rowHeight;
  const bottom = top + rowHeight;
  if (top < scrollTop) return top;
  if (bottom > scrollTop + viewport - header) return bottom - viewport + header;
  return null;
}
