import { describe, expect, it } from 'vitest';

import { focusOf } from './map-focus';
import { colourGroups, toMapGraph } from './map-graph';
import { layoutMap } from './map-layout';
import { fitBox, HEADER_PREFIX, mapOption, type MapOptionInput } from './map-option';
import type { LinkGraph, PageTier } from './types';
import type { ChartTokens } from '@/lib/design/read-tokens';

const tiers = [{ tier_id: 't1', position: 1, code: 'T1', name: 'Money pages' }] as unknown as PageTier[];
const node = (url_id: string, path: string, tier_id: string | null, links_in: number, links_out: number) => ({
  url_id,
  path,
  title: path,
  tier_id,
  links_in,
  links_out,
  sitewide_from: 0,
});
const graph = toMapGraph(
  {
    run_id: 'r',
    include_auto: false,
    pages_total: 4,
    truncated: false,
    home_url_id: '1',
    nodes: [
      node('1', '/', 't1', 0, 2),
      node('2', '/a', null, 1, 1),
      node('3', '/b', null, 2, 0),
      node('4', '/loose', null, 0, 0),
    ],
    edges: [
      { source: '1', target: '2', links: 1 },
      { source: '1', target: '3', links: 1 },
      { source: '2', target: '3', links: 1 },
    ],
  } as LinkGraph,
  tiers,
);
const layout = layoutMap({
  nodes: graph.nodes.map((item) => ({
    id: item.id,
    links: item.linksIn + item.linksOut,
    group: item.tierPosition ?? 99,
  })),
  edges: graph.edges,
  below: false,
});
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

function input(more: Partial<MapOptionInput> = {}): MapOptionInput {
  return {
    graph,
    layout,
    moved: new Map(),
    focus: focusOf(graph, { selected: null, query: '', lens: 'none' }),
    colour: colourGroups(graph, 'tier', tiers),
    hidden: new Set(),
    tokens,
    width: 1200,
    height: 700,
    view: { zoom: 1, center: null },
    minimap: true,
    reducedMotion: false,
    words: {
      home: 'Home page',
      blockTitle: 'No editorial link in or out',
      blockLine: (key, pages) => `${key}: ${pages}`,
    },
    tooltip: () => '',
    ...more,
  };
}

interface Dot {
  name: string;
  x: number;
  y: number;
  symbolSize: number;
  itemStyle: { color: string; opacity: number; borderColor: string; borderWidth: number };
  label: { show: boolean; formatter: string };
}
interface Link {
  source: string;
  target: string;
  lineStyle: { type?: unknown; opacity?: number };
}
interface Series {
  data: Dot[];
  links: Link[];
  emphasis: { focus: string };
}
const seriesOf = (option: Record<string, unknown>): Series => {
  const series = (option.series as Series[])[0];
  if (series === undefined) throw new Error('the option has no series');
  return series;
};
const dot = (option: Record<string, unknown>, id: string): Dot => {
  const found = seriesOf(option).data.find((item) => item.name === id);
  if (found === undefined) throw new Error(`no dot named ${id}`);
  return found;
};
const link = (option: Record<string, unknown>, source: string, target: string): Link | undefined =>
  seriesOf(option).links.find((item) => item.source === source && item.target === target);

describe('fitBox', () => {
  it('keeps the proportions of the map in a canvas of nearly its shape', () => {
    const box = fitBox({ width: 2, height: 1 }, 1272, 696);

    // The room is the canvas less 72 px of width and 96 px of height: 1200 by 600, the shape of the map
    expect([box.width, box.height]).toEqual([1200, 600]);
    expect([box.left, box.top]).toEqual([36, 28]);
  });

  it('stretches the map to fill a canvas of another shape, by at most 1.7 times', () => {
    const wide = fitBox({ width: 2, height: 1 }, 1272, 796);
    const tall = fitBox({ width: 2, height: 1 }, 472, 996);
    const slim = fitBox({ width: 1, height: 1 }, 1272, 596);

    // The room is 1200 by 700: the map is 1.17 times taller than its shape and fills it
    expect([wide.width, wide.height]).toEqual([1200, 700]);
    // The room is 400 by 900 and the map's own shape allows 200: it takes 1.7 times that, centred in the room
    expect([tall.width, tall.height]).toEqual([400, 340]);
    expect(tall.left).toBe(36);
    expect(tall.top).toBe(28 + (900 - 340) / 2);
    // A square map in a wide room: 1.7 times as wide as high, not the whole width
    expect(slim.width).toBeCloseTo(500 * 1.7);
    expect(slim.height).toBe(500);
  });
});

describe('mapOption', () => {
  it('draws every page as a dot at its place, bigger with more links, coloured by its tier', () => {
    const option = mapOption(input());

    expect(seriesOf(option).data.filter((item) => !String(item.name).startsWith(HEADER_PREFIX))).toHaveLength(4);
    expect(dot(option, '1').itemStyle.color).toBe('#1');
    expect(dot(option, '2').itemStyle.color).toBe('#surface');
    expect(dot(option, '2').itemStyle.borderColor).toBe('#strong');
    expect(dot(option, '3').symbolSize).toBeGreaterThan(dot(option, '4').symbolSize);
    expect(dot(option, '1').label.formatter).toBe('Home page');
  });

  it('names the linked pages and leaves the block unnamed until 200 percent', () => {
    expect(dot(mapOption(input()), '2').label.show).toBe(true);
    expect(dot(mapOption(input()), '4').label.show).toBe(false);
    expect(dot(mapOption(input({ view: { zoom: 2, center: null } })), '4').label.show).toBe(true);
  });

  it('dims what is not lit and draws the links of the selected page by direction', () => {
    const option = mapOption(input({ focus: focusOf(graph, { selected: '2', query: '', lens: 'none' }) }));

    expect(dot(option, '4').itemStyle.opacity).toBeLessThan(0.2);
    expect(dot(option, '2').itemStyle.borderWidth).toBeGreaterThan(2);
    // 1 to 2 comes in: dotted. 2 to 3 goes out: solid. 1 to 3 does not touch the page: faint.
    expect(link(option, '1', '2')?.lineStyle.type).toEqual([1, 6]);
    expect(link(option, '2', '3')?.lineStyle.type).toBeUndefined();
    expect(link(option, '1', '3')?.lineStyle.opacity).toBeLessThan(0.1);
    // A selection keeps its light: pointing at another page does not take it over
    expect(seriesOf(option).emphasis.focus).toBe('none');
  });

  it('takes a group off the map with its links and its line in the block', () => {
    const option = mapOption(input({ hidden: new Set(['']) }));

    expect(seriesOf(option).data.map((item) => item.name)).toEqual(['1']);
    expect(seriesOf(option).links).toEqual([]);
  });

  it('draws a map of only the block, or of nothing, without failing', () => {
    const loose = toMapGraph(
      {
        run_id: 'r',
        include_auto: false,
        pages_total: 2,
        truncated: false,
        home_url_id: null,
        nodes: [node('1', '/a', null, 0, 0), node('2', '/b', null, 0, 0)],
        edges: [],
      } as LinkGraph,
      tiers,
    );
    const only = mapOption(
      input({
        graph: loose,
        layout: layoutMap({
          nodes: loose.nodes.map((item) => ({ id: item.id, links: 0, group: 99 })),
          edges: [],
          below: false,
        }),
        focus: focusOf(loose, { selected: null, query: '', lens: 'none' }),
        colour: colourGroups(loose, 'tier', tiers),
      }),
    );
    const nothing = mapOption(input({ hidden: new Set(['t1', '']) }));

    expect(seriesOf(only).data.filter((item) => !item.name.startsWith(HEADER_PREFIX))).toHaveLength(2);
    expect(Number.isFinite(dot(only, '1').symbolSize)).toBe(true);
    expect(seriesOf(nothing).data).toEqual([]);
    expect(seriesOf(nothing).links).toEqual([]);
  });

  it('puts a dragged page where it was dropped', () => {
    const option = mapOption(input({ moved: new Map([['2', [5, 6] as const]]) }));

    expect([dot(option, '2').x, dot(option, '2').y]).toEqual([5, 6]);
  });

  it('shows the minimap only when zoomed in, and no motion when the reader asked for none', () => {
    expect((mapOption(input()).thumbnail as { show: boolean }).show).toBe(false);
    expect((mapOption(input({ view: { zoom: 2, center: null } })).thumbnail as { show: boolean }).show).toBe(true);
    expect(mapOption(input({ reducedMotion: true })).animation).toBe(false);
    // The window of the minimap has a full strength frame and a faint fill
    const window = (
      mapOption(input({ view: { zoom: 2, center: null } })).thumbnail as { windowStyle: Record<string, unknown> }
    ).windowStyle;
    expect(window).toMatchObject({ borderColor: '#primary', opacity: 1 });
  });
});
