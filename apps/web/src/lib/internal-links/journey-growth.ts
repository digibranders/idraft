import type { Box } from './journey-geometry';

/** Cards that stay glide this long (spec 7.5 "Growing never loses the place"). */
export const GLIDE_MS = 300;
export const GLIDE_EASING = 'ease-in-out';
/** Cards that close fade out where they stood for this long. */
export const GHOST_MS = 180;
/** New cards fade in this long. */
export const FADE_IN_MS = 240;

export interface GrowthPlan {
  /** The pan in screen pixels that keeps the pressed card still on the screen. */
  pan: { dx: number; dy: number };
  /** Cards that stay: where they were, relative to where they are now, in world pixels. */
  move: Map<string, { dx: number; dy: number }>;
  enter: string[];
  leave: string[];
}

/**
 * What a card opening or closing does to the picture: the pressed card stays exactly where it is on the screen (the
 * view pans by what it moved), every other card glides from its old place to its new one, new cards fade in and closed
 * cards fade out where they stood. All boxes are in world pixels; `scale` turns the pressed card's move into a pan.
 */
export function planGrowth(
  before: ReadonlyMap<string, Box>,
  after: ReadonlyMap<string, Box>,
  pressedKey: string,
  scale: number,
): GrowthPlan {
  const pressedBefore = before.get(pressedKey);
  const pressedAfter = after.get(pressedKey);
  const shift =
    pressedBefore === undefined || pressedAfter === undefined
      ? { dx: 0, dy: 0 }
      : { dx: pressedAfter.left - pressedBefore.left, dy: pressedAfter.top - pressedBefore.top };
  const move = new Map<string, { dx: number; dy: number }>();
  for (const [key, box] of after) {
    const old = before.get(key);
    if (old === undefined || key === pressedKey) continue;
    // With the view panned, the pressed card is still: a card's old place in the new frame is its old place plus the
    // pressed card's shift in the world
    const dx = old.left + shift.dx - box.left;
    const dy = old.top + shift.dy - box.top;
    if (Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5) move.set(key, { dx, dy });
  }
  return {
    // `0 -` and not a minus sign in front: a pan of nothing must be 0 and not -0
    pan: { dx: 0 - shift.dx * scale, dy: 0 - shift.dy * scale },
    move,
    enter: [...after.keys()].filter((key) => !before.has(key)),
    leave: [...before.keys()].filter((key) => !after.has(key)),
  };
}
