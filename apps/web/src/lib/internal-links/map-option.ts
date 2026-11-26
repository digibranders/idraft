import type { MapFocus } from './map-focus';
import type { MapColour, MapColourGroup, MapGraph, MapNode } from './map-graph';
import type { MapLayout } from './map-layout';
import type { ChartTokens } from '@/lib/design/read-tokens';

/** The zoom and the centre of the map in view; a null centre is the fitted one. */
export interface MapView {
  zoom: number;
  center: readonly [number, number] | null;
}

export const MAP_ZOOM = { min: 0.4, max: 12 } as const;
/** From this zoom the minimap shows: with everything in view it would only repeat the map. */
export const MINIMAP_FROM = 1.05;
/** From this zoom the pages in the block carry names: at the fitted size they stand too close. */
export const BLOCK_NAMES_FROM = 2;
/** The zooms at which the picture changes by itself, so the canvas repaints when a zoom crosses one. */
export const MAP_REPAINT_AT: readonly number[] = [MINIMAP_FROM, BLOCK_NAMES_FROM];
/** Names of the nodes that only carry the block's lines of text. */
export const HEADER_PREFIX = 'h:';

// Pixels of canvas per unit of the layout at which a dot has its plain size
const PLAIN_SCALE = 0.8;
// Links into the selected page are green and dotted, links out blue and solid: told apart without colour too
const IN_LINE = { type: [1, 6], cap: 'round', width: 2.75 } as const;

export interface MapOptionInput {
  graph: MapGraph;
  layout: MapLayout;
  /** Pages the reader dragged, by id. */
  moved: ReadonlyMap<string, readonly [number, number]>;
  focus: MapFocus;
  colour: { keyOf: (node: MapNode) => string; list: readonly MapColourGroup[] };
  /** Legend groups switched off. */
  hidden: ReadonlySet<string>;
  tokens: ChartTokens;
  width: number;
  height: number;
  view: MapView;
  minimap: boolean;
  reducedMotion: boolean;
  words: {
    /** The name the home page carries. */
    home: string;
    blockTitle: string;
    /** A line of the block: the group's key (a tier position, 99 for untiered) and its pages on the map. */
    blockLine: (key: number, pages: number) => string;
  };
  /** The tooltip's HTML for a page id, or for an edge by its index in `graph.edges`. Text in it is already escaped. */
  tooltip: (target: { page: string } | { edge: number }) => string;
}

/** The largest box of the map's own proportions in the canvas, centred, with room below for the view controls. */
export function fitBox(
  span: { width: number; height: number },
  width: number,
  height: number,
): { left: number; top: number; width: number; height: number } {
  const shape = span.width / span.height;
  const room = { width: Math.max(1, width - 72), height: Math.max(1, height - 96) };
  const fitted =
    room.width / room.height > shape
      ? { width: room.height * shape, height: room.height }
      : { width: room.width, height: room.width / shape };
  return { left: 36 + (room.width - fitted.width) / 2, top: 28 + (room.height - fitted.height) / 2, ...fitted };
}

function fill(colour: MapColour, tokens: ChartTokens, surface: string): { color: string; outline: string | null } {
  switch (colour.kind) {
    case 'palette':
      return { color: tokens.palette[colour.index] ?? tokens.other, outline: null };
    case 'other':
      return { color: tokens.other, outline: null };
    case 'named':
      return { color: tokens.named?.(colour.name) ?? tokens.other, outline: tokens.borderStrong };
    case 'hollow':
      return { color: surface, outline: tokens.borderStrong };
  }
}

export function mapOption(input: MapOptionInput): Record<string, unknown> {
  const { graph, layout, moved, focus, colour, hidden, tokens, view, words } = input;
  const placed = new Map(layout.positions.map(([id, x, y]) => [id, [x, y] as const]));
  const spot = (id: string): readonly [number, number] => moved.get(id) ?? placed.get(id) ?? [0, 0];
  // The page's own surface, as the approved mock draws a dot's rim and a hollow dot
  const surface = tokens.named?.('surface') ?? tokens.surfaceElevated;
  const styleOf = new Map(colour.list.map((group) => [group.key, fill(group.colour, tokens, surface)]));
  const shown = graph.nodes.filter((node) => !hidden.has(colour.keyOf(node)));
  const shownIds = new Set(shown.map((node) => node.id));

  // A line of the block counts the pages of its group that are on the map now, and goes with them when a legend
  // group is off. The header named `room` is empty: it keeps room for the text when the block is a few pages wide.
  const inBlock = new Map<number, number>();
  for (const node of shown) {
    if (node.linksIn + node.linksOut > 0) continue;
    const key = node.tierPosition ?? 99;
    inBlock.set(key, (inBlock.get(key) ?? 0) + 1);
  }
  const lines = layout.groups.filter((group) => inBlock.has(group.key));
  const first = lines[0];
  const headers =
    first === undefined
      ? []
      : [
          { key: 'title', x: first.x, y: first.y - 30, text: words.blockTitle, strong: true },
          { key: 'room', x: first.x + 240, y: first.y, text: '', strong: false },
          ...lines.map((group) => ({
            key: String(group.key),
            x: group.x,
            y: group.y,
            text: words.blockLine(group.key, inBlock.get(group.key) ?? 0),
            strong: false,
          })),
        ];

  const points = [...shown.map((node) => spot(node.id)), ...headers.map((header) => [header.x, header.y] as const)];
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const span = {
    width: Math.max(1, Math.max(...xs, 0) - Math.min(...xs, 0)),
    height: Math.max(1, Math.max(...ys, 0) - Math.min(...ys, 0)),
  };
  const box = fitBox(span, input.width, input.height);
  // On a big canvas the pages lie further apart, so the dots and the names grow with it; on a small one they shrink
  const grow = Math.min(1.7, Math.max(0.55, box.width / span.width / PLAIN_SCALE));
  const blockNamed = view.zoom >= BLOCK_NAMES_FROM;
  // The halo behind a name is the canvas background, so a name stays readable across a link
  const halo = tokens.named?.('surface-subtle') ?? tokens.surfaceElevated;

  const data: Record<string, unknown>[] = shown.map((node) => {
    const [x, y] = spot(node.id);
    const style = styleOf.get(colour.keyOf(node)) ?? { color: tokens.other, outline: null };
    const lit = focus.lit === null || focus.lit.has(node.id);
    const selected = focus.selected === node.id;
    const links = node.linksIn + node.linksOut;
    return {
      name: node.id,
      x,
      y,
      // Bigger with more links, in or out, so the page a group gathers around stands out
      symbolSize: (7 + 2.6 * Math.sqrt(links)) * grow * (selected ? 1.3 : 1),
      z: selected ? 5 : lit && focus.lit !== null ? 4 : 2,
      itemStyle: {
        color: style.color,
        opacity: lit ? 1 : 0.13,
        borderColor: selected ? tokens.foreground : (style.outline ?? surface),
        borderWidth: selected ? 2.5 : 1,
      },
      label: {
        // In the block the dots stand too close for names: they come with a zoom, a search or a selection
        show: lit && (links > 0 || focus.lit !== null || blockNamed),
        formatter: node.name === '' ? words.home : node.name,
        color: selected || focus.lit !== null ? tokens.foreground : tokens.foregroundSecondary,
        fontWeight: selected ? 600 : 400,
      },
    };
  });
  for (const header of headers) {
    data.push({
      name: `${HEADER_PREFIX}${header.key}`,
      x: header.x - 5,
      y: header.y,
      symbolSize: 0.01,
      draggable: false,
      cursor: 'default',
      tooltip: { show: false },
      emphasis: { disabled: true },
      label: {
        show: true,
        formatter: header.text,
        color: header.strong ? tokens.foreground : tokens.foregroundSecondary,
        fontWeight: header.strong ? 600 : 400,
      },
    });
  }

  const line = tokens.named?.('foreground-tertiary') ?? tokens.foregroundMuted;
  const faint = { color: line, opacity: 0.05, width: 1 };
  const positive = tokens.named?.('chart-positive') ?? tokens.palette[2] ?? tokens.other;
  const links = graph.edges.flatMap((edge, index) => {
    if (!shownIds.has(edge.from) || !shownIds.has(edge.to)) return [];
    let lineStyle: Record<string, unknown> = { color: line, opacity: 0.32, width: 1 };
    if (focus.selected !== null) {
      if (edge.to === focus.selected) lineStyle = { color: positive, opacity: 1, ...IN_LINE };
      else if (edge.from === focus.selected) lineStyle = { color: tokens.palette[0], opacity: 0.95, width: 1.75 };
      else lineStyle = faint;
    } else if (focus.lit !== null && !(focus.lit.has(edge.from) && focus.lit.has(edge.to))) lineStyle = faint;
    return [{ source: edge.from, target: edge.to, edge: index, lineStyle }];
  });
  // Pointing at a page lights its links only while nothing else narrows the map, and never hides the rest
  const adjacency = focus.lit === null;
  return {
    animation: !input.reducedMotion,
    animationDuration: 0,
    animationDurationUpdate: 0,
    stateAnimation: { duration: 140, easing: 'cubicOut' },
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      confine: true,
      showDelay: 120,
      hideDelay: 0,
      transitionDuration: 0,
      backgroundColor: 'transparent',
      borderWidth: 0,
      padding: 0,
      extraCssText: 'box-shadow: none; pointer-events: none;',
      // Above the pointer, so the pages a page links with stay in sight
      position: (
        point: [number, number],
        _params: unknown,
        _dom: unknown,
        _rect: unknown,
        size: { contentSize: [number, number] },
      ) => [point[0] + 14, point[1] - size.contentSize[1] - 12],
      formatter: (params: { dataType?: string; name?: string; data?: { edge?: number } }) => {
        if (params.dataType === 'edge') {
          return params.data?.edge === undefined ? '' : input.tooltip({ edge: params.data.edge });
        }
        return params.name === undefined || params.name.startsWith(HEADER_PREFIX)
          ? ''
          : input.tooltip({ page: params.name });
      },
    },
    thumbnail: {
      show: input.minimap && view.zoom > MINIMAP_FROM,
      width: 176,
      height: 116,
      right: 12,
      bottom: 12,
      itemStyle: { color: halo, borderColor: tokens.border, borderWidth: 1 },
      windowStyle: {
        color: tokens.palette[0],
        borderColor: tokens.palette[0],
        borderWidth: 1,
        opacity: 0.14,
      },
    },
    series: [
      {
        type: 'graph',
        layout: 'none',
        roam: true,
        draggable: true,
        zoom: view.zoom,
        ...(view.center === null ? {} : { center: view.center }),
        scaleLimit: MAP_ZOOM,
        // Dots grow slower than the map when zooming in, so a dense group opens up
        nodeScaleRatio: 0.45,
        ...box,
        edgeSymbol: ['none', 'arrow'],
        edgeSymbolSize: 6 * grow,
        // A slight curve keeps a link and its return link apart
        lineStyle: { curveness: 0.14 },
        label: {
          position: 'right',
          distance: 4,
          textBorderColor: halo,
          textBorderWidth: 3,
          fontFamily: tokens.fontFamily,
          fontSize: grow > 1.25 ? 12 : grow < 0.8 ? 10 : 11,
        },
        // Names that would overlap give way to the bigger dot; zooming in makes room for more
        labelLayout: { hideOverlap: true },
        emphasis: {
          focus: adjacency ? 'adjacency' : 'none',
          scale: 1.2,
          label: { show: true, color: tokens.foreground },
          lineStyle: adjacency ? { width: 1.75, opacity: 0.95, color: tokens.palette[0] } : {},
        },
        blur: { itemStyle: { opacity: 0.4 }, lineStyle: { opacity: 0.1 }, label: { opacity: 0.35 } },
        data,
        links,
      },
    ],
  };
}
