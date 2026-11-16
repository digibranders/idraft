import type { EdgeScope } from './scopes';

/** The radius of an elbow's corners (mock `CORNER`). */
export const CORNER = 8;
/** How far below the lower card a return arrow dips. */
const RETURN_DIP = 40;

/** A card's rectangle inside the unscaled canvas, in pixels. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const right = (box: Box): number => box.left + box.width;
const middle = (box: Box): number => box.top + box.height / 2;
const bottom = (box: Box): number => box.top + box.height;
const center = (box: Box): number => box.left + box.width / 2;

/**
 * An orthogonal edge with rounded corners from the middle of `from`'s right side to the middle of `to`'s left side,
 * down a spine halfway between them (the mock's `elbow`). Cards of one parent share the spine.
 */
export function elbowPath(from: Box, to: Box): string {
  const startX = right(from);
  const startY = middle(from);
  const endX = to.left;
  const endY = middle(to);
  const spine = startX + (endX - startX) / 2;
  const dy = endY - startY;
  const r = Math.min(CORNER, Math.abs(dy) / 2, Math.abs(spine - startX), Math.abs(endX - spine));
  if (Math.abs(dy) < 1 || r < 1) return `M${startX},${startY} H${spine} V${endY} H${endX}`;
  const sign = dy > 0 ? 1 : -1;
  return `M${startX},${startY} H${spine - r} Q${spine},${startY} ${spine},${startY + sign * r} V${endY - sign * r} Q${spine},${endY} ${spine + r},${endY} H${endX}`;
}

/** A dashed return arrow from the bottom of `from` to the bottom of `to`, dipping under both (the mock's back-link arrows). */
export function returnArrowPath(from: Box, to: Box): string {
  const dip = Math.max(bottom(from), bottom(to)) + RETURN_DIP;
  return `M${center(from)},${bottom(from)} C${center(from)},${dip} ${center(to)},${dip} ${center(to)},${bottom(to) + 3}`;
}

export interface EdgeLook {
  tone: 'editorial' | 'muted' | 'redirect' | 'broken';
  dash: string | null;
  /** Drawn in rank order, so a redirect or broken colour shows on its own last segment. */
  rank: 0 | 1 | 2;
}

/**
 * The look of an edge (spec 7.5, the legend): editorial solid, auto-generated dotted, template dashed; amber into a
 * redirect and red into a broken target. `null` scope is the redirect child of a redirect focus and the Both ways
 * group, which draw as editorial.
 */
export function edgeLook(scope: EdgeScope | null, targetStatus: number | null): EdgeLook {
  const dash = scope === 'auto_generated' ? '2 4' : scope === 'template' ? '6 4' : null;
  if (targetStatus !== null && targetStatus >= 400) return { tone: 'broken', dash, rank: 2 };
  if (targetStatus !== null && targetStatus >= 300) return { tone: 'redirect', dash, rank: 2 };
  if (scope === null || scope === 'editorial') return { tone: 'editorial', dash, rank: 1 };
  return { tone: 'muted', dash, rank: 0 };
}
