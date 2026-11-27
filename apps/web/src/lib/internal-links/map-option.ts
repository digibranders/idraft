import type { MapFocus } from './map-focus';
import type { MapColour, MapColourGroup, MapGraph, MapNode } from './map-graph';
import { chooseNames, nameStep, nameWidth, NAME_STEPS, type NameCandidate, type TextObstacle } from './map-labels';
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
/** The zooms at which the picture changes by itself (the minimap, the set of names), so the canvas repaints at each. */
export const MAP_REPAINT_AT: readonly number[] = [MINIMAP_FROM, ...NAME_STEPS];
/** Names of the nodes that only carry the block's lines of text. */
export const HEADER_PREFIX = 'h:';

// Pixels of canvas per unit of the layout at which a dot has its plain size
const PLAIN_SCALE = 0.8;
/** The biggest a dot is drawn at 100 percent, so a hub of 200 links does not cover its neighbours. */
const DOT_MAX = 30;
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

/**
 * The box the map is drawn in: the canvas less the margins (room for the view controls below), centred, with the
 * map's own proportions. The map is never stretched: ECharts would draw every dot as an ellipse, so a dense map gets
 * its width from the layout instead (`layoutMap`).
 */
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

/** Where the data points of the map stand on the canvas: the box the canvas fits their bounding box into. */
export interface MapFrame {
  box: { left: number; top: number; width: number; height: number };
  minX: number;
  minY: number;
  /** Canvas pixels per unit of the layout, along each axis (the box may stretch the map). */
  sx: number;
  sy: number;
}

export function frameOf(points: readonly (readonly [number, number])[], width: number, height: number): MapFrame {
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const span = { width: Math.max(1, Math.max(...xs) - minX), height: Math.max(1, Math.max(...ys) - minY) };
  const box = fitBox(span, width, height);
  return { box, minX, minY, sx: box.width / span.width, sy: box.height / span.height };
}

export const canvasPoint = (frame: MapFrame, point: readonly [number, number]): [number, number] => [
  frame.box.left + (point[0] - frame.minX) * frame.sx,
  frame.box.top + (point[1] - frame.minY) * frame.sy,
];

/** How the links of the map are drawn when nothing is selected: they thin out as there are more of them to a canvas. */
export interface LineLook {
  opacity: number;
  width: number;
  /** Arrowheads on every link; off on a dense map, where they would only add to the grey. */
  arrows: boolean;
  curveness: number;
}

export function lineLook(edges: number, frame: MapFrame, zoom: number): LineLook {
  // Links per 100 by 100 pixels of the map in view: zooming in spreads the same links over more canvas
  const density = edges / ((frame.box.width * frame.box.height) / 10_000) / (zoom * zoom);
  return {
    opacity: Math.min(0.32, Math.max(0.1, 0.32 * (2.5 / Math.max(2.5, density)) ** 0.4)),
    width: density > 20 ? 0.8 : 1,
    arrows: density < 4,
    curveness: density > 20 ? 0.06 : 0.14,
  };
}

/** A colour at part of its strength. The tokens are opaque hex; anything else (no canvas to convert it) stays as it is. */
const withAlpha = (colour: string, alpha: number): string =>
  /^#[0-9a-f]{6}$/i.test(colour)
    ? `${colour}${Math.round(alpha * 255)
        .toString(16)
        .padStart(2, '0')}`
    : colour;

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
    if (node.degree > 0) continue;
    const key = node.tierPosition ?? 99;
    inBlock.set(key, (inBlock.get(key) ?? 0) + 1);
  }
  const lines = layout.groups.filter((group) => inBlock.has(group.key));
  const first = lines[0];
  const texts = [
    ...(first === undefined ? [] : [{ text: words.blockTitle, strong: true }]),
    ...lines.map((group) => ({ text: words.blockLine(group.key, inBlock.get(group.key) ?? 0), strong: false })),
  ];
  // The block's text is sized in pixels, not in units of the layout: the title stands a line clear of the first
  // group and the empty header at the right keeps the room the longest line needs, whatever the scale of the map.
  // The scale depends on the span they widen, so it is worked out twice.
  const textPx = Math.max(0, ...texts.map((item) => nameWidth(item.text, 11) * (item.strong ? 1.1 : 1))) + 12;
  const blockHeaders = (scale: { sx: number; sy: number } | null) =>
    first === undefined
      ? []
      : [
          {
            key: 'title',
            x: first.x,
            y: first.y - Math.max(30, scale === null ? 0 : 24 / scale.sy),
            text: words.blockTitle,
            strong: true,
          },
          {
            key: 'room',
            x: first.x + Math.max(240, scale === null ? 0 : textPx / scale.sx),
            y: first.y,
            text: '',
            strong: false,
          },
          ...lines.map((group) => ({
            key: String(group.key),
            x: group.x,
            y: group.y,
            text: words.blockLine(group.key, inBlock.get(group.key) ?? 0),
            strong: false,
          })),
        ];
  const framed = (headers: ReturnType<typeof blockHeaders>): MapFrame =>
    frameOf(
      [...shown.map((node) => spot(node.id)), ...headers.map((header) => [header.x, header.y] as const)],
      input.width,
      input.height,
    );
  const rough = framed(blockHeaders(null));
  const headers = blockHeaders(rough);
  const frame = framed(headers);
  const { box } = frame;
  // On a big canvas the pages lie further apart, so the dots and the names grow with it; on a small one they shrink
  const grow = Math.min(1.7, Math.max(0.55, Math.sqrt(frame.sx * frame.sy) / PLAIN_SCALE));
  // A dense map has small dots but not a small canvas: its names stay at 11 px, and shrink only on a phone
  const fontSize = grow > 1.25 ? 12 : input.width < 700 ? 10 : 11;
  const blockNamed = view.zoom >= BLOCK_NAMES_FROM;
  // The halo behind a name is the canvas background, so a name stays readable across a link
  const halo = tokens.named?.('surface-subtle') ?? tokens.surfaceElevated;

  const lit = (id: string): boolean => focus.lit === null || focus.lit.has(id);
  // Bigger with more links, in or out, so the page a group gathers around stands out; a hub stays a dot
  const sizeOf = (node: MapNode): number =>
    Math.min(DOT_MAX, 7 + 2.6 * Math.sqrt(node.degree)) * grow * (focus.selected === node.id ? 1.3 : 1);

  // The names: the selected page, then the pages with the most links, each kept only where it clears the others
  const ranked: NameCandidate[] = shown
    .filter((node) => lit(node.id) && (node.degree > 0 || focus.lit !== null || blockNamed))
    .sort(
      (a, b) =>
        Number(focus.selected === b.id) - Number(focus.selected === a.id) ||
        b.degree - a.degree ||
        (a.id < b.id ? -1 : 1),
    )
    .map((node) => {
      const [x, y] = canvasPoint(frame, spot(node.id));
      return { id: node.id, x, y, size: sizeOf(node), text: node.name === '' ? words.home : node.name };
    });
  const obstacles: TextObstacle[] = headers
    .filter((header) => header.text !== '')
    .map((header) => {
      const [x, y] = canvasPoint(frame, [header.x - 5, header.y]);
      return { x, y, width: nameWidth(header.text, fontSize) * (header.strong ? 1.1 : 1) + 4, height: fontSize + 4 };
    });
  // The dots of the block are obstacles too: a name never runs across a dot of a page with no link
  for (const node of shown) {
    if (node.degree > 0) continue;
    const [x, y] = canvasPoint(frame, spot(node.id));
    const size = sizeOf(node);
    obstacles.push({ x: x - size / 2, y: y - size / 2, width: size, height: size });
  }
  const named = chooseNames(ranked, { step: nameStep(view.zoom), fontSize, obstacles });

  const data: Record<string, unknown>[] = shown.map((node) => {
    const [x, y] = spot(node.id);
    const style = styleOf.get(colour.keyOf(node)) ?? { color: tokens.other, outline: null };
    const isLit = lit(node.id);
    const selected = focus.selected === node.id;
    return {
      name: node.id,
      x,
      y,
      symbolSize: sizeOf(node),
      z: selected ? 5 : isLit && focus.lit !== null ? 4 : 2,
      itemStyle: {
        color: style.color,
        opacity: isLit ? 1 : 0.13,
        borderColor: selected ? tokens.foreground : (style.outline ?? surface),
        borderWidth: selected ? 2.5 : 1,
      },
      label: {
        show: named.has(node.id),
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
  const look = lineLook(graph.edges.length, frame, view.zoom);
  const resting = { color: line, opacity: look.opacity, width: look.width };
  const faint = { color: line, opacity: Math.min(0.05, look.opacity), width: look.width };
  // Out links are the own brand (`chart-1`); the minimap window and the lit links under the pointer use the primary
  const brand = tokens.palette[0] ?? tokens.other;
  const primary = tokens.named?.('primary') ?? brand;
  const positive = tokens.named?.('chart-positive') ?? tokens.palette[2] ?? tokens.other;
  const arrow = { symbol: ['none', 'arrow'], symbolSize: 6 * grow };
  const links = graph.edges.flatMap((edge, index) => {
    if (!shownIds.has(edge.from) || !shownIds.has(edge.to)) return [];
    let lineStyle: Record<string, unknown> = resting;
    let more: Record<string, unknown> = {};
    if (focus.selected !== null) {
      // The links of the selected page keep their arrows and their direction, however dense the map is
      if (edge.to === focus.selected) {
        lineStyle = { color: positive, opacity: 1, ...IN_LINE };
        more = arrow;
      } else if (edge.from === focus.selected) {
        lineStyle = { color: brand, opacity: 0.95, width: 1.75 };
        more = arrow;
      } else lineStyle = faint;
    } else if (focus.lit !== null && !(focus.lit.has(edge.from) && focus.lit.has(edge.to))) lineStyle = faint;
    return [{ source: edge.from, target: edge.to, edge: index, lineStyle, ...more }];
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
        color: withAlpha(primary, 0.14),
        borderColor: primary,
        borderWidth: 1,
        opacity: 1,
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
        edgeSymbol: look.arrows ? ['none', 'arrow'] : ['none', 'none'],
        edgeSymbolSize: 6 * grow,
        // A slight curve keeps a link and its return link apart
        lineStyle: { curveness: look.curveness },
        label: {
          position: 'right',
          distance: 4,
          textBorderColor: halo,
          textBorderWidth: 3,
          fontFamily: tokens.fontFamily,
          fontSize,
        },
        // Names that would overlap give way to the bigger dot; zooming in makes room for more
        labelLayout: { hideOverlap: true },
        emphasis: {
          focus: adjacency ? 'adjacency' : 'none',
          scale: 1.2,
          label: { show: true, color: tokens.foreground },
          lineStyle: adjacency ? { width: 1.75, opacity: 0.95, color: primary } : {},
        },
        blur: { itemStyle: { opacity: 0.4 }, lineStyle: { opacity: 0.1 }, label: { opacity: 0.35 } },
        data,
        links,
      },
    ],
  };
}
