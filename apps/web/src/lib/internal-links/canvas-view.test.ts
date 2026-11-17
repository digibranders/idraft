import { describe, expect, it } from 'vitest';

import {
  BUTTON_STEP,
  MAX_SCALE,
  MIN_SCALE,
  centerOn,
  clampScale,
  fitView,
  firstView,
  panBy,
  revealMinimum,
  stepZoom,
  toScreen,
  toWorld,
  zoomAt,
  type View,
} from './canvas-view';

const VIEWPORT = { width: 1000, height: 600 };

describe('canvas view', () => {
  it('maps a world point to the screen and back', () => {
    const view: View = { x: 40, y: -20, scale: 0.5 };
    const screen = toScreen(view, { x: 100, y: 200 });
    expect(screen).toEqual({ x: 90, y: 80 });
    expect(toWorld(view, screen)).toEqual({ x: 100, y: 200 });
  });

  it('zooms toward a point and keeps the world point under it still', () => {
    const view: View = { x: 0, y: 0, scale: 1 };
    const next = zoomAt(view, 2, { x: 300, y: 200 });
    expect(next.scale).toBe(2);
    expect(toWorld(next, { x: 300, y: 200 })).toEqual({ x: 300, y: 200 });
  });

  it('clamps the zoom between 25 and 200 percent', () => {
    const view: View = { x: 0, y: 0, scale: 1 };
    expect(zoomAt(view, 100, { x: 0, y: 0 }).scale).toBe(MAX_SCALE);
    expect(zoomAt(view, 0.001, { x: 0, y: 0 }).scale).toBe(MIN_SCALE);
  });

  it('pans by a distance on the screen', () => {
    expect(panBy({ x: 10, y: 10, scale: 1 }, -5, 20)).toEqual({ x: 5, y: 30, scale: 1 });
  });

  it('steps the zoom by a quarter around the middle of the viewport', () => {
    const view: View = { x: 0, y: 0, scale: 1 };
    const larger = stepZoom(view, 1, VIEWPORT);
    expect(larger.scale).toBe(1 + BUTTON_STEP);
    expect(toWorld(larger, { x: 500, y: 300 })).toEqual({ x: 500, y: 300 });
    expect(stepZoom({ x: 0, y: 0, scale: MIN_SCALE }, -1, VIEWPORT).scale).toBe(MIN_SCALE);
  });

  it('steps from an off-grid zoom to the next quarter, never skipping one', () => {
    const at = (scale: number): View => ({ x: 0, y: 0, scale });
    expect(stepZoom(at(0.6), -1, VIEWPORT).scale).toBe(0.5);
    expect(stepZoom(at(0.6), 1, VIEWPORT).scale).toBe(0.75);
    expect(stepZoom(at(0.9), 1, VIEWPORT).scale).toBe(1);
    expect(stepZoom(at(0.9), -1, VIEWPORT).scale).toBe(0.75);
    expect(stepZoom(at(1.1), -1, VIEWPORT).scale).toBe(1);
    expect(stepZoom(at(1.8), 1, VIEWPORT).scale).toBe(2);
    expect(stepZoom(at(1.8), -1, VIEWPORT).scale).toBe(1.75);
    expect(stepZoom(at(1), 1, VIEWPORT).scale).toBe(1.25);
    expect(stepZoom(at(1), -1, VIEWPORT).scale).toBe(0.75);
  });

  it('treats a scale that is not finite as the smallest, and never divides by zero', () => {
    expect(clampScale(Number.NaN)).toBe(MIN_SCALE);
    expect(clampScale(Number.POSITIVE_INFINITY)).toBe(MIN_SCALE);
    expect(clampScale(0)).toBe(MIN_SCALE);
    const view = zoomAt({ x: 5, y: 5, scale: 1 }, 0, { x: 10, y: 10 });
    expect(Number.isFinite(view.x) && Number.isFinite(view.y)).toBe(true);
    expect(view.scale).toBe(MIN_SCALE);
  });

  it('returns the same view when the zoom is already at the limit, so nothing drifts', () => {
    const atMax: View = { x: 13.3, y: 7.7, scale: MAX_SCALE };
    expect(zoomAt(atMax, 5, { x: 301, y: 199 })).toBe(atMax);
    const atMin: View = { x: 13.3, y: 7.7, scale: MIN_SCALE };
    let view = atMin;
    for (let index = 0; index < 5; index += 1) view = zoomAt(view, 0.01, { x: 301, y: 199 });
    expect(view).toBe(atMin);
  });

  it('fits everything inside the viewport with a margin and never zooms past 100 percent', () => {
    const small = fitView({ left: 0, top: 0, width: 200, height: 100 }, VIEWPORT);
    expect(small.scale).toBe(1);
    const wide = fitView({ left: 0, top: 0, width: 4000, height: 300 }, VIEWPORT);
    expect(wide.scale).toBeLessThan(0.25 + 0.001);
    expect(wide.scale).toBeGreaterThanOrEqual(MIN_SCALE);
    const centred = fitView({ left: 100, top: 100, width: 400, height: 200 }, VIEWPORT);
    const middle = toScreen(centred, { x: 300, y: 200 });
    expect(middle.x).toBeCloseTo(500, 5);
    expect(middle.y).toBeCloseTo(300, 5);
  });

  it('shows the whole journey when it is readable at 70 percent or more', () => {
    const content = { left: 0, top: 0, width: 1200, height: 500 };
    const focus = { left: 500, top: 200, width: 288, height: 56 };
    const view = firstView(content, focus, VIEWPORT);
    expect(view.scale).toBeGreaterThanOrEqual(0.7);
    expect(view.scale).toBeLessThan(1);
  });

  it('takes the margin the journey asks for, so a wider margin fits at a smaller zoom', () => {
    const content = { left: 0, top: 0, width: 1200, height: 500 };
    const focus = { left: 500, top: 200, width: 288, height: 56 };
    expect(firstView(content, focus, VIEWPORT, 56).scale).toBeLessThan(firstView(content, focus, VIEWPORT).scale);
    expect(firstView(content, focus, VIEWPORT, 56)).toEqual(fitView(content, VIEWPORT, 56));
  });

  it('shows the focus page at 85 percent when the whole journey would be a blur', () => {
    const content = { left: 0, top: 0, width: 6000, height: 2000 };
    const focus = { left: 2800, top: 900, width: 288, height: 56 };
    const view = firstView(content, focus, VIEWPORT);
    expect(view.scale).toBe(0.85);
    const middle = toScreen(view, { x: 2944, y: 928 });
    expect(middle.x).toBeCloseTo(500, 5);
    expect(middle.y).toBeCloseTo(300, 5);
  });

  it('centres a box without changing the zoom unless one is given', () => {
    const view = centerOn({ x: 0, y: 0, scale: 0.5 }, { left: 400, top: 300, width: 100, height: 50 }, VIEWPORT);
    expect(view.scale).toBe(0.5);
    expect(toScreen(view, { x: 450, y: 325 })).toEqual({ x: 500, y: 300 });
    expect(centerOn(view, { left: 0, top: 0, width: 10, height: 10 }, VIEWPORT, 1).scale).toBe(1);
  });

  it('pans the least it takes to show a box with a margin, and not at all when it shows', () => {
    const view: View = { x: 0, y: 0, scale: 1 };
    const inside = { left: 100, top: 100, width: 100, height: 50 };
    expect(revealMinimum(view, inside, VIEWPORT)).toBe(view);
    const outside = { left: 1100, top: 100, width: 100, height: 50 };
    const moved = revealMinimum(view, outside, VIEWPORT, 24);
    expect(moved.y).toBe(0);
    expect(moved.x).toBe(VIEWPORT.width - 24 - (1100 + 100));
    expect(toScreen(moved, { x: 1200, y: 100 }).x).toBe(VIEWPORT.width - 24);
  });
});
