import type { EdgeScope } from './scopes';

/** How far below the lower card a return arrow dips. */
const RETURN_DIP = 40;

/** A card's rectangle inside the unscaled canvas, in pixels. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const bottom = (box: Box): number => box.top + box.height;
const center = (box: Box): number => box.left + box.width / 2;

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
