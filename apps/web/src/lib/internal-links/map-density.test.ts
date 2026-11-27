import { describe, expect, it } from 'vitest';

import { focusOf } from './map-focus';
import { nameStep, nameWidth } from './map-labels';
import { colourGroups, toMapGraph, type MapGraph } from './map-graph';
import { layoutMap, type MapLayout } from './map-layout';
import { canvasPoint, frameOf, HEADER_PREFIX, mapOption, type MapOptionInput } from './map-option';
import type { PageTier } from './types';
import type { ChartTokens } from '@/lib/design/read-tokens';
import { denseLinkGraph } from '@/mocks/fixtures/dense-link-graph';

/**
 * A map with the shape of a real, well linked site (387 pages, hubs of 100 to 200 links, 15 percent of pages with no
 * link): the numbers a reader sees at the fitted size. The names are measured with the same width estimate the
 * chooser uses; the real glyphs were measured once in Chromium (plan 11, "Built, with notes").
 */
const tiers = ['t1', 't2', 't3', 't4'].map((id, index) => ({
  tier_id: id,
  position: index + 1,
  code: `T${String(index + 1)}`,
  name: `Tier ${String(index + 1)}`,
})) as unknown as PageTier[];
const tokens = {
  palette: ['#1', '#2', '#3', '#4', '#5', '#6'],
  other: '#other',
  border: '#border',
  borderStrong: '#strong',
  foreground: '#fg',
  foregroundSecondary: '#fg2',
  foregroundMuted: '#muted',
  surfaceElevated: '#surface',
  fontFamily: 'Geist',
  named: (name: string) => `#${name}`,
} as unknown as ChartTokens;

const CANVAS = { width: 1350, height: 596 };

function build(
  more: Partial<MapOptionInput> = {},
  { auto = false, size = CANVAS }: { auto?: boolean; size?: { width: number; height: number } } = {},
) {
  const graph: MapGraph = toMapGraph(denseLinkGraph({ auto }), tiers);
  const layout: MapLayout = layoutMap({
    nodes: graph.nodes.map((node) => ({ id: node.id, links: node.degree, group: node.tierPosition ?? 99 })),
    edges: graph.edges,
    below: size.width < size.height,
  });
  const input: MapOptionInput = {
    graph,
    layout,
    moved: new Map(),
    focus: focusOf(graph, { selected: null, query: '', lens: 'none' }),
    colour: colourGroups(graph, 'tier', tiers),
    hidden: new Set(),
    tokens,
    width: size.width,
    height: size.height,
    view: { zoom: 1, center: null },
    minimap: false,
    reducedMotion: true,
    words: {
      home: 'Home page',
      blockTitle: 'No editorial link in or out',
      blockLine: (key, pages) => `T${String(key)}: ${String(pages)} pages`,
    },
    tooltip: () => '',
    ...more,
  };
  return { graph, layout, input, option: mapOption(input), ...size };
}

interface Dot {
  name: string;
  x: number;
  y: number;
  symbolSize: number;
  label: { show: boolean; formatter: string };
}
interface Series {
  data: Dot[];
  links: { lineStyle: { opacity: number }; symbol?: unknown }[];
  edgeSymbol: string[];
  label: { fontSize: number };
}
const seriesOf = (option: Record<string, unknown>): Series => (option.series as Series[])[0] as Series;

/** Every data point of the option on the canvas, in pixels, as the canvas draws it. */
function onCanvas(option: Record<string, unknown>, width: number, height: number) {
  const data = seriesOf(option).data;
  const frame = frameOf(
    data.map((item) => [item.x, item.y] as const),
    width,
    height,
  );
  return { frame, points: data.map((item) => ({ item, at: canvasPoint(frame, [item.x, item.y]) })) };
}

const boxOf = (at: readonly [number, number], text: string, size: number, fontSize: number) => {
  const left = at[0] + size / 2 + 4;
  return {
    left,
    right: left + nameWidth(text, fontSize),
    top: at[1] - (fontSize + 2) / 2,
    bottom: at[1] + (fontSize + 2) / 2,
  };
};
const overlap = (a: ReturnType<typeof boxOf>, b: ReturnType<typeof boxOf>): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

describe('a dense map at the fitted size', () => {
  const { option, width, height, graph } = build();
  const { frame, points } = onCanvas(option, width, height);
  const fontSize = seriesOf(option).label.fontSize;
  const named = points.filter(({ item }) => !item.name.startsWith(HEADER_PREFIX) && item.label.show);
  const linked = points.filter(({ item }) => (graph.byId.get(item.name)?.degree ?? 0) > 0);

  it('names a readable set of pages, the most linked first', () => {
    expect(named.length).toBeGreaterThanOrEqual(25);
    expect(named.length).toBeLessThanOrEqual(60);
    // The pages with the most links are named, whatever else is
    const top = [...graph.nodes].sort((a, b) => b.degree - a.degree).slice(0, 3);
    const namedIds = new Set(named.map(({ item }) => item.name));
    for (const node of top) expect(namedIds.has(node.id)).toBe(true);
  });

  it('has no two names on top of each other, nor a name on a line of the block', () => {
    const boxes = named.map(({ item, at }) => boxOf(at, item.label.formatter, item.symbolSize, fontSize));
    for (let a = 0; a < boxes.length; a += 1) {
      for (let b = a + 1; b < boxes.length; b += 1) {
        expect(overlap(boxes[a] as (typeof boxes)[0], boxes[b] as (typeof boxes)[0])).toBe(false);
      }
    }
    const lines = points.filter(({ item }) => item.name.startsWith(HEADER_PREFIX) && item.label.formatter !== '');
    for (const { item, at } of lines) {
      const text = {
        left: at[0] + 4,
        right: at[0] + 4 + nameWidth(item.label.formatter, fontSize),
        top: at[1] - 7,
        bottom: at[1] + 7,
      };
      for (const box of boxes) expect(overlap(box, text)).toBe(false);
    }
  });

  it('fills the width of the canvas with the map, and the block stays inside it', () => {
    const xs = linked.map(({ at }) => at[0]);
    expect((Math.max(...xs) - Math.min(...xs)) / width).toBeGreaterThan(0.7);
    for (const { item, at } of points.filter(
      ({ item: dot }) => dot.name.startsWith(HEADER_PREFIX) && dot.label.formatter !== '',
    )) {
      expect(at[0] + 4 + nameWidth(item.label.formatter, fontSize)).toBeLessThan(width);
    }
    expect(frame.box.left + frame.box.width).toBeLessThanOrEqual(width);
  });

  it('keeps the dots of linked pages apart, and a hub does not cover its neighbours', () => {
    let nearest = Number.POSITIVE_INFINITY;
    for (let a = 0; a < linked.length; a += 1) {
      for (let b = a + 1; b < linked.length; b += 1) {
        const first = linked[a];
        const second = linked[b];
        if (first === undefined || second === undefined) continue;
        const gap = Math.hypot(first.at[0] - second.at[0], first.at[1] - second.at[1]);
        nearest = Math.min(nearest, gap);
        expect(gap).toBeGreaterThan((first.item.symbolSize + second.item.symbolSize) / 2);
      }
    }
    expect(nearest).toBeGreaterThan(6);
    expect(Math.max(...linked.map(({ item }) => item.symbolSize))).toBeLessThanOrEqual(30 * 1.7);
  });

  it('thins the links out to the density and leaves their arrowheads for a selection', () => {
    const series = seriesOf(option);
    expect(series.links.length).toBeGreaterThan(2000);
    expect(series.links[0]?.lineStyle.opacity).toBeLessThan(0.15);
    expect(series.edgeSymbol).toEqual(['none', 'none']);
    const selected = build({ focus: focusOf(graph, { selected: graph.homeId, query: '', lens: 'none' }) });
    const arrows = seriesOf(selected.option).links.filter((link) => link.symbol !== undefined);
    expect(arrows.length).toBe(graph.byId.get(graph.homeId ?? '')?.degree);
  });
});

describe('a dense map, zoomed', () => {
  it('names more pages at each zoom step, with the same pages first', () => {
    const counts = [1, 1.5, 2, 3, 4].map((zoom) => {
      const { option } = build({ view: { zoom, center: null } });
      return seriesOf(option).data.filter((item) => !item.name.startsWith(HEADER_PREFIX) && item.label.show);
    });
    for (let index = 1; index < counts.length; index += 1) {
      expect(counts[index]?.length ?? 0).toBeGreaterThan(counts[index - 1]?.length ?? 0);
    }
    // Between two steps the set does not change: a pan and a small zoom do not shuffle the names
    expect(nameStep(1.4)).toBe(1);
    const same = build({ view: { zoom: 1.4, center: null } }).option;
    expect(seriesOf(same).data.map((item) => item.label.show)).toEqual(
      seriesOf(build().option).data.map((item) => item.label.show),
    );
  });

  it('draws the links more strongly as the zoom spreads them out', () => {
    const fit = seriesOf(build().option).links[0]?.lineStyle.opacity ?? 0;
    const near = seriesOf(build({ view: { zoom: 4, center: null } }).option).links[0]?.lineStyle.opacity ?? 0;

    expect(near).toBeGreaterThan(fit);
  });
});

describe('a dense map with the auto-generated links, and in a tall window', () => {
  it('keeps the names clear of each other with a third more links', () => {
    const { option, width, height } = build({}, { auto: true });
    const { points } = onCanvas(option, width, height);
    const fontSize = seriesOf(option).label.fontSize;
    const boxes = points
      .filter(({ item }) => !item.name.startsWith(HEADER_PREFIX) && item.label.show)
      .map(({ item, at }) => boxOf(at, item.label.formatter, item.symbolSize, fontSize));

    expect(boxes.length).toBeGreaterThanOrEqual(25);
    for (let a = 0; a < boxes.length; a += 1) {
      for (let b = a + 1; b < boxes.length; b += 1) {
        expect(overlap(boxes[a] as (typeof boxes)[0], boxes[b] as (typeof boxes)[0])).toBe(false);
      }
    }
  });

  it('puts the block under the map in a window taller than wide, clear of the map and of its own lines', () => {
    const size = { width: 600, height: 900 };
    const { option } = build({}, { size });
    const { points } = onCanvas(option, size.width, size.height);
    const lines = points.filter(({ item }) => item.name.startsWith(HEADER_PREFIX) && item.label.formatter !== '');
    const ys = lines.map(({ at }) => at[1]).sort((a, b) => a - b);
    const mapBottom = Math.max(
      ...points
        .filter(({ item }) => !item.name.startsWith(HEADER_PREFIX) && item.symbolSize > 9)
        .map(({ at }) => at[1]),
    );

    expect(ys.length).toBeGreaterThan(1);
    expect(ys[0]).toBeGreaterThan(mapBottom - 40);
    // Two lines of text never closer than the height of a line
    for (let index = 1; index < ys.length; index += 1)
      expect((ys[index] ?? 0) - (ys[index - 1] ?? 0)).toBeGreaterThan(14);
  });
});

describe('the layout of a dense map', () => {
  it('takes a small share of a second in the worker, and is the same twice', () => {
    const graph = toMapGraph(denseLinkGraph(), tiers);
    const input = {
      nodes: graph.nodes.map((node) => ({ id: node.id, links: node.degree, group: node.tierPosition ?? 99 })),
      edges: graph.edges,
      below: false,
    };
    const started = performance.now();
    const first = layoutMap(input);
    const elapsed = performance.now() - started;

    // Measured 0.25 s here; the bound is loose enough for a loaded machine
    expect(elapsed).toBeLessThan(2000);
    expect(layoutMap(input)).toEqual(first);
  });
});
