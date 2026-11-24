import type { Point } from './canvas-view';
import type { Box } from './journey-geometry';
import type { LineDirection } from './tier-lanes';

/** The space between two columns (spec 7.5: 112 px, to give the curves room). */
export const COLUMN_GAP = 112;

export interface Drawn {
  d: string;
  /** Where the dot sits (the source end). */
  start: Point;
  /** Where the arrowhead sits (the target end). */
  end: Point;
}

const midY = (box: Box): number => box.top + box.height / 2;

/** A spread around zero for line `index` of `count` leaving one card, so curves do not share a trunk. */
export const fanOffset = (index: number, count: number): number => (index - (count - 1) / 2) * 14;

/** The most a curve leans, so a card with dozens of links does not throw curves far above and below its row. */
const MAX_LEAN = 36;

/**
 * A smooth curve from the middle of the source's right edge to the middle of the target's left edge (By step). The
 * control point at the shared card (`sharedEnd` false: the source; true: the target) leans, so the curves of a card
 * with many links separate (spec 7.5 "Layout"); the other control point stays level, so each curve arrives
 * horizontally, as the arrowhead needs.
 */
export function curvePath(from: Box, to: Box, index: number, count = 1, sharedEnd = false): Drawn {
  const start = { x: from.left + from.width, y: midY(from) };
  const end = { x: to.left, y: midY(to) };
  const reach = Math.max(48, Math.abs(end.x - start.x) * 0.5);
  const lean = Math.max(-MAX_LEAN, Math.min(MAX_LEAN, fanOffset(index, Math.max(count, index + 1))));
  const [startLean, endLean] = sharedEnd ? [0, lean] : [lean, 0];
  const d = `M${start.x},${start.y} C${start.x + reach},${start.y + startLean} ${end.x - reach},${end.y + endLean} ${end.x},${end.y}`;
  return { d, start, end };
}

/**
 * A line between two cards in the By tier layout (mock `route`): from the right edge of the source to the left edge of the
 * target when the target is to the right; into the right edge of a target in a lane to the left (a link down a tier); and
 * round the right side for a card in the same lane, each swinging out by a different amount so no line runs over the
 * cards it passes. The arrowhead direction is not returned: callers draw it with `marker-end` and `orient="auto"`, and
 * every curve here arrives horizontally.
 */
export function tierRoute(from: Box, to: Box, index: number): Drawn {
  const fromRight = from.left + from.width;
  const toRight = to.left + to.width;
  if (to.left >= fromRight - 1) {
    const start = { x: fromRight, y: midY(from) };
    const end = { x: to.left, y: midY(to) };
    const reach = Math.max(48, (end.x - start.x) * 0.5);
    return {
      d: `M${start.x},${start.y} C${start.x + reach},${start.y} ${end.x - reach},${end.y} ${end.x},${end.y}`,
      start,
      end,
    };
  }
  if (toRight <= from.left + 1) {
    const start = { x: from.left, y: midY(from) };
    const end = { x: toRight, y: midY(to) };
    const reach = Math.max(48, Math.abs(start.x - end.x) * 0.5);
    return {
      d: `M${start.x},${start.y} C${start.x - reach},${start.y} ${end.x + reach},${end.y} ${end.x},${end.y}`,
      start,
      end,
    };
  }
  const start = { x: fromRight, y: midY(from) };
  const end = { x: toRight, y: midY(to) };
  const bulge = Math.min(96, 28 + Math.abs(end.y - start.y) * 0.12 + Math.max(0, index) * 10);
  return {
    d: `M${start.x},${start.y} C${start.x + bulge},${start.y} ${end.x + bulge},${end.y} ${end.x},${end.y}`,
    start,
    end,
  };
}

export type DirectionTone = 'up' | 'down' | 'side' | 'redirect' | 'broken';

export interface DirectionLook {
  tone: DirectionTone;
  dash: string | null;
}

/** The colour and dash of a By tier line: green up, blue down, grey dashed sideways; amber (redirect) and red (broken) win. */
export function directionLook(direction: LineDirection, targetStatus: number | null): DirectionLook {
  if (targetStatus !== null && targetStatus >= 400) return { tone: 'broken', dash: null };
  if (targetStatus !== null && targetStatus >= 300) return { tone: 'redirect', dash: null };
  return { tone: direction, dash: direction === 'side' ? '6 4' : null };
}
