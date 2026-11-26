import { color as zrColor } from 'echarts/core';

/**
 * The chart style of docs/design-system/15-data-visualization.md section 1a: smooth lines, flat colours (no glow, no
 * gradient), entrance motion that gives way to reduced motion, and a flat line that follows the pointer. Pure
 * helpers, so the option builders that use them stay testable without a canvas.
 */

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

/** The axis pointer of a time chart: a flat 2 px line, softer than the data lines. */
export function flatPointer(color: string): {
  type: 'line';
  z: number;
  lineStyle: { width: number; type: 'solid'; color: string };
} {
  return { type: 'line', z: 0, lineStyle: { width: 2, type: 'solid', color: withAlpha(color, 0.4) } };
}

/**
 * The pointer over a chart: a ring with a dot and four ticks with a white edge, so it reads on light and dark cards
 * (`public/chart-cursor.svg`: a cursor image cannot use the page's tokens). It points at a place on the chart, which is what
 * reading a chart is. `crosshair` is the fallback where an image cursor is refused.
 */
export const CHART_CURSOR = "url('/chart-cursor.svg') 14 14, crosshair";
