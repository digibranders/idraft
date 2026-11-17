import { describe, expect, it } from 'vitest';

import { GLIDE_EASING, GLIDE_MS, GHOST_MS, planGrowth } from './journey-growth';

const box = (left: number, top: number) => ({ left, top, width: 240, height: 42 });

describe('planGrowth (spec 7.5 "Growing never loses the place")', () => {
  it('keeps the pressed card where it was on screen by panning the view by what it moved', () => {
    const plan = planGrowth(
      new Map([
        ['a', box(0, 0)],
        ['b', box(400, 0)],
      ]),
      new Map([
        ['a', box(0, 0)],
        ['b', box(400, 60)],
        ['c', box(800, 0)],
      ]),
      'b',
      0.5,
    );
    expect(plan.pan).toEqual({ dx: 0, dy: -30 });
  });

  it('does not pan when the pressed card did not move', () => {
    const plan = planGrowth(new Map([['a', box(5, 5)]]), new Map([['a', box(5, 5)]]), 'a', 1);
    expect(plan.pan).toEqual({ dx: 0, dy: 0 });
  });

  it('glides every other card from its old place to its new one, and leaves the pressed card alone', () => {
    const plan = planGrowth(
      new Map([
        ['a', box(0, 0)],
        ['b', box(400, 0)],
      ]),
      new Map([
        ['a', box(0, 40)],
        ['b', box(400, 40)],
      ]),
      'b',
      1,
    );
    // The pressed card moved 40 down, the view pans 40 up with it, so card a starts where it was 40 below its new place
    expect(plan.pan).toEqual({ dx: 0, dy: -40 });
    expect(plan.move.has('b')).toBe(false);
    // a did not move relative to b: it needs no glide
    expect(plan.move.has('a')).toBe(false);
  });

  it('glides a card that moved relative to the pressed one', () => {
    const plan = planGrowth(
      new Map([
        ['a', box(0, 0)],
        ['b', box(400, 0)],
      ]),
      new Map([
        ['a', box(0, 100)],
        ['b', box(400, 40)],
      ]),
      'b',
      1,
    );
    expect(plan.move.get('a')).toEqual({ dx: 0, dy: -60 });
  });

  it('fades new cards in and closed cards out', () => {
    const plan = planGrowth(
      new Map([
        ['a', box(0, 0)],
        ['gone', box(400, 0)],
      ]),
      new Map([
        ['a', box(0, 0)],
        ['fresh', box(400, 0)],
      ]),
      'a',
      1,
    );
    expect(plan.enter).toEqual(['fresh']);
    expect(plan.leave).toEqual(['gone']);
  });

  it('uses the times of the spec', () => {
    expect(GLIDE_MS).toBe(300);
    expect(GHOST_MS).toBe(180);
    expect(GLIDE_EASING).toBe('ease-in-out');
  });
});
