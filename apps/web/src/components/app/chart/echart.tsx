'use client';

import { BarChart, CustomChart, LineChart, PieChart, TreemapChart } from 'echarts/charts';
import {
  AriaComponent,
  GridComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
} from 'echarts/components';
import { connect, init, use as registerModules, type ECharts } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useRef, type ReactElement } from 'react';

import { CHART_CURSOR } from '@/lib/charts/rich-style';
import { readChartTokens, type ChartTokens } from '@/lib/design/read-tokens';

// Tree-shaken: only what the category charts and the treemap draw. Legend and title are React (15 section 3).
registerModules([
  LineChart,
  BarChart,
  PieChart,
  CustomChart,
  TreemapChart,
  GridComponent,
  TooltipComponent,
  AriaComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  CanvasRenderer,
]);

export interface EChartProps {
  /** Builds the option from the colours of the theme in use; called again when the theme changes. */
  option: (tokens: ChartTokens) => Record<string, unknown>;
  /** Pixel height of the canvas: 140, 180, 240 or 280 by context. */
  height: number;
  /** Charts with the same group share their axis pointer: hovering one shows the crosshair in all (small multiples). */
  group?: string | undefined;
  /** Called with the index of the datum clicked, for a mark that opens something (a column of a brand). */
  onPick?: ((dataIndex: number) => void) | undefined;
  /** With `onPick`: whether the datum at this index opens something, so only its mark shows the hand. Default: all of them do. */
  opensAt?: ((dataIndex: number) => boolean) | undefined;
}

/** The part of zrender's pointer handling that sets the cursor, which ECharts does not type. */
interface CursorProxy {
  setCursor?: (cursor?: string) => void;
}

/**
 * Makes the pointer over a chart the ring cursor (15-data-visualization.md section 1a). zrender sets `default` over empty
 * canvas and `pointer` over every mark that answers the pointer; the hand is kept only where `opens()` says the mark opens
 * something, and the ring is shown everywhere else, over marks that only show a tooltip too.
 */
function applyChartCursor(instance: ECharts, opens: () => boolean): void {
  // Optional call: a test's stand-in for the instance has no zrender
  const zr = (instance as Partial<ECharts>).getZr?.() as unknown as { handler?: { proxy?: CursorProxy } } | undefined;
  const proxy = zr?.handler?.proxy;
  if (proxy?.setCursor === undefined) return;
  const setCursor = proxy.setCursor.bind(proxy);
  proxy.setCursor = (cursor) => {
    const hand = cursor === 'pointer' && opens();
    setCursor(cursor === undefined || cursor === 'default' || (cursor === 'pointer' && !hand) ? CHART_CURSOR : cursor);
  };
  proxy.setCursor('default');
}

/** Groups `connect` has been called for; the call is idempotent, so once is enough. */
const connectedGroups = new Set<string>();

/**
 * The ECharts canvas (15-data-visualization.md section 3): the instance lives with the element, follows
 * its size, redraws when the option changes (the option decides on motion), and is disposed on unmount. The theme is a
 * class and a colour scheme on `<html>`, which the theme switch writes after React commits, so the canvas
 * watches `<html>` and reads the colours again once they have changed.
 */
export function EChart({ option, height, group, onPick, opensAt }: EChartProps): ReactElement {
  const element = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts | null>(null);
  const latestOption = useRef(option);
  const latestPick = useRef(onPick);
  const latestOpensAt = useRef(opensAt);
  const hovered = useRef<number | null>(null);

  useEffect(() => {
    const node = element.current;
    if (node === null) return undefined;
    const instance = init(node, null, { renderer: 'canvas' });
    applyChartCursor(instance, () => {
      if (latestPick.current === undefined) return false;
      const decide = latestOpensAt.current;
      return decide === undefined || hovered.current === null || decide(hovered.current);
    });
    chart.current = instance;
    instance.on('click', (event: { dataIndex?: number }) => {
      if (typeof event.dataIndex === 'number') latestPick.current?.(event.dataIndex);
    });
    instance.on('mouseover', (event: { dataIndex?: number }) => {
      hovered.current = typeof event.dataIndex === 'number' ? event.dataIndex : null;
    });
    instance.on('mouseout', () => {
      hovered.current = null;
    });
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
    latestPick.current = onPick;
    latestOpensAt.current = opensAt;
  }, [onPick, opensAt]);

  // After the instance exists (effects run in order)
  useEffect(() => {
    if (group === undefined || chart.current === null) return;
    chart.current.group = group;
    if (!connectedGroups.has(group)) {
      connectedGroups.add(group);
      connect(group);
    }
  }, [group]);

  useEffect(() => {
    latestOption.current = option;
    chart.current?.setOption(option(readChartTokens()), { notMerge: true });
  }, [option]);

  return <div ref={element} style={{ height }} className="w-full" />;
}
