import { describe, expect, it } from 'vitest';

import { CORNER, edgeLook, elbowPath, returnArrowPath } from './journey-geometry';

const box = (left: number, top: number, width = 256, height = 72) => ({ left, top, width, height });

describe('edge geometry (mock il-journey.js elbow and drawEdges)', () => {
  it('draws a straight line between cards at the same height', () => {
    expect(elbowPath(box(0, 0), box(320, 0))).toBe('M256,36 H288 V36 H320');
  });

  it('turns down a spine halfway between the cards with rounded corners', () => {
    expect(CORNER).toBe(8);
    expect(elbowPath(box(0, 0), box(320, 100))).toBe('M256,36 H280 Q288,36 288,44 V128 Q288,136 296,136 H320');
  });

  it('turns up the same way', () => {
    expect(elbowPath(box(0, 100), box(320, 0))).toBe('M256,136 H280 Q288,136 288,128 V44 Q288,36 296,36 H320');
  });

  it('draws a return arrow below both cards, 40 px under the lower one', () => {
    expect(returnArrowPath(box(640, 0), box(0, 100))).toBe('M768,72 C768,212 128,212 128,175');
  });

  it('styles edges by scope and target status, and orders them so a colour shows on its own last segment', () => {
    expect(edgeLook('editorial', 200)).toEqual({ tone: 'editorial', dash: null, rank: 1 });
    expect(edgeLook('auto_generated', 200)).toEqual({ tone: 'muted', dash: '2 4', rank: 0 });
    expect(edgeLook('template', 200)).toEqual({ tone: 'muted', dash: '6 4', rank: 0 });
    expect(edgeLook('editorial', 301)).toEqual({ tone: 'redirect', dash: null, rank: 2 });
    expect(edgeLook('template', 404)).toEqual({ tone: 'broken', dash: '6 4', rank: 2 });
    expect(edgeLook(null, null)).toEqual({ tone: 'editorial', dash: null, rank: 1 });
  });
});
