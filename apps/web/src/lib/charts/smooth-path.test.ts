import { describe, expect, it } from 'vitest';

import { smoothPath } from './smooth-path';

describe('smoothPath', () => {
  it('is empty for no points and a lone move for one', () => {
    expect(smoothPath([])).toBe('');
    expect(smoothPath([{ x: 3, y: 4 }])).toBe('M3,4');
  });

  it('is a straight line for two points: both control points sit on it', () => {
    expect(smoothPath([{ x: 0, y: 0 }, { x: 60, y: 30 }])).toBe('M0,0 C10,5 50,25 60,30');
  });

  it('passes through every point, in order', () => {
    const path = smoothPath([{ x: 0, y: 10 }, { x: 50, y: 0 }, { x: 100, y: 10 }]);
    expect(path.startsWith('M0,10 ')).toBe(true);
    expect(path.split('C')).toHaveLength(3);
    expect(path.endsWith(' 100,10')).toBe(true);
    expect(path).toContain(' 50,0 C');
  });

  it('rounds to two decimals', () => {
    expect(smoothPath([{ x: 0, y: 0 }, { x: 1 / 3, y: 2 / 3 }])).toBe('M0,0 C0.06,0.11 0.28,0.56 0.33,0.67');
  });
});
