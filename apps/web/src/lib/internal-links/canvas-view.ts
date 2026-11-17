import type { Box } from './journey-geometry';

/**
 * The canvas viewport (spec 7.5, mock `il-canvas.js`): a point of the world is at `world * scale + (x, y)` on the
 * screen. Pure; the component keeps the view in state and calls these.
 */
export interface View {
  x: number;
  y: number;
  scale: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 2;
/** The zoom buttons and the plus and minus keys move by a quarter. */
export const BUTTON_STEP = 0.25;
/** A whole journey is shown at the first view only when it stays this readable (spec 7.5 "First view"). */
export const READABLE_SCALE = 0.7;
/** Otherwise the focus page, at this zoom. */
export const FOCUS_SCALE = 0.85;
const FIT_MARGIN = 32;

export const clampScale = (scale: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

export const toScreen = (view: View, point: Point): Point => ({
  x: point.x * view.scale + view.x,
  y: point.y * view.scale + view.y,
});

export const toWorld = (view: View, point: Point): Point => ({
  x: (point.x - view.x) / view.scale,
  y: (point.y - view.y) / view.scale,
});

/** Zoom to `scale` (clamped) keeping the world point under `anchor` (a screen point) where it is. */
export function zoomAt(view: View, scale: number, anchor: Point): View {
  const next = clampScale(scale);
  const world = toWorld(view, anchor);
  return { x: anchor.x - world.x * next, y: anchor.y - world.y * next, scale: next };
}

export const panBy = (view: View, dx: number, dy: number): View => ({ ...view, x: view.x + dx, y: view.y + dy });

const middleOf = (viewport: Size): Point => ({ x: viewport.width / 2, y: viewport.height / 2 });

/** One button step in or out, around the middle of the viewport. The size is a whole quarter of 100 percent. */
export function stepZoom(view: View, direction: 1 | -1, viewport: Size): View {
  const quarters = Math.round(view.scale / BUTTON_STEP) + direction;
  return zoomAt(view, quarters * BUTTON_STEP, middleOf(viewport));
}

/** Everything in view with a margin, centred, never past 100 percent. */
export function fitView(content: Box, viewport: Size, margin: number = FIT_MARGIN): View {
  const scale = clampScale(
    Math.min(
      1,
      (viewport.width - margin * 2) / Math.max(content.width, 1),
      (viewport.height - margin * 2) / Math.max(content.height, 1),
    ),
  );
  return {
    scale,
    x: viewport.width / 2 - (content.left + content.width / 2) * scale,
    y: viewport.height / 2 - (content.top + content.height / 2) * scale,
  };
}

/** The box in the middle of the viewport, at `scale` or the current zoom. */
export function centerOn(view: View, box: Box, viewport: Size, scale: number = view.scale): View {
  const next = clampScale(scale);
  return {
    scale: next,
    x: viewport.width / 2 - (box.left + box.width / 2) * next,
    y: viewport.height / 2 - (box.top + box.height / 2) * next,
  };
}

/**
 * The view when a journey first opens: the whole journey when it is readable at 70 percent or more, otherwise the focus
 * page at 85 percent, so the first thing seen is never a blur.
 */
export function firstView(content: Box, focus: Box, viewport: Size): View {
  const whole = fitView(content, viewport);
  if (whole.scale >= READABLE_SCALE) return whole;
  return centerOn(whole, focus, viewport, FOCUS_SCALE);
}

/** Pans the least it takes to show `box` (world coordinates) inside the viewport with `margin`; the same object when it shows. */
export function revealMinimum(view: View, box: Box, viewport: Size, margin: number = 24): View {
  const left = box.left * view.scale + view.x;
  const right = (box.left + box.width) * view.scale + view.x;
  const top = box.top * view.scale + view.y;
  const bottom = (box.top + box.height) * view.scale + view.y;
  let dx = 0;
  let dy = 0;
  if (right > viewport.width - margin) dx = viewport.width - margin - right;
  if (left + dx < margin) dx = margin - left;
  if (bottom > viewport.height - margin) dy = viewport.height - margin - bottom;
  if (top + dy < margin) dy = margin - top;
  return dx === 0 && dy === 0 ? view : panBy(view, dx, dy);
}
