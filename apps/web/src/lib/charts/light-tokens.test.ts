// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { readLightChartColors } from './light-tokens';
import * as tokens from '@/lib/design/read-tokens';

// Names stand in for colours: the test reads which call made which value, not how it looks
const STUB: tokens.ChartTokens = {
  palette: ['palette-1'],
  other: 'other',
  reference: 'reference',
  grid: 'grid',
  axis: 'axis',
  label: 'label',
  band: 'band',
  rankBandNone: 'rank-band-none',
  surfaceElevated: 'surface-elevated',
  border: 'border',
  borderStrong: 'border-strong',
  foreground: 'foreground',
  foregroundSecondary: 'foreground-secondary',
  foregroundMuted: 'foreground-muted',
  fontFamily: 'sans-serif',
};

describe('readLightChartColors', () => {
  const root = document.documentElement;
  let readChart: MockInstance<typeof tokens.readChartTokens>;
  let readColor: MockInstance<typeof tokens.readColorToken>;

  beforeEach(() => {
    root.classList.add('dark');
    readChart = vi.spyOn(tokens, 'readChartTokens');
    readColor = vi.spyOn(tokens, 'readColorToken').mockReturnValue('surface');
  });

  afterEach(() => {
    root.classList.remove('dark');
    vi.restoreAllMocks();
  });

  it('reads the tokens while the dark class is off and puts it back afterwards', () => {
    let darkDuringRead: boolean | null = null;
    readChart.mockImplementation(() => {
      darkDuringRead = root.classList.contains('dark');
      return STUB;
    });
    const colors = readLightChartColors();
    expect(darkDuringRead).toBe(false);
    expect(root.classList.contains('dark')).toBe(true);
    expect(colors.chart).toBe(STUB);
    expect(colors.surface).toBe('surface');
    expect(readColor).toHaveBeenCalledWith('--surface', root);
  });

  it('puts the dark class back when a read throws', () => {
    readChart.mockImplementation(() => {
      throw new Error('no tokens');
    });
    expect(() => readLightChartColors()).toThrow('no tokens');
    expect(root.classList.contains('dark')).toBe(true);
  });

  it('leaves a light page without the class', () => {
    root.classList.remove('dark');
    readChart.mockReturnValue(STUB);
    readLightChartColors();
    expect(root.classList.contains('dark')).toBe(false);
  });
});
