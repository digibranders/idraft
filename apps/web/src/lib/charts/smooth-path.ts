/**
 * A smooth SVG path through points (a Catmull-Rom spline turned into cubic curves), so a sparkline has no corners
 * (15-data-visualization.md section 1a). Pure, so it is tested without a DOM.
 */

export interface PathPoint {
  x: number;
  y: number;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** The `d` of a path through the points in order: empty for none, a dot's `M` for one, a straight line for two. */
export function smoothPath(points: readonly PathPoint[]): string {
  const [first] = points;
  if (first === undefined) return '';
  let path = `M${String(round2(first.x))},${String(round2(first.y))}`;
  for (let at = 0; at < points.length - 1; at += 1) {
    const from = points[at] ?? first;
    const to = points[at + 1] ?? from;
    // The neighbours on each side steer the curve; at the ends the point stands in for the missing neighbour
    const before = points[Math.max(0, at - 1)] ?? from;
    const after = points[Math.min(points.length - 1, at + 2)] ?? to;
    const one = `${String(round2(from.x + (to.x - before.x) / 6))},${String(round2(from.y + (to.y - before.y) / 6))}`;
    const two = `${String(round2(to.x - (after.x - from.x) / 6))},${String(round2(to.y - (after.y - from.y) / 6))}`;
    path += ` C${one} ${two} ${String(round2(to.x))},${String(round2(to.y))}`;
  }
  return path;
}
