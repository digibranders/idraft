'use client';

import { BarChart, LineChart } from 'echarts/charts';
import { AriaComponent, GridComponent, TooltipComponent } from 'echarts/components';
import { init, use as registerModules, type ECharts } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useRef, type ReactElement } from 'react';

import { readChartTokens, type ChartTokens } from '@/lib/design/read-tokens';

// Tree-shaken: only what the category charts draw. Legend and title are React (15 section 3).
registerModules([LineChart, BarChart, GridComponent, TooltipComponent, AriaComponent, CanvasRenderer]);

export interface EChartProps {
  /** Builds the option from the colours of the theme in use; called again when the theme changes. */
  option: (tokens: ChartTokens) => Record<string, unknown>;
  /** Pixel height of the canvas: 140, 180, 240 or 280 by context. */
  height: number;
}

/**
 * The ECharts canvas (15-data-visualization.md section 3): the instance lives with the element, follows
 * its size, redraws without animation when the option changes, and is disposed on unmount. The theme is a
 * class and a colour scheme on `<html>`, which the theme switch writes after React commits, so the canvas
 * watches `<html>` and reads the colours again once they have changed.
 */
export function EChart({ option, height }: EChartProps): ReactElement {
  const element = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts | null>(null);
  const latestOption = useRef(option);

  useEffect(() => {
    const node = element.current;
    if (node === null) return undefined;
    const instance = init(node, null, { renderer: 'canvas' });
    chart.current = instance;
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => instance.resize());
    resize?.observe(node);
    const theme = new MutationObserver(() => {
      instance.setOption(latestOption.current(readChartTokens()), { notMerge: true });
    });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
    return () => {
      resize?.disconnect();
      theme.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    latestOption.current = option;
    chart.current?.setOption(option(readChartTokens()), { notMerge: true });
  }, [option]);

  return <div ref={element} style={{ height }} className="w-full" />;
}
