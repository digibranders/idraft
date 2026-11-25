/**
 * How every chart's tooltip moves. ECharts' defaults put the tooltip to the right of the pointer and glide it there over
 * 0.4 s; near the right edge it no longer fits, `confine` throws it back to the left in one jump, and the pointer seems
 * to hit a wall. Here the tooltip sits on the side of the pointer with more room, follows it without gliding, and is
 * kept inside the chart, so crossing the middle of the chart is the only place it changes side.
 */

/** What ECharts hands a `position` function after the pointer: the params, the tooltip element, its rect, then the sizes. */
type PositionArgs = [params: unknown, element: unknown, rect: unknown, size: Size];

/** The space between the pointer and the tooltip, in px. */
const GAP = 14;
/** How long the tooltip takes to move, in seconds: ECharts' own default is 0.4. */
const GLIDE = 0.08;

interface Size {
  contentSize: [number, number];
  viewSize: [number, number];
}

const clamp = (value: number, low: number, high: number): number => Math.min(Math.max(value, low), Math.max(low, high));

/** Where the tooltip's top left corner goes for a pointer at `point`: beside it, on the roomier side, inside the chart. */
export function tooltipPosition(point: readonly [number, number], size: Size): [number, number] {
  const [x, y] = point;
  const [width, height] = size.contentSize;
  const [viewWidth, viewHeight] = size.viewSize;
  const left = x < viewWidth / 2 ? x + GAP : x - GAP - width;
  return [clamp(left, 0, viewWidth - width), clamp(y - height / 2, 0, viewHeight - height)];
}

/** The `position` callback ECharts calls as `(point, params, element, rect, size)`. */
export function positionOf(point: [number, number], ...[, , , size]: PositionArgs): [number, number] {
  return tooltipPosition(point, size);
}

/**
 * The option with the tooltip's movement set, where its builder did not choose one itself. A tooltip that hangs on the
 * page (`appendToBody`) is taller than its chart on purpose, so it keeps ECharts' own placement.
 */
export function withTooltipFlow(option: Record<string, unknown>): Record<string, unknown> {
  const tooltip = option['tooltip'];
  if (typeof tooltip !== 'object' || tooltip === null || Array.isArray(tooltip)) return option;
  const own = tooltip as Record<string, unknown>;
  return {
    ...option,
    tooltip: {
      transitionDuration: GLIDE,
      ...(own['appendToBody'] === true ? {} : { position: positionOf }),
      ...own,
    },
  };
}
