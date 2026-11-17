import { describe, expect, it } from 'vitest';

import { COLUMN_GAP, curvePath, directionLook, fanOffset, tierRoute } from './journey-curves';

const from = { left: 0, top: 100, width: 240, height: 42 };
const to = { left: 352, top: 300, width: 240, height: 42 };

describe('curvePath', () => {
  it('leaves the right edge of the source and arrives at the left edge of the target', () => {
    const { d, start, end } = curvePath(from, to, 0);
    expect(start).toEqual({ x: 240, y: 121 });
    expect(end).toEqual({ x: 352, y: 321 });
    expect(d.startsWith('M240,121 C')).toBe(true);
    expect(d.endsWith('352,321')).toBe(true);
  });

  it('gives lines of one card different shapes, so none runs on top of another', () => {
    const shapes = new Set([0, 1, 2, 3].map((index) => curvePath(from, to, index).d));
    expect(shapes.size).toBe(4);
  });

  it('keeps the gap between columns at 112 pixels', () => {
    expect(COLUMN_GAP).toBe(112);
  });
});

describe('fanOffset', () => {
  it('spreads index 0 to count minus 1 around zero', () => {
    expect(fanOffset(0, 1)).toBe(0);
    expect(fanOffset(0, 3)).toBeLessThan(0);
    expect(fanOffset(2, 3)).toBeGreaterThan(0);
    expect(fanOffset(1, 3)).toBe(0);
  });
});

describe('tierRoute', () => {
  it('goes from the right edge to the left edge when the target lane is to the right', () => {
    const route = tierRoute(from, to, 0);
    expect(route.start).toEqual({ x: 240, y: 121 });
    expect(route.end).toEqual({ x: 352, y: 321 });
  });

  it('enters a card in a lane to the left from its right edge', () => {
    const left = { left: -352, top: 300, width: 240, height: 42 };
    const route = tierRoute(from, left, 0);
    expect(route.start).toEqual({ x: 0, y: 121 });
    expect(route.end).toEqual({ x: -112, y: 321 });
  });

  it('swings round the right side for a card in the same lane, by a different amount each time', () => {
    const below = { left: 0, top: 300, width: 240, height: 42 };
    const a = tierRoute(from, below, 0);
    const b = tierRoute(from, below, 2);
    expect(a.start).toEqual({ x: 240, y: 121 });
    expect(a.end).toEqual({ x: 240, y: 321 });
    expect(a.d).not.toBe(b.d);
  });
});

describe('directionLook', () => {
  it('is green up, blue down and grey dashed sideways, and a redirect or a broken target still wins', () => {
    expect(directionLook('up', 200)).toEqual({ tone: 'up', dash: null });
    expect(directionLook('down', 200)).toEqual({ tone: 'down', dash: null });
    expect(directionLook('side', 200)).toEqual({ tone: 'side', dash: '6 4' });
    expect(directionLook('up', 301).tone).toBe('redirect');
    expect(directionLook('down', 404).tone).toBe('broken');
  });
});
