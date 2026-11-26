import { color as zrColor } from 'echarts/core';

/**
 * The rich chart style of docs/design-system/15-data-visualization.md section 1a: smooth lines, a fade under each line,
 * no glow, entrance motion that gives way to reduced motion, and a gradient line that follows the pointer. Pure
 * helpers, so the option builders that use them stay testable without a canvas.
 */

/** ECharts reads a gradient as a plain object, so no ECharts import is needed here. */
export interface LinearGradient {
  type: 'linear';
  x: number;
  y: number;
  x2: number;
  y2: number;
  colorStops: readonly { offset: number; color: string }[];
}

/** A colour at an opacity. A colour ECharts cannot parse (a stand-in in a test) is returned as it is. */
export function withAlpha(color: string, alpha: number): string {
  return zrColor.parse(color) ? zrColor.modifyAlpha(color, alpha) : color;
}

/**
 * A colour mixed toward black (amount below 0) or white (above 0), for the faces of a column. (`color.lift` of ECharts
 * lightens in both directions, so the mix is done here on the channels it parses.) Unparsable colours are returned as they are.
 */
export function shade(color: string, amount: number): string {
  const channels = zrColor.parse(color);
  if (!channels) return color;
  const target = amount < 0 ? 0 : 255;
  const mix = (channel: number | undefined): number =>
    Math.round((channel ?? 0) + (target - (channel ?? 0)) * Math.abs(amount));
  return zrColor.stringify([mix(channels[0]), mix(channels[1]), mix(channels[2]), channels[3] ?? 1], 'rgba');
}

/** A vertical fade of one colour from `from` opacity at the top to `to` at the bottom. */
export function fadeDown(color: string, from: number, to: number): LinearGradient {
  return {
    type: 'linear',
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      { offset: 0, color: withAlpha(color, from) },
      { offset: 1, color: withAlpha(color, to) },
    ],
  };
}

/** Whether to draw without motion: the person asked the system for less, or motion cannot be asked about (no `matchMedia`: a test, the server). */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : true;
}

/** Entrance and update motion of a chart; off for people who ask for less motion (and wherever motion cannot be asked about). */
export function chartMotion(): {
  animation: boolean;
  animationDuration: number;
  animationDurationUpdate: number;
  animationEasing: string;
} {
  return {
    animation: !prefersReducedMotion(),
    animationDuration: 800,
    animationDurationUpdate: 400,
    animationEasing: 'cubicOut',
  };
}

/** The axis pointer of a time chart: a 2 px line, bright at the top and fading out toward the axis. */
export function fadingPointer(color: string): {
  type: 'line';
  z: number;
  lineStyle: { width: number; type: 'solid'; color: LinearGradient };
} {
  return { type: 'line', z: 0, lineStyle: { width: 2, type: 'solid', color: fadeDown(color, 0.7, 0) } };
}

/**
 * The pointer over a chart: a ring with a dot and four ticks with a white edge, so it reads on light and dark cards
 * (`public/chart-cursor.svg`: a cursor image cannot use the page's tokens). It points at a place on the chart, which is what
 * reading a chart is. `crosshair` is the fallback where an image cursor is refused.
 */
export const CHART_CURSOR = "url('/chart-cursor.svg') 14 14, crosshair";
