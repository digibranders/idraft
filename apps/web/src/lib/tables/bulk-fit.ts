/**
 * How many of a bulk bar's actions stay buttons in `available` pixels: all of them when they fit, otherwise
 * the first ones that fit beside the "More actions" button, which then holds the rest. `widths` are the
 * natural widths of the actions in order, `moreWidth` the width of the More button and `gap` the space
 * between neighbours.
 */
export function fitCount(widths: readonly number[], moreWidth: number, available: number, gap: number): number {
  const total = widths.reduce((sum, width, index) => sum + width + (index === 0 ? 0 : gap), 0);
  if (total <= available) return widths.length;
  let used = 0;
  let fitting = 0;
  for (const [index, width] of widths.entries()) {
    used += width + (index === 0 ? 0 : gap);
    // The buttons so far, a gap, and the More button
    if (used + gap + moreWidth > available) break;
    fitting += 1;
  }
  return fitting;
}
