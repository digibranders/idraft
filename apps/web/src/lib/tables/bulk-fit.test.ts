import { describe, expect, it } from 'vitest';

import { fitCount } from './bulk-fit';

describe('fitCount', () => {
  const widths = [100, 100, 100, 100];

  it('keeps every action a button when they all fit without the More menu', () => {
    // 4 buttons and 3 gaps of 8 px: 424
    expect(fitCount(widths, 36, 424, 8)).toBe(4);
    expect(fitCount(widths, 36, 900, 8)).toBe(4);
  });

  it('keeps the first actions that fit beside the More button, and moves the rest into it', () => {
    // 3 buttons, a gap, and the More button: 316 + 8 + 36 = 360 fits 400 but 4 buttons do not
    expect(fitCount(widths, 36, 400, 8)).toBe(3);
    expect(fitCount(widths, 36, 359, 8)).toBe(2);
  });

  it('leaves only the More button when no action fits beside it', () => {
    expect(fitCount(widths, 36, 100, 8)).toBe(0);
    expect(fitCount(widths, 36, 0, 8)).toBe(0);
  });

  it('has nothing to fit for no actions', () => {
    expect(fitCount([], 36, 0, 8)).toBe(0);
  });
});
