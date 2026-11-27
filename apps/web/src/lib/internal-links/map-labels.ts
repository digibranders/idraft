/**
 * Which pages of the Link map carry a name (plan 11, W8, tuned for dense maps). Names are chosen here, in a fixed
 * order, and not left to the canvas: the pages with the most links come first, a name is kept only where its box
 * clears the boxes already kept, and the count is capped for the zoom, so the same map and zoom always show the
 * same names. Everything is in canvas pixels. The canvas keeps `labelLayout.hideOverlap` as a second line of defence
 * for the few pixels the width estimate gets wrong.
 */

export interface NameCandidate {
  id: string;
  /** Where the dot stands on the canvas at 100 percent, in pixels. */
  x: number;
  y: number;
  /** The drawn size of the dot at 100 percent, in pixels. */
  size: number;
  /** The words the name shows. */
  text: string;
}

/** A piece of text on the map that names must keep clear of, anchored at its left middle (the block's lines). */
export interface TextObstacle {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The zooms at which the set of names is worked out again; between two of them it is the set of the lower one. */
export const NAME_STEPS: readonly number[] = [0.5, 1, 1.5, 2, 3, 4, 6, 8, 12];
/** ECharts grows a dot by this share of the zoom (`nodeScaleRatio` of the series). */
export const NODE_SCALE_RATIO = 0.45;
/** At 100 percent no more than this many names are drawn: a set a reader can take in. */
export const NAMES_AT_FIT = 48;
/** The share of the font size a letter of a name takes in width, and the room the halo and the gap add. */
const LETTER = 0.56;
const NAME_PAD = 6;
/** Clear space between two names, in pixels. */
const GAP = 3;
/** From the edge of the dot to the start of its name, as the canvas draws it (`label.distance`). */
const DISTANCE = 4;

/** The set of names to draw at `zoom`: the largest step that is not above it. */
export function nameStep(zoom: number): number {
  let step = NAME_STEPS[0] ?? 1;
  for (const candidate of NAME_STEPS) if (candidate <= zoom) step = candidate;
  return step;
}

/** How much bigger the canvas draws a dot at `zoom` than at 100 percent. */
export const dotScale = (zoom: number): number => 1 + (zoom - 1) * NODE_SCALE_RATIO;

/** The most names for a zoom step: a name more for each page that comes into view as the map opens up. */
export const nameLimit = (step: number): number => Math.round(NAMES_AT_FIT * step ** 1.6);

/** The width of a name in pixels, estimated from its letters. */
export const nameWidth = (text: string, fontSize: number): number => text.length * fontSize * LETTER + NAME_PAD;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const clear = (a: Box, b: Box): boolean =>
  a.right + GAP <= b.left || b.right + GAP <= a.left || a.bottom + GAP <= b.top || b.bottom + GAP <= a.top;

/**
 * The ids to name, from `ranked` (the most important page first). A page is named when its box, to the right of its
 * dot, clears every name and every obstacle already kept, until `limit` names are kept. Pure and deterministic.
 */
export function chooseNames(
  ranked: readonly NameCandidate[],
  rules: { step: number; fontSize: number; obstacles?: readonly TextObstacle[]; limit?: number },
): Set<string> {
  const { step, fontSize } = rules;
  const limit = rules.limit ?? nameLimit(step);
  const height = fontSize + 2;
  const kept: Box[] = (rules.obstacles ?? []).map((item) => ({
    left: item.x * step,
    right: item.x * step + item.width,
    top: item.y * step - item.height / 2,
    bottom: item.y * step + item.height / 2,
  }));
  const names = new Set<string>();
  for (const page of ranked) {
    if (names.size >= limit) break;
    const left = page.x * step + (page.size / 2) * dotScale(step) + DISTANCE;
    const box: Box = {
      left,
      right: left + nameWidth(page.text, fontSize),
      top: page.y * step - height / 2,
      bottom: page.y * step + height / 2,
    };
    if (kept.every((other) => clear(box, other))) {
      kept.push(box);
      names.add(page.id);
    }
  }
  return names;
}
