/**
 * Which rows a table renders while it scrolls (12-tables.md section 12). Rows have one fixed height per
 * density, so the window follows from the scroll offset alone, without measuring. Tables up to
 * `WINDOW_FROM` rows render every row.
 */

/** Tables with more rows than this render only the rows in view, plus the overscan. */
export const WINDOW_FROM = 100;
/** Rows rendered beyond each edge of the view. */
export const OVERSCAN = 10;

export interface RowWindow {
  /** The first rendered row. */
  start: number;
  /** One past the last rendered row. */
  end: number;
  /** Space above and below the rendered rows, in pixels. */
  before: number;
  after: number;
}

/**
 * The rows to render at `scrollTop` in a view `viewport` pixels tall, with `keep` (the focused row) always
 * among them so keyboard focus never lands on a row that is not in the document.
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
}): RowWindow {
  if (count <= WINDOW_FROM) return { start: 0, end: count, before: 0, after: 0 };
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const visible = Math.ceil(Math.max(0, viewport) / rowHeight) + 1;
  let start = Math.max(0, first - OVERSCAN);
  let end = Math.min(count, first + visible + OVERSCAN);
  if (keep !== null && keep >= 0 && keep < count) {
    start = Math.min(start, keep);
    end = Math.max(end, keep + 1);
  }
  return { start, end, before: start * rowHeight, after: (count - end) * rowHeight };
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
