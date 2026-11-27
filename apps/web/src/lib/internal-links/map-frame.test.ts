// @vitest-environment node
import { GraphChart } from 'echarts/charts';
import { init, use as registerModules } from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import { describe, expect, it } from 'vitest';

import { focusOf } from './map-focus';
import { colourGroups, toMapGraph } from './map-graph';
import { layoutMap } from './map-layout';
import { canvasPoint, frameOf, mapOption } from './map-option';
import type { PageTier } from './types';
import type { ChartTokens } from '@/lib/design/read-tokens';
import { denseLinkGraph } from '@/mocks/fixtures/dense-link-graph';

registerModules([GraphChart, SVGRenderer]);

/**
 * The names are chosen from where dots stand on the canvas, which the option does not say: `frameOf` and `canvasPoint`
 * work it out from the data. This holds them to what ECharts really does with the same option (a box that may stretch
 * the map along one axis), so a change in ECharts shows here and not as names on top of each other.
 */
describe('where the canvas puts the dots', () => {
  it('is where frameOf and canvasPoint say, on a stretched map', () => {
    const tiers = [{ tier_id: 't1', position: 1, code: 'T1', name: 'T1' }] as unknown as PageTier[];
    const graph = toMapGraph(denseLinkGraph(), tiers);
    const layout = layoutMap({
      nodes: graph.nodes.map((node) => ({ id: node.id, links: node.degree, group: 99 })),
      edges: graph.edges,
      below: false,
    });
    const size = { width: 1350, height: 596 };
    const tokens = {
      palette: [],
      other: 'ink',
      border: 'ink',
      borderStrong: 'ink',
      foreground: 'ink',
      foregroundSecondary: 'ink',
      foregroundMuted: 'ink',
      surfaceElevated: 'paper',
      fontFamily: 'sans-serif',
    } as unknown as ChartTokens;
    const option = mapOption({
      graph,
      layout,
      moved: new Map(),
      focus: focusOf(graph, { selected: null, query: '', lens: 'none' }),
      colour: colourGroups(graph, 'tier', tiers),
      hidden: new Set(),
      tokens,
      ...size,
      view: { zoom: 1, center: null },
      minimap: false,
      reducedMotion: true,
      words: { home: 'Home', blockTitle: 'No link', blockLine: (key, pages) => `${String(key)}: ${String(pages)}` },
      tooltip: () => '',
    });
    const chart = init(null, null, { renderer: 'svg', ssr: true, ...size });
    chart.setOption({ ...option, animation: false });
    const data = (option.series as { data: { x: number; y: number }[] }[])[0]?.data ?? [];
    const frame = frameOf(
      data.map((item) => [item.x, item.y] as const),
      size.width,
      size.height,
    );

    // The map is stretched: the pixels per unit differ along the two axes
    expect(Math.abs(frame.sx / frame.sy - 1)).toBeGreaterThan(0.1);
    for (const item of data.slice(0, 40)) {
      const real = chart.convertToPixel({ seriesIndex: 0 }, [item.x, item.y]) as number[];
      const mine = canvasPoint(frame, [item.x, item.y]);
      expect(mine[0]).toBeCloseTo(real[0] ?? Number.NaN, 0);
      expect(mine[1]).toBeCloseTo(real[1] ?? Number.NaN, 0);
    }
    chart.dispose();
  });
});
