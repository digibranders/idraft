import { color as zrColor } from 'echarts/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CHART_CURSOR, chartMotion, fadeDown, fadingPointer, shade, withAlpha } from './rich-style';

/** A 7-character hex colour from its channels, so no colour literal sits in the test. */
const hex = (red: number, green: number, blue: number): string =>
  `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
const BLACK = hex(0, 0, 0);
const BLUE = hex(30, 101, 227);
const GREY = hex(128, 128, 128);

/** The channels and opacity of a colour string, as ECharts reads them. */
const read = (color: string | undefined): number[] | null => (color === undefined ? null : zrColor.parse(color));

describe('withAlpha', () => {
  it('gives a colour an opacity', () => {
    expect(read(withAlpha(BLUE, 0.5))).toEqual([30, 101, 227, 0.5]);
  });

  it('returns a colour ECharts cannot parse as it is', () => {
    expect(withAlpha('chart-1', 0.5)).toBe('chart-1');
  });
});

describe('shade', () => {
  it('darkens toward black below zero and lightens toward white above it', () => {
    const [dark] = read(shade(GREY, -0.5)) ?? [];
    const [light] = read(shade(GREY, 0.5)) ?? [];
    expect(dark).toBeLessThan(128);
    expect(light).toBeGreaterThan(128);
  });

  it('returns a colour ECharts cannot parse as it is', () => {
    expect(shade('chart-1', 0.5)).toBe('chart-1');
  });
});

describe('fadeDown', () => {
  it('fades one colour from the first opacity at the top to the second at the bottom', () => {
    const fade = fadeDown(BLACK, 0.4, 0);
    expect(fade).toMatchObject({ type: 'linear', x: 0, y: 0, x2: 0, y2: 1 });
    expect(read(fade.colorStops[0]?.color)?.[3]).toBe(0.4);
    expect(read(fade.colorStops[1]?.color)?.[3]).toBe(0);
  });
});

describe('fadingPointer', () => {
  it('is a 2 px line under the marks, fading toward the axis', () => {
    const pointer = fadingPointer(BLUE);
    expect(pointer).toMatchObject({ type: 'line', z: 0, lineStyle: { width: 2, type: 'solid' } });
    expect(read(pointer.lineStyle.color.colorStops[1]?.color)?.[3]).toBe(0);
  });
});

describe('chartMotion', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('animates the entrance when the person has not asked for less motion', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    expect(chartMotion()).toMatchObject({ animation: true, animationDuration: 800 });
  });

  it('draws at once where motion cannot be asked about (no window)', () => {
    vi.stubGlobal('window', undefined);
    expect(chartMotion().animation).toBe(false);
  });

  it('draws at once when the person has asked for less motion', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
    expect(chartMotion().animation).toBe(false);
  });
});

describe('CHART_CURSOR', () => {
  it('is an image cursor with a hotspot at its middle and a fallback', () => {
    expect(CHART_CURSOR).toBe("url('/chart-cursor.svg') 14 14, crosshair");
  });
});
