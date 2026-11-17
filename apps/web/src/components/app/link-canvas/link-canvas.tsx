'use client';

import { Crosshair } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  use,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  memo,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';

import { CanvasHelp } from './canvas-help';
import { CanvasViewport } from './canvas-viewport';
import { INFO_TOGGLE_ATTRIBUTE, type InfoFacts } from './info-panel';
import { LinkCard, type LinkCardPageProps } from './link-card';
import { Minimap, type MinimapCard } from './minimap';
import { SelectionBar } from './selection-bar';
import { useGrowth, type GrowthHandle } from './use-growth';
import { ViewControls } from './view-controls';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { announce } from '@/lib/a11y/announcer';
import { SingleKeysContext } from '@/lib/a11y/use-shortcut';
import {
  boxesIn,
  clampMove,
  keepOffsets,
  toggleSelected,
  withOffsets,
  withoutKeys,
  type Offset,
} from '@/lib/internal-links/canvas-selection';
import {
  MAX_SCALE,
  MIN_SCALE,
  centerOn,
  firstView,
  fitView,
  revealMinimum,
  stepZoom,
  tierFirstView,
  unionOf,
  zoomAt,
  type Size,
  type View,
} from '@/lib/internal-links/canvas-view';
import type { LayoutMode } from '@/lib/internal-links/journey-codec';
import {
  COLUMN_GAP,
  curvePath,
  directionLook,
  tierRoute,
  type DirectionTone,
} from '@/lib/internal-links/journey-curves';
import { edgeLook, returnArrowPath, type Box, type EdgeLook } from '@/lib/internal-links/journey-geometry';
import {
  FOCUS_KEY,
  isFull,
  type Direction,
  type JourneyItem,
  type JourneyLayout,
  type JourneyNeighbor,
  type ListRequest,
} from '@/lib/internal-links/journey-layout';
import { PLACEMENT_KEY, SCOPE_KEY } from '@/lib/internal-links/scopes';
import { tierLayout } from '@/lib/internal-links/tier-layout';
import { tierPosition, UNTIERED_POSITION, type TierNameLike } from '@/lib/internal-links/tiers';
import { cn } from '@/lib/utils';
/** The page the journey is centered on, from the inspector read of the feature. */
export interface CanvasFocus {
  urlId: string;
  path: string;
  title: string | null;
  tier: TierNameLike | null;
  linkingPages: number;
  linkingPagesAll: number;
  /** The links out of the page in the scope in view: the focus card's "N out". */
  linksOut: number;
  statusCode: number | null;
  clickDepth: number | null;
}

/** A tier of the workspace, for the lanes of the By tier layout. */
export interface LaneTier {
  position: number;
  code: string;
  name: string;
}

export interface LinkCanvasHandle {
  /** Everything in view (never past 100 percent). */
  fit: () => void;
  /** The focus page in the middle, at the current zoom. */
  centerFocus: () => void;
}

export interface LinkCanvasProps<N extends JourneyNeighbor> {
  layout: JourneyLayout<N>;
  focus: CanvasFocus;
  /** Lines under the focus card: "18 editorial links in.", the orphan and redirect notes. */
  focusNote?: ReactNode;
  /** Where the world is and how far it is zoomed; the host keeps it (the canvas sets a first view for each focus page). */
  view: View;
  onViewChange: (view: View) => void;
  /**
   * The host already holds a view of this focus page (a return to it, Back, the canvas shown again): the canvas then
   * sets no first view for it and leaves `view` as the person had it.
   */
  holdsView?: boolean | undefined;
  /** Cards whose return arrows stay drawn. */
  pinned: ReadonlySet<string>;
  onTogglePin: (key: string) => void;
  onToggleCard: (key: string) => void;
  onToggleGroup: (key: string) => void;
  onMore: (key: string) => void;
  onRefocus: (urlId: string) => void;
  onDetails: (urlId: string) => void;
  onRetry: (request: ListRequest) => void;
  /** Opening was refused: the canvas holds 300 cards. */
  onFull: () => void;
  /** The selection bar's "Show their links": the keys of the selected cards that have links to open (the host opens them together). */
  onShowLinks: (keys: readonly string[]) => void;
  /** The selected pages' url ids for the host's tier menu; leave it out for a person who cannot write, and the bar has no Set tier. */
  onSetTier?: ((urlIds: readonly string[]) => void) | undefined;
  /** By step (columns of clicks, the default) or By tier (one lane per tier). Only where the cards stand and how lines are coloured change. */
  layoutMode?: LayoutMode | undefined;
  /** The workspace's tiers, for the lanes (names and positions). */
  tiers?: readonly LaneTier[] | undefined;
  /** The lanes turned off, by tier position (99 is Untiered); the focus page's own lane stays on. */
  hiddenLanes?: ReadonlySet<number> | undefined;
  ref?: Ref<LinkCanvasHandle>;
}

const MIN_HEIGHT = 440;
/** Used before the region has been measured (and where there is no layout, as in tests). */
const DEFAULT_WIDTH = 1000;
/** A journey fits with more air than a free fit (review of the pure modules: 56, the default is 32). */
const JOURNEY_MARGIN = 56;
/** The margin a focused card is kept inside the view with. */
const REVEAL_MARGIN = 24;
/** The legend line and the page's bottom padding stay in view under the canvas. */
const BELOW = 72;
const FLASH_MS = 1500;
/** The back links a card's marker tooltip lists. */
const BACK_ROWS = 3;

/** What the tip of a line says: the anchor, the type of link and its attribute (spec 7.5 "Lines"). */
interface LineFacts {
  anchor: string | null;
  type: string;
  attribute: string;
}

/** How a line looks: the tones of By step, and the three directions of By tier. */
interface LineLook {
  tone: EdgeLook['tone'] | DirectionTone;
  dash: string | null;
  rank: 0 | 1 | 2;
}

interface DrawnEdge {
  id: string;
  d: string;
  look: LineLook;
  /** The dot at the source end, and where the arrowhead stands (lines only). */
  start: { x: number; y: number } | null;
  facts: LineFacts | null;
}

/** Pressing a card and moving less than this many pixels is a click, not a move. */
const DRAG_START = 5;
const NO_OFFSETS: ReadonlyMap<string, Offset> = new Map();
const NO_KEYS: ReadonlySet<string> = new Set();

const STROKE: Readonly<Record<LineLook['tone'], string>> = {
  editorial: 'stroke-foreground-tertiary',
  muted: 'stroke-border-strong',
  redirect: 'stroke-warning-text',
  broken: 'stroke-negative-text',
  // By tier: green up a tier, blue down a tier, grey dashed inside one (the mock's FLOW_UP and FLOW_DOWN)
  up: 'stroke-positive-text',
  down: 'stroke-info-text',
  side: 'stroke-foreground-tertiary',
};
const FILL: Readonly<Record<LineLook['tone'], string>> = {
  editorial: 'fill-foreground-tertiary',
  muted: 'fill-border-strong',
  redirect: 'fill-warning-text',
  broken: 'fill-negative-text',
  up: 'fill-positive-text',
  down: 'fill-info-text',
  side: 'fill-foreground-tertiary',
};
const TONES = Object.keys(STROKE) as readonly LineLook['tone'][];
const NO_TIERS: readonly LaneTier[] = [];
const NO_LANES: ReadonlySet<number> = new Set();

/** A By tier line's look: the direction colours it; amber and red win; a redirect or a broken target is drawn last. */
function tierLook(direction: Parameters<typeof directionLook>[0], status: number | null): LineLook {
  const look = directionLook(direction, status);
  const rank = look.tone === 'redirect' || look.tone === 'broken' ? 2 : look.tone === 'side' ? 0 : 1;
  return { ...look, rank };
}

/** How long an activated card may wait for the rebuild its activation causes (the host may answer after a request). */
const RESTORE_MS = 2000;

interface PendingRestore<N extends JourneyNeighbor> {
  /** The keys that can take focus back, the activated node first. */
  keys: readonly string[];
  /** The layout the activation happened on: focus returns once it is replaced. */
  layout: JourneyLayout<N>;
}

/** Remembers what should take focus after the next rebuild, and forgets it when no rebuild comes. */
function hold<N extends JourneyNeighbor>(
  ref: { current: PendingRestore<N> | null },
  keys: readonly string[],
  layout: JourneyLayout<N>,
): void {
  const entry = { keys, layout };
  ref.current = entry;
  window.setTimeout(() => {
    if (ref.current === entry) ref.current = null;
  }, RESTORE_MS);
}

interface DrawnEdges {
  lines: DrawnEdge[];
  arrows: DrawnEdge[];
  /** Every card in world coordinates: the map and the first view read them. */
  cards: MinimapCard[];
  width: number;
  height: number;
  /** What the drawing was made for: the layout and the focus page it measured. */
  layout: unknown;
  focusId: string | null;
  mode: LayoutMode;
}

/** A card's rectangle in world pixels from its offset geometry, which a zoom does not change (`root` is the world). */
function offsetBox(element: HTMLElement, root: HTMLElement): Box {
  let left = 0;
  let top = 0;
  let node: HTMLElement | null = element;
  while (node !== null && node !== root) {
    left += node.offsetLeft;
    top += node.offsetTop;
    node = node.offsetParent instanceof HTMLElement ? node.offsetParent : null;
  }
  return { left, top, width: element.offsetWidth, height: element.offsetHeight };
}

const focusVisible = (element: Element): boolean => {
  try {
    return element.matches(':focus-visible');
  } catch {
    return false;
  }
};

/** A function with one identity for the life of the component that always runs the latest one given. */
function useStable<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const latest = useRef(fn);
  useLayoutEffect(() => {
    latest.current = fn;
  });
  return useCallback((...args: A) => latest.current(...args), []);
}

const none = (): void => undefined;

/** The lines, dots and arrowheads, drawn again only when the drawing changes (a pan or a zoom leaves it alone). */
const EdgeLayer = memo(function EdgeLayer({
  edges,
  markerId,
  onLine,
  onLineLeave,
}: {
  edges: DrawnEdges;
  markerId: string;
  onLine: (id: string, event: PointerEvent<SVGPathElement>) => void;
  onLineLeave: () => void;
}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute top-0 left-0"
      width={edges.width}
      height={edges.height}
    >
      <defs>
        <marker id={markerId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M1 1L9 5L1 9z" className="fill-primary" />
        </marker>
        {/* Every curve arrives horizontally, so the arrowhead needs no more than orient auto */}
        {TONES.map((tone) => (
          <marker
            key={tone}
            id={`${markerId}-${tone}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
          >
            <path d="M1 1L9 5L1 9z" className={FILL[tone]} />
          </marker>
        ))}
      </defs>
      {edges.lines.map((line) => (
        <g key={line.id}>
          <path
            d={line.d}
            fill="none"
            strokeWidth={1.5}
            strokeDasharray={line.look.dash ?? undefined}
            markerEnd={`url(#${markerId}-${line.look.tone})`}
            className={STROKE[line.look.tone]}
          />
          {line.start === null ? null : (
            <circle cx={line.start.x} cy={line.start.y} r={3} className={FILL[line.look.tone]} />
          )}
          {line.facts === null ? null : (
            // A wide invisible stroke to hover: the line itself is 1.5 px
            <path
              d={line.d}
              data-line={line.id}
              fill="none"
              stroke="transparent"
              strokeWidth={12}
              pointerEvents="stroke"
              onPointerMove={(event) => onLine(line.id, event)}
              onPointerLeave={onLineLeave}
            />
          )}
        </g>
      ))}
      {edges.arrows.map((arrow) => (
        <path
          key={arrow.id}
          d={arrow.d}
          fill="none"
          strokeWidth={1.5}
          strokeDasharray="6 4"
          markerEnd={`url(#${markerId})`}
          className="stroke-primary"
        />
      ))}
    </svg>
  );
});

const sameEdges = (a: DrawnEdges, b: DrawnEdges): boolean =>
  a.layout === b.layout &&
  a.focusId === b.focusId &&
  a.mode === b.mode &&
  a.width === b.width &&
  a.height === b.height &&
  a.lines.length === b.lines.length &&
  a.arrows.length === b.arrows.length &&
  a.cards.length === b.cards.length &&
  a.lines.every((line, index) => line.id === b.lines[index]?.id && line.d === b.lines[index].d) &&
  a.arrows.every((arrow, index) => arrow.id === b.arrows[index]?.id && arrow.d === b.arrows[index].d) &&
  a.cards.every((card, index) => {
    const other = b.cards[index];
    return card.key === other?.key && card.left === other.left && card.top === other.top;
  });

function statusBadge(status: number | null, notCrawled: string): LinkCardPageProps['status'] {
  if (status === null) return { text: notCrawled, tone: 'neutral' };
  if (status === 200) return null;
  return { text: String(status), tone: status >= 400 ? 'negative' : 'warning' };
}

/**
 * The link journey canvas (spec 7.5, 25 section 14.17): the focus in the middle column, links out to the right and
 * links in to the left, one column a step; elbow edges on a shared spine, return arrows for back links on hover,
 * focus or pin. Cards are buttons in reading order with the keyboard model of 20-accessibility.md section 7.1.
 */
export function LinkCanvas<N extends JourneyNeighbor>({
  layout,
  focus,
  focusNote,
  view,
  onViewChange,
  holdsView = false,
  pinned,
  onTogglePin,
  onToggleCard,
  onToggleGroup,
  onMore,
  onRefocus,
  onDetails,
  onRetry,
  onFull,
  onShowLinks,
  onSetTier,
  layoutMode = 'step',
  tiers = NO_TIERS,
  hiddenLanes = NO_LANES,
  ref,
}: LinkCanvasProps<N>): ReactElement {
  const t = useTranslations('linkCanvas');
  const singleKeys = use(SingleKeysContext);
  const markerId = useId();
  const helpId = useId();
  const scroller = useRef<HTMLDivElement>(null);
  // The focus page the first view was last set for: one first view per focus page
  const firstFor = useRef<string | null>(null);
  // How the last input reached the canvas: only the keyboard pans a focused card into view
  const modality = useRef<'keyboard' | 'pointer'>('keyboard');
  const inner = useRef<HTMLDivElement>(null);
  // The growth handle, for the drawing of the lines (which reads where gliding cards are) made before the hook runs
  const growthRef = useRef<GrowthHandle | null>(null);
  // The card that was activated, the keys that can take focus back (itself, then what it hung under), the layout it
  // was activated on and when: focus returns once the layout is rebuilt, and not for a zoom or a hover
  const restore = useRef<PendingRestore<N> | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [flashKey, setFlashKey] = useState<string | null>(null);
  // One tab stop for the whole canvas: the card that last had focus (the focus page at first)
  const [activeKey, setActiveKey] = useState(FOCUS_KEY);
  const [edges, setEdges] = useState<DrawnEdges>({
    lines: [],
    arrows: [],
    cards: [],
    width: 0,
    height: 0,
    layout: null,
    focusId: null,
    mode: 'step',
  });
  const [height, setHeight] = useState(MIN_HEIGHT + 120);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  // The map is off until its button is pressed (owner decision, 2026-11-17)
  const [minimap, setMinimap] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // The selected cards, and where cards were moved to (kept for each focus page for as long as the canvas lives)
  const [selection, setSelection] = useState<{ focus: string; keys: ReadonlySet<string> }>({
    focus: focus.urlId,
    keys: NO_KEYS,
  });
  const [moved, setMoved] = useState<ReadonlyMap<string, ReadonlyMap<string, Offset>>>(new Map());
  const storedOffsets = moved.get(focus.urlId) ?? NO_OFFSETS;
  // The card whose info panel is open; it closes when the view pans or zooms or the focus page changes
  const [infoAt, setInfoAt] = useState<{ key: string; focus: string; view: View } | null>(null);
  const infoKey =
    infoAt !== null &&
    infoAt.focus === focus.urlId &&
    infoAt.view.x === view.x &&
    infoAt.view.y === view.y &&
    infoAt.view.scale === view.scale
      ? infoAt.key
      : null;
  const [lineTip, setLineTip] = useState<{ id: string; x: number; y: number } | null>(null);
  const viewNow = useRef(view);
  const marquee = useRef<HTMLDivElement>(null);
  // A move just ended: the click that follows it must not open the card
  const suppressClick = useRef(false);
  const stopDrag = useRef<(() => void) | null>(null);
  const size = useMemo<Size>(() => ({ width, height }), [width, height]);
  useLayoutEffect(() => {
    viewNow.current = view;
  });
  useEffect(
    () => () => {
      stopDrag.current?.();
    },
    [],
  );

  const tierText = useCallback((tier: TierNameLike | null): string => tier?.code ?? t('untiered'), [t]);
  const tierLong = useCallback(
    (tier: TierNameLike | null): string => (tier === null ? t('untiered') : `${tier.code} ${tier.name}`),
    [t],
  );

  // By tier: the lanes, the cards in them (a page once) and every line, from the same layout By step reads
  const focusPosition = tierPosition(focus.tier);
  const tiered = useMemo(
    () =>
      layoutMode === 'tier'
        ? tierLayout({
            layout,
            focus: { urlId: focus.urlId, position: focusPosition, statusCode: focus.statusCode },
            tiers: tiers.map((tier) => tier.position),
            hidden: hiddenLanes,
          })
        : null,
    [layoutMode, layout, focus.urlId, focusPosition, focus.statusCode, tiers, hiddenLanes],
  );

  // Every keyed item, the paths by url id (for the column heads), and the cards whose back links show
  const { byKey, pathOf, stops, hasFailed } = useMemo(() => {
    const keyed = new Map<string, Extract<JourneyItem<N>, { kind: 'card' | 'stub' | 'group' }>>();
    const paths = new Map<string, string>([[focus.urlId, focus.path]]);
    // Every node that can hold the one tab stop: the focus card, cards, stubs, groups and "+N more"
    const nodeKeys = new Set<string>([FOCUS_KEY]);
    let failed = false;
    for (const column of [...layout.out, ...layout.in]) {
      for (const item of column.items) {
        if (item.kind === 'card' || item.kind === 'stub' || item.kind === 'group') keyed.set(item.key, item);
        if (item.kind === 'card' || item.kind === 'stub') paths.set(item.urlId, item.node.path);
        if (item.kind === 'card' || item.kind === 'stub' || item.kind === 'group' || item.kind === 'more') {
          nodeKeys.add(item.key);
        }
        if (item.kind === 'failed') failed = true;
      }
    }
    // By tier shows a page once and no stubs: only what is on the canvas can hold the tab stop
    if (tiered !== null) {
      nodeKeys.clear();
      nodeKeys.add(FOCUS_KEY);
      for (const cards of tiered.cardsByLane.values()) for (const card of cards) nodeKeys.add(card.key);
      for (const extras of tiered.extrasByLane.values()) {
        for (const extra of extras) if (extra.kind === 'group' || extra.kind === 'more') nodeKeys.add(extra.key);
      }
    }
    return { byKey: keyed, pathOf: paths, stops: nodeKeys, hasFailed: failed };
  }, [layout, focus.urlId, focus.path, tiered]);
  // The tab stop stays where focus last was; when that node is gone it falls back to the focus page
  const tabKey = stops.has(activeKey) ? activeKey : FOCUS_KEY;
  // Page cards can be selected and moved (stubs, groups and "+N more" are not pages to act on)
  const selectable = useMemo(() => {
    const keys = new Set<string>([FOCUS_KEY]);
    for (const [key, item] of byKey) if (item.kind === 'card') keys.add(key);
    return keys;
  }, [byKey]);
  // A selection belongs to its focus page, and loses the cards that are no longer on the canvas
  const selected = useMemo(
    () => (selection.focus === focus.urlId ? withoutKeys(selection.keys, selectable) : NO_KEYS),
    [selection, focus.urlId, selectable],
  );
  // The positions of the cards that are still on the canvas
  const offsets = useMemo(() => keepOffsets(storedOffsets, selectable), [storedOffsets, selectable]);
  // A card that left the canvas is forgotten for good (state follows what is shown), so one that comes back is new:
  // not selected, not moved, and Reset card positions is off when nothing that is shown was moved
  if (selection.focus !== focus.urlId || selection.keys !== selected)
    setSelection({ focus: focus.urlId, keys: selected });
  if (offsets !== storedOffsets) {
    setMoved((current) => {
      const next = new Map(current);
      if (offsets.size === 0) next.delete(focus.urlId);
      else next.set(focus.urlId, offsets);
      return next;
    });
  }

  // A failed list is spoken once through the app's live region, not by a region of the canvas (20 section 10.1)
  useEffect(() => {
    if (hasFailed) announce(t('failed'), { politeness: 'assertive', key: 'link-canvas-failed' });
  }, [hasFailed, t]);
  const shownBacks = useMemo(() => {
    const keys = new Set(pinned);
    if (hoverKey !== null) keys.add(hoverKey);
    return keys;
  }, [pinned, hoverKey]);
  const highlighted = useMemo(() => {
    const keys = new Set<string>();
    for (const key of shownBacks) {
      const item = byKey.get(key);
      // A page that is one card in By tier: its earlier card is the one on the canvas
      if (item?.kind === 'card') for (const back of item.backs) keys.add(tiered?.alias.get(back.key) ?? back.key);
    }
    if (flashKey !== null) keys.add(flashKey);
    return keys;
  }, [shownBacks, byKey, flashKey, tiered]);

  // Edges are measured from the cards as laid out, in world pixels, from offset geometry: a zoom or a pan changes none
  // of it, so they are not measured again for either
  const draw = useCallback((): void => {
    const root = inner.current;
    if (root === null) return;
    const elements = new Map<string, HTMLElement>();
    for (const element of root.querySelectorAll<HTMLElement>('[data-node]')) {
      const key = element.getAttribute('data-key');
      if (key !== null) elements.set(key, element);
    }
    // A moved card is drawn by a transform, and a gliding one by an animation: offset geometry sees neither, so the
    // offset and the glide are added here (the lines follow the cards frame by frame)
    const boxOf = (key: string): Box | null => {
      const element = elements.get(key);
      if (element === undefined) return null;
      const box = offsetBox(element, root);
      const moved = offsets.get(key);
      const glide = growthRef.current?.shiftOf(key) ?? null;
      const dx = (moved?.dx ?? 0) + (glide?.dx ?? 0);
      const dy = (moved?.dy ?? 0) + (glide?.dy ?? 0);
      return dx === 0 && dy === 0 ? box : { ...box, left: box.left + dx, top: box.top + dy };
    };
    const cards: MinimapCard[] = [];
    for (const key of elements.keys()) {
      const box = boxOf(key);
      if (box !== null) cards.push({ key, ...box });
    }
    const statusOf = (key: string): number | null => {
      if (key === FOCUS_KEY) return focus.statusCode;
      const item = byKey.get(key);
      return item?.kind === 'card' || item?.kind === 'stub' ? item.node.status_code : null;
    };
    // Curves leaving one card lean apart (the fan), so each needs its place among the children of its parent
    const children = new Map<string, number>();
    for (const item of byKey.values()) children.set(item.parentKey, (children.get(item.parentKey) ?? 0) + 1);
    const placed = new Map<string, number>();
    const lines: DrawnEdge[] = [];
    const lineFactsOf = (node: N): LineFacts => ({
      anchor: node.anchor,
      type: node.placement === null ? t('redirectTarget') : t(`placement.${PLACEMENT_KEY[node.placement]}`),
      attribute: node.rel.length === 0 ? t('follow') : node.rel.join(' '),
    });
    if (tiered !== null) {
      // By tier: every link between cards on the canvas, from lane to lane (a page reached twice is two lines)
      for (const line of tiered.lines) {
        const index = placed.get(line.from) ?? 0;
        placed.set(line.from, index + 1);
        const from = boxOf(line.from);
        const to = boxOf(line.to);
        if (from === null || to === null) continue;
        const drawn = tierRoute(from, to, index);
        const look = tierLook(line.direction, line.status);
        lines.push({
          id: `${line.from}>${line.to}`,
          d: drawn.d,
          look,
          start: drawn.start,
          facts: line.link === null ? null : lineFactsOf(line.link),
        });
      }
    } else {
      for (const [key, item] of byKey) {
        const index = placed.get(item.parentKey) ?? 0;
        placed.set(item.parentKey, index + 1);
        const parent = boxOf(item.parentKey);
        const child = boxOf(key);
        if (parent === null || child === null) continue;
        const inbound = item.dir === 'in';
        const look =
          item.kind === 'group'
            ? edgeLook(item.scope === 'both' ? null : item.scope, null)
            : edgeLook(item.node.scope, inbound ? statusOf(item.parentKey) : item.node.status_code);
        const drawn = inbound
          ? curvePath(child, parent, index, children.get(item.parentKey))
          : curvePath(parent, child, index, children.get(item.parentKey));
        lines.push({
          id: key,
          d: drawn.d,
          look,
          start: drawn.start,
          facts: item.kind === 'card' ? lineFactsOf(item.node) : null,
        });
      }
    }
    lines.sort((a, b) => a.look.rank - b.look.rank);
    const arrows: DrawnEdge[] = [];
    for (const key of shownBacks) {
      const item = byKey.get(key);
      const from = boxOf(key);
      if (item?.kind !== 'card' || from === null) continue;
      for (const back of item.backs) {
        const to = boxOf(tiered?.alias.get(back.key) ?? back.key);
        if (to === null) continue;
        const d = item.dir === 'out' ? returnArrowPath(from, to) : returnArrowPath(to, from);
        arrows.push({
          id: `${key}>${back.key}`,
          d,
          look: { tone: 'editorial', dash: '6 4', rank: 2 },
          start: null,
          facts: null,
        });
      }
    }
    // The size of the columns (offset size, in world pixels), not the scroll size: the SVG layer must not hold the area open
    const next: DrawnEdges = {
      lines,
      arrows,
      cards,
      width: root.offsetWidth,
      height: root.offsetHeight,
      layout,
      focusId: focus.urlId,
      mode: layoutMode,
    };
    // A hover or a pin that changes nothing on screen must not render the canvas again
    setEdges((current) => (sameEdges(current, next) ? current : next));
  }, [byKey, shownBacks, layout, focus.urlId, focus.statusCode, offsets, t, tiered, layoutMode]);

  useLayoutEffect(() => {
    draw();
  }, [draw]);

  // Where every card stands, in world pixels, with the place the person moved it to (a glide is not in it: that is a
  // card's settled place)
  const measureCards = (): Map<string, Box> => {
    const boxes = new Map<string, Box>();
    const root = inner.current;
    if (root === null) return boxes;
    for (const element of root.querySelectorAll<HTMLElement>('[data-node][data-key]')) {
      const key = element.dataset.key;
      if (key === undefined) continue;
      const box = offsetBox(element, root);
      const moved = offsets.get(key);
      boxes.set(key, moved === undefined ? box : { ...box, left: box.left + moved.dx, top: box.top + moved.dy });
    }
    return boxes;
  };
  // After the drawing above, so that a growth's first frame is the last word on where the lines go
  const growth = useGrowth({
    root: inner,
    layout,
    settled: !layout.pending,
    measure: useStable(measureCards),
    getView: useStable(() => viewNow.current),
    size,
    onViewChange,
    onFrame: useStable(draw),
  });
  useLayoutEffect(() => {
    growthRef.current = growth;
  });

  // Focus survives a rebuild: the card that was activated takes it back, or the card it hung under when it is gone
  // (a "+N more" that showed the last pages, a card that closed with its parent)
  useLayoutEffect(() => {
    const pending = restore.current;
    if (pending === null) return;
    if (pending.layout === layout) return;
    restore.current = null;
    const nodes = [...(inner.current?.querySelectorAll<HTMLElement>('[data-node]') ?? [])];
    for (const key of pending.keys) {
      const target = nodes.find((element) => element.dataset.key === key);
      if (target !== undefined) {
        target.focus({ preventScroll: true });
        return;
      }
    }
  }, [layout]);

  useEffect(() => {
    const root = inner.current;
    if (root === null || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => draw());
    observer.observe(root);
    return () => observer.disconnect();
  }, [draw]);

  // The canvas takes the rest of the window below its top, so a tall window shows more of the journey
  useLayoutEffect(() => {
    const measure = (): void => {
      const top = scroller.current?.getBoundingClientRect().top ?? 0;
      setHeight(Math.max(MIN_HEIGHT, Math.round(window.innerHeight - top - BELOW)));
      setWidth(scroller.current?.clientWidth || DEFAULT_WIDTH);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const content = useMemo<Box>(
    () => ({ left: 0, top: 0, width: edges.width, height: edges.height }),
    [edges.width, edges.height],
  );
  const nodesOf = (): HTMLElement[] => [...(inner.current?.querySelectorAll<HTMLElement>('[data-node]') ?? [])];
  // A card's place now, read from the page (a card that just opened is not in the last drawing)
  const boxOfKey = (key: string): Box | undefined => {
    const root = inner.current;
    const element = nodesOf().find((candidate) => candidate.dataset.key === key);
    if (root === null || element === undefined) return undefined;
    // Measured now, plus where the person moved the card to (offset geometry does not see the transform)
    const box = offsetBox(element, root);
    const shift = offsets.get(key);
    return shift === undefined ? box : { ...box, left: box.left + shift.dx, top: box.top + shift.dy };
  };
  const fit = (): void => onViewChange(fitView(content, size, JOURNEY_MARGIN));
  const centerFocus = (): void => {
    const box = boxOfKey(FOCUS_KEY);
    if (box !== undefined) onViewChange(centerOn(view, box, size));
  };

  // The first view of each focus page, once the journey has a size and no list is still loading (spec 7.5 "First view")
  useEffect(() => {
    // One first view for each focus page and layout: switching the layout is a new picture, and is fitted again
    const first = `${focus.urlId}|${layoutMode}`;
    if (firstFor.current === first) return;
    // The host holds the person's own view of this page: it is not replaced (a layout switch later on does replace it)
    if (holdsView && firstFor.current?.startsWith(`${focus.urlId}|`) !== true) {
      firstFor.current = first;
      return;
    }
    if (layout.pending || edges.width === 0) return;
    // The drawing must be of this journey and layout: right after a refocus it can still be the last page's
    if (edges.layout !== layout || edges.focusId !== focus.urlId || edges.mode !== layoutMode) return;
    const box = edges.cards.find((card) => card.key === FOCUS_KEY);
    if (box === undefined) return;
    firstFor.current = first;
    if (layoutMode === 'tier') {
      // The lanes nearest T1 are the last in the row
      const root = inner.current;
      const lanes = [...(root?.querySelectorAll<HTMLElement>('[data-lane]') ?? [])].slice(-2);
      const near = root === null ? content : unionOf(lanes.map((lane) => offsetBox(lane, root)));
      onViewChange(tierFirstView(content, lanes.length === 0 ? content : near, size, JOURNEY_MARGIN));
      return;
    }
    onViewChange(firstView(content, box, size, JOURNEY_MARGIN));
  }, [layout, layoutMode, edges, content, size, focus.urlId, holdsView, onViewChange]);

  useEffect(() => {
    if (flashKey === null) return undefined;
    const timer = window.setTimeout(() => setFlashKey(null), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [flashKey]);

  useImperativeHandle(ref, () => ({ fit, centerFocus }));

  const focusKey = (key: string): void => {
    for (const element of nodesOf()) if (element.dataset.key === key) element.focus();
  };

  // Closed from the keyboard or the close button: focus goes back to the card's Info button, which opened the panel
  const closeInfo = useStable((key: string, restoreFocus: boolean): void => {
    setInfoAt(null);
    if (!restoreFocus) return;
    const element = nodesOf().find((candidate) => candidate.dataset.key === key);
    element?.closest('.group')?.querySelector<HTMLElement>(`[${INFO_TOGGLE_ATTRIBUTE}]`)?.focus();
  });

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    // Alt and Command with an arrow are the browser's history keys, Control and Command with F are find: not ours
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const current = event.currentTarget;
    const nodes = nodesOf();
    const column = Number(current.dataset.col);
    const topOf = (element: HTMLElement): number => element.getBoundingClientRect().top;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const step = event.key === 'ArrowRight' ? 1 : -1;
      const columns = [...new Set(nodes.map((element) => Number(element.dataset.col)))].sort((a, b) => a - b);
      const ahead =
        step > 0 ? columns.filter((value) => value > column) : columns.filter((value) => value < column).reverse();
      const target = ahead[0];
      if (target === undefined) return;
      const here = nodes.filter((element) => Number(element.dataset.col) === target);
      const nearest = here.reduce<HTMLElement | null>(
        (best, element) =>
          best === null || Math.abs(topOf(element) - topOf(current)) < Math.abs(topOf(best) - topOf(current))
            ? element
            : best,
        null,
      );
      if (nearest === null) return;
      event.preventDefault();
      nearest.focus();
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const same = nodes.filter((element) => Number(element.dataset.col) === column);
      const next = same[same.indexOf(current) + (event.key === 'ArrowDown' ? 1 : -1)];
      if (next === undefined) return;
      event.preventDefault();
      next.focus();
    } else if ((event.key === 'f' || event.key === 'F') && singleKeys && !event.nativeEvent.isComposing) {
      event.preventDefault();
      const urlId = current.dataset.url;
      if (urlId !== undefined && urlId !== focus.urlId && current.dataset.kind === 'card') onRefocus(urlId);
      else {
        const box = boxOfKey(current.dataset.key ?? '');
        if (box !== undefined) onViewChange(centerOn(view, box, size));
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      // An open info panel takes this Escape; then the selection goes; with none, Escape returns to the focus card
      if (infoKey !== null) closeInfo(infoKey, true);
      else if (selected.size > 0) changeSelection(NO_KEYS);
      else focusKey(FOCUS_KEY);
    }
  };

  const findOriginal = (urlId: string): void => {
    const original = nodesOf().find((element) => element.dataset.kind === 'card' && element.dataset.url === urlId);
    if (original === undefined) return;
    original.focus({ preventScroll: true });
    setFlashKey(original.dataset.key ?? null);
    // The press that asked for it may have been the mouse's, which does not pan on focus: pan to it here
    const box = boxOfKey(original.dataset.key ?? '');
    if (box === undefined) return;
    const next = revealMinimum(view, box, size, REVEAL_MARGIN);
    if (next !== view) onViewChange(next);
  };

  /** `under` is the card the activated one hangs under: where focus goes when the activated one is gone afterwards. */
  const opening = (open: boolean, run: () => void, key: string, under: string): void => {
    if (!open && isFull(layout)) {
      onFull();
      return;
    }
    hold(restore, [key, under, FOCUS_KEY], layout);
    // The pressed card keeps its place on the screen; a "+N more" goes with the press, so the card it hangs under keeps it
    growth.begin(byKey.has(key) ? key : under);
    run();
  };

  // One function each for every card, so a card that did not change is not drawn again when the canvas pans or zooms
  const changeSelection = (next: ReadonlySet<string>): void => {
    setSelection({ focus: focus.urlId, keys: next });
    announce(next.size === 0 ? t('selection.cleared') : t('selection.count', { count: next.size }), {
      key: 'link-canvas-selection',
      debounceMs: 300,
    });
  };
  const activate = useStable((key: string, modified: boolean): void => {
    // The click that ends a move is not a press on the card
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    // Shift, Cmd or Ctrl and press adds a page card to the selection, or takes it away
    if (modified && selectable.has(key)) {
      changeSelection(toggleSelected(selected, key));
      return;
    }
    const item = byKey.get(key);
    if (item?.kind === 'group') opening(item.open, () => onToggleGroup(key), key, item.parentKey);
    else if (item?.kind === 'stub') findOriginal(item.urlId);
    else if (item?.kind === 'card' && item.canOpen) opening(item.open, () => onToggleCard(key), key, item.parentKey);
  });
  const toolRefocus = useStable((urlId: string): void => onRefocus(urlId));
  const toolDetails = useStable((urlId: string): void => onDetails(urlId));
  const togglePin = useStable((key: string): void => onTogglePin(key));
  const showBack = useStable((key: string, shown: boolean): void => setHoverKey(shown ? key : null));
  const cardKeyDown = useStable(onKeyDown);
  const toggleInfo = useStable((key: string): void =>
    setInfoAt((current) =>
      current?.key === key && current.focus === focus.urlId ? null : { key, focus: focus.urlId, view: viewNow.current },
    ),
  );

  // Moving a card: press, move past a few pixels, and the card (and the selection it is in) follows the pointer
  const dragStart = useStable((key: string, event: PointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0 || event.pointerType === 'touch' || event.shiftKey || event.metaKey || event.ctrlKey) return;
    if (!selectable.has(key)) return;
    stopDrag.current?.();
    const keys = selected.has(key) && selected.size > 1 ? [...selected] : [key];
    const target = event.currentTarget;
    const id = event.pointerId;
    const from = { x: event.clientX, y: event.clientY };
    const base = offsets;
    const focusId = focus.urlId;
    // The zoom the move started at: zooming during it does not rescale the distance already moved
    const scale = viewNow.current.scale;
    // Where the layout puts each moved card, and how big the content is: a move is held inside the content
    const root = inner.current;
    const limits = new Map<string, Box>();
    if (root !== null) {
      for (const element of nodesOf()) {
        const nodeKey = element.dataset.key;
        if (nodeKey !== undefined && keys.includes(nodeKey)) limits.set(nodeKey, offsetBox(element, root));
      }
    }
    const room = { width: root?.offsetWidth ?? 0, height: root?.offsetHeight ?? 0 };
    let started = false;
    let cancelled = false;
    let frame: number | null = null;
    // The last distance the pointer went (screen pixels), applied once a frame
    let latest = { dx: 0, dy: 0 };
    const apply = (positions: ReadonlyMap<string, Offset>): void =>
      setMoved((current) => new Map(current).set(focusId, positions));
    const flush = (): void => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      const held = clampMove(limits, base, room, latest.dx / scale, latest.dy / scale);
      apply(withOffsets(base, keys, held.dx, held.dy));
    };
    const onMove = (move: globalThis.PointerEvent): void => {
      if (move.pointerId !== id) return;
      latest = { dx: move.clientX - from.x, dy: move.clientY - from.y };
      if (!started) {
        if (Math.hypot(latest.dx, latest.dy) < DRAG_START) return;
        started = true;
        target.setPointerCapture?.(id);
      }
      frame ??= requestAnimationFrame(() => {
        frame = null;
        flush();
      });
    };
    // Escape puts the cards back where they were (a drag has this way out that is not a drag)
    const onKey = (press: globalThis.KeyboardEvent): void => {
      if (press.key !== 'Escape' || !started) return;
      press.preventDefault();
      press.stopPropagation();
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      apply(base);
      cancelled = true;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('keydown', onKey, true);
    };
    const stop = (): void => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onEnd);
      document.removeEventListener('pointercancel', onEnd);
      document.removeEventListener('keydown', onKey, true);
      stopDrag.current = null;
    };
    function onEnd(end: globalThis.PointerEvent): void {
      if (end.pointerId !== id) return;
      // The last position is the card's, whether the pointer was lifted or the system took it away
      if (started && !cancelled) flush();
      stop();
      if (!started) return;
      // The click that follows the release must not open the card
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    }
    stopDrag.current = stop;
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onEnd);
    document.addEventListener('pointercancel', onEnd);
    document.addEventListener('keydown', onKey, true);
  });

  // Shift and drag on the empty background draws a box; the cards it touches join the selection
  const finishBox = useStable((area: Box): void => {
    if (area.width < 3 && area.height < 3) return;
    const boxes = new Map(edges.cards.filter((card) => selectable.has(card.key)).map((card) => [card.key, card]));
    const found = boxesIn(boxes, area);
    if (found.length > 0) changeSelection(new Set([...selected, ...found]));
  });
  const backgroundPress = useStable((event: PointerEvent<HTMLDivElement>): boolean => {
    const holder = scroller.current;
    if (!event.shiftKey || holder === null || event.button !== 0) return false;
    event.preventDefault();
    const region = event.currentTarget;
    const id = event.pointerId;
    region.setPointerCapture?.(id);
    const rect = holder.getBoundingClientRect();
    const from = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const box = marquee.current;
    const draw = (x: number, y: number): void => {
      if (box === null) return;
      box.hidden = false;
      box.style.left = `${String(Math.min(from.x, x))}px`;
      box.style.top = `${String(Math.min(from.y, y))}px`;
      box.style.width = `${String(Math.abs(x - from.x))}px`;
      box.style.height = `${String(Math.abs(y - from.y))}px`;
    };
    const onMove = (move: globalThis.PointerEvent): void => {
      if (move.pointerId === id) draw(move.clientX - rect.left, move.clientY - rect.top);
    };
    const onUp = (up: globalThis.PointerEvent): void => {
      if (up.pointerId !== id) return;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      if (box !== null) box.hidden = true;
      if (up.type === 'pointercancel') return;
      const to = { x: up.clientX - rect.left, y: up.clientY - rect.top };
      const now = viewNow.current;
      finishBox({
        left: (Math.min(from.x, to.x) - now.x) / now.scale,
        top: (Math.min(from.y, to.y) - now.y) / now.scale,
        width: Math.abs(to.x - from.x) / now.scale,
        height: Math.abs(to.y - from.y) / now.scale,
      });
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    return true;
  });

  const showLine = useStable((id: string, event: PointerEvent<SVGPathElement>): void => {
    const rect = scroller.current?.getBoundingClientRect();
    setLineTip({ id, x: event.clientX - (rect?.left ?? 0) + 12, y: event.clientY - (rect?.top ?? 0) + 12 });
  });
  const hideLine = useStable((): void => setLineTip(null));

  const showTheirLinks = (): void => {
    // Only a card that has links to open and is not open yet has anything to show
    const keys = [...selected].filter((key) => {
      const item = byKey.get(key);
      return item?.kind === 'card' && item.canOpen && !item.open;
    });
    if (keys.length === 0) {
      announce(t('selection.nothingToShow'));
      return;
    }
    onShowLinks(keys);
  };
  const setTierOfSelection = (): void => {
    const ids = new Set<string>();
    for (const key of selected) {
      const item = byKey.get(key);
      const urlId = key === FOCUS_KEY ? focus.urlId : item?.kind === 'card' ? item.urlId : null;
      if (urlId !== null) ids.add(urlId);
    }
    onSetTier?.([...ids]);
  };
  const resetPositions = (): void => {
    setMoved((current) => {
      const next = new Map(current);
      next.delete(focus.urlId);
      return next;
    });
    announce(t('positionsReset'));
  };

  const linkedAs = (node: N): string => {
    if (node.anchor === null) return node.title ?? '';
    if (node.scope === null || node.scope === 'editorial') return node.anchor;
    return t('linkedAs', { scope: t(`scope.${SCOPE_KEY[node.scope]}`), anchor: node.anchor });
  };
  const placementWord = (node: N): string =>
    node.placement === null ? t('redirectTarget') : t(`placement.${PLACEMENT_KEY[node.placement]}`);

  const renderItem = (item: JourneyItem<N>, column: number, heads: number): ReactNode => {
    switch (item.kind) {
      case 'head':
        return heads > 1 ? (
          <p key={`head-${item.parentKey}`} className="truncate type-meta text-foreground-tertiary">
            {t(column > layout.in.length ? 'from' : 'into', { path: pathOf.get(item.urlId) ?? '' })}
          </p>
        ) : null;
      case 'tierhead':
        return (
          <p key={`tier-${item.tier?.code ?? 'none'}`} className="type-label text-foreground-tertiary">
            {t('tierHead', { tier: tierText(item.tier), count: item.count })}
          </p>
        );
      case 'loading':
        // The text is for screen readers (17 section 3); the live announcement of a failure comes from `announce`
        return (
          <div key={item.key} aria-busy="true">
            <Skeleton shape="block" height="row" />
            <span className="sr-only">{t('loading')}</span>
          </div>
        );
      case 'failed':
        return (
          <div
            key={item.key}
            className="flex flex-col items-start gap-1 rounded-md border border-border-subtle bg-surface p-2"
          >
            <p className="type-meta text-foreground-secondary">{t('failed')}</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                // The retry button goes while the list loads: focus returns to the card the list hangs under
                hold(restore, [item.parentKey, FOCUS_KEY], layout);
                onRetry(item.request);
              }}
            >
              {t('retry')}
            </Button>
          </div>
        );
      case 'more':
        return (
          <Button
            key={item.key}
            variant="secondary"
            size="sm"
            data-node=""
            data-key={item.key}
            data-kind="more"
            data-col={String(column)}
            tabIndex={item.key === tabKey ? 0 : -1}
            aria-label={t('moreName', { count: item.count })}
            onKeyDown={onKeyDown}
            onClick={() => opening(false, () => onMore(item.key), item.key, item.parentKey)}
          >
            {t('more', { count: item.count })}
          </Button>
        );
      case 'group': {
        const label =
          item.scope === 'both'
            ? t('groupBoth', { count: item.count })
            : item.scope === 'auto_generated'
              ? t('groupAutoGenerated', { count: item.count })
              : item.scope === 'template'
                ? t('groupTemplate', { count: item.count })
                : t('groupEditorial', { count: item.count });
        const meta = item.scope === 'both' ? t('groupBothMeta') : item.open ? t('groupOpenMeta') : t('groupClosedMeta');
        return (
          <LinkCard
            key={item.key}
            kind="group"
            nodeKey={item.key}
            parentKey={item.parentKey}
            column={column}
            urlId={null}
            name={t('groupName', { label, meta })}
            highlighted={highlighted.has(item.key)}
            label={label}
            meta={meta}
            open={item.open}
            tabStop={item.key === tabKey}
            onActivate={activate}
            onKeyDown={cardKeyDown}
          />
        );
      }
      case 'stub': {
        const at = t(item.at.dir === 'out' ? 'atOut' : 'atIn', { step: item.at.step });
        return (
          <LinkCard
            key={item.key}
            kind="stub"
            nodeKey={item.key}
            parentKey={item.parentKey}
            column={column}
            urlId={item.urlId}
            name={t('stubName', { path: item.node.path, at })}
            highlighted={highlighted.has(item.key)}
            path={item.node.path}
            line={linkedAs(item.node)}
            tier={item.node.tier}
            note={t('stubAt', { at })}
            tabStop={item.key === tabKey}
            onActivate={activate}
            onKeyDown={cardKeyDown}
          />
        );
      }
      case 'card':
        return renderCard(item, column);
    }
  };

  const relOf = (link: N): string => (link.rel.length === 0 ? t('follow') : link.rel.join(' '));
  // What a screen reader hears after a card's name (the info panel carries the same facts for the eye)
  const describe = (
    tier: TierNameLike | null,
    status: number | null,
    depth: number | null,
    scoped: number,
    all: number,
    link: N | null,
    both: boolean,
  ): string =>
    [
      t('tipTier', { tier: tierLong(tier) }),
      status === null ? t('tipStatusUnknown') : t('tipStatus', { status }),
      depth === null ? t('tipDepthNone') : t('tipDepth', { depth }),
      t('tipLinking', { scoped, all }),
      ...(link === null ? [] : [t('tipLink', { placement: placementWord(link), rel: relOf(link) })]),
      ...(both ? [t('tipBoth')] : []),
    ].join(' ');
  const factsOf = (
    path: string,
    tier: TierNameLike | null,
    status: number | null,
    depth: number | null,
    scoped: number,
    all: number,
    link: N | null,
  ): InfoFacts => ({
    title: path,
    tier: tierLong(tier),
    status: status === null ? t('notCrawled') : String(status),
    depth: depth === null ? t('focusDepthNone') : String(depth),
    linkingScoped: String(scoped),
    linkingAll: String(all),
    placement: link === null ? '' : placementWord(link),
    rel: link === null ? '' : relOf(link),
  });

  const renderCard = (item: Extract<JourneyItem<N>, { kind: 'card' }>, column: number): ReactElement => {
    const { node } = item;
    const linking = t('linkingPages', { count: node.linking_pages });
    const backCount = item.backs.length;
    const name =
      node.anchor === null
        ? t('cardNameNoAnchor', { path: node.path, tier: tierLong(node.tier), linking, placement: placementWord(node) })
        : t('cardName', {
            path: node.path,
            tier: tierLong(node.tier),
            linking,
            anchor: node.anchor,
            placement: placementWord(node),
          });
    // A tooltip is at most three lines (16 section 6.1): three back links, then how many more
    const backRows = item.backs.slice(0, BACK_ROWS).map((back) => {
      const row = { tier: tierText(back.node.tier), path: back.node.path };
      const { anchor, scope } = back.node;
      if (anchor === null) {
        return scope === null
          ? t('backRowPlain', row)
          : t('backRowPlainScope', { ...row, scope: t(`scope.${SCOPE_KEY[scope]}`) });
      }
      return scope === null
        ? t('backRowAnchor', { ...row, anchor })
        : t('backRowAnchorScope', { ...row, anchor, scope: t(`scope.${SCOPE_KEY[scope]}`) });
    });
    if (item.backs.length > BACK_ROWS) backRows.push(t('backMore', { count: item.backs.length - BACK_ROWS }));
    return (
      <LinkCard
        key={item.key}
        kind="card"
        nodeKey={item.key}
        parentKey={item.parentKey}
        column={column}
        urlId={item.urlId}
        name={name}
        highlighted={highlighted.has(item.key)}
        path={node.path}
        line={linkedAs(node)}
        tier={node.tier}
        tierText={tierText(node.tier)}
        linkingText={t('cardIn', { count: node.linking_pages })}
        status={statusBadge(node.status_code, t('notCrawled'))}
        bothWaysText={item.bothWays ? t('bothWaysIcon') : null}
        focus={false}
        focusFacts={null}
        open={item.canOpen ? item.open : null}
        description={describe(
          node.tier,
          node.status_code,
          node.click_depth,
          node.linking_pages,
          node.linking_pages_all,
          node,
          item.bothWays,
        )}
        selected={selected.has(item.key)}
        offset={offsets.get(item.key) ?? null}
        onDragStart={dragStart}
        info={{
          facts: factsOf(
            node.path,
            node.tier,
            node.status_code,
            node.click_depth,
            node.linking_pages,
            node.linking_pages_all,
            node,
          ),
          label: t('info.open', { path: node.path }),
          buttonLabel: t('info.open', { path: node.path }),
          open: infoKey === item.key,
          onToggle: toggleInfo,
          onClose: closeInfo,
        }}
        tools={{
          focusLabel: t('makeFocus', { path: node.path }),
          onFocusPage: toolRefocus,
          detailsLabel: t('details', { path: node.path }),
          onDetails: toolDetails,
        }}
        back={
          backCount === 0
            ? null
            : {
                count: backCount,
                label: t(item.dir === 'out' ? 'backOut' : 'backIn', { count: backCount }),
                pressed: pinned.has(item.key),
                tip: {
                  content: t(item.dir === 'out' ? 'backTipOut' : 'backTipIn'),
                  detail: [...backRows, t('backTipHint')].join(' '),
                },
                onToggle: togglePin,
                onShow: showBack,
              }
        }
        tabStop={item.key === tabKey}
        onActivate={activate}
        onKeyDown={cardKeyDown}
      />
    );
  };

  const column = (label: string, index: number, children: ReactNode, isFocus = false): ReactElement => (
    <div key={`${label}-${String(index)}`} className={cn('flex shrink-0 flex-col gap-2', isFocus ? 'w-72' : 'w-60')}>
      {isFocus ? (
        <h3 className="inline-flex h-badge w-fit items-center rounded-sm bg-primary-subtle px-1.5 type-label text-primary-text">
          {label}
        </h3>
      ) : (
        <h3 className="type-label text-foreground-tertiary">{label}</h3>
      )}
      {children}
    </div>
  );
  const columnItems = (items: readonly JourneyItem<N>[], index: number): ReactNode => {
    const heads = items.filter((item) => item.kind === 'head').length;
    return items.map((item) => renderItem(item, index, heads));
  };

  const left = [...layout.in].reverse();
  const focusColumn = left.length;
  const focusLinking = t('linkingPages', { count: focus.linkingPages });
  const direction = (dir: Direction, step: number): string => t(dir === 'out' ? 'stepOut' : 'stepIn', { step });

  /** "T3 Content pages", or the word for Untiered. */
  const laneLabel = (position: number): string => {
    if (position === UNTIERED_POSITION) return t('untiered');
    const tier = tiers.find((candidate) => candidate.position === position);
    return tier === undefined ? `T${String(position)}` : `${tier.code} ${tier.name}`;
  };

  /** The focus card and the notes under it: in the focus column of By step, in the focus lane of By tier. */
  const renderFocus = (at: number): ReactElement => (
    <div className="flex flex-col gap-2">
      <LinkCard
        kind="card"
        nodeKey={FOCUS_KEY}
        parentKey={null}
        column={at}
        urlId={focus.urlId}
        name={t('focusName', { path: focus.path, tier: tierLong(focus.tier), linking: focusLinking })}
        highlighted={highlighted.has(FOCUS_KEY)}
        path={focus.path}
        line={focus.title ?? ''}
        tier={focus.tier}
        tierText={tierText(focus.tier)}
        linkingText={t('cardIn', { count: focus.linkingPages })}
        status={statusBadge(focus.statusCode, t('notCrawled'))}
        bothWaysText={null}
        focus
        focusFacts={{
          out: t('focusOut', { count: focus.linksOut }),
          depth:
            focus.clickDepth === null
              ? t('focusDepthNone')
              : focus.clickDepth === 0
                ? t('focusDepthHome')
                : t('focusDepth', { count: focus.clickDepth }),
        }}
        open={null}
        description={describe(
          focus.tier,
          focus.statusCode,
          focus.clickDepth,
          focus.linkingPages,
          focus.linkingPagesAll,
          null,
          false,
        )}
        selected={selected.has(FOCUS_KEY)}
        offset={offsets.get(FOCUS_KEY) ?? null}
        onDragStart={dragStart}
        info={{
          facts: factsOf(
            focus.path,
            focus.tier,
            focus.statusCode,
            focus.clickDepth,
            focus.linkingPages,
            focus.linkingPagesAll,
            null,
          ),
          label: t('info.open', { path: focus.path }),
          buttonLabel: t('info.open', { path: focus.path }),
          open: infoKey === FOCUS_KEY,
          onToggle: toggleInfo,
          onClose: closeInfo,
        }}
        tools={{
          focusLabel: null,
          onFocusPage: none,
          detailsLabel: t('details', { path: focus.path }),
          onDetails: toolDetails,
        }}
        back={null}
        tabStop={FOCUS_KEY === tabKey}
        onActivate={activate}
        onKeyDown={cardKeyDown}
      />
      {focusNote}
    </div>
  );

  const onViewportKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === '0') fit();
    else if (event.key === 'Home') centerFocus();
    // An open info panel takes the Escape (it listens for it itself), so the selection stays for the next one
    else if (event.key === 'Escape' && infoKey === null && selected.size > 0) changeSelection(NO_KEYS);
    else return;
    event.preventDefault();
  };
  const middle = { x: size.width / 2, y: size.height / 2 };
  // "Back to the focus page" shows when the focus card is wholly outside the view (not before the first drawing)
  const focusBox = edges.cards.find((card) => card.key === FOCUS_KEY);
  const focusAway =
    edges.width > 0 &&
    focusBox !== undefined &&
    ((focusBox.left + focusBox.width) * view.scale + view.x <= 0 ||
      focusBox.left * view.scale + view.x >= size.width ||
      (focusBox.top + focusBox.height) * view.scale + view.y <= 0 ||
      focusBox.top * view.scale + view.y >= size.height);

  return (
    <div className="flex flex-col">
      <div ref={scroller} className="relative" style={{ height }}>
        <CanvasViewport
          label={t('label')}
          view={view}
          onViewChange={onViewChange}
          size={size}
          onKey={onViewportKey}
          onBackgroundPointerDown={backgroundPress}
          className="h-full"
        >
          <div
            ref={inner}
            role="presentation"
            // Lanes share one height so each reads as a band; the columns of steps start at the top
            className={cn('relative flex w-max p-4', tiered === null ? 'items-start' : 'items-stretch')}
            style={{ columnGap: COLUMN_GAP }}
            onKeyDownCapture={() => {
              modality.current = 'keyboard';
            }}
            onPointerDownCapture={() => {
              modality.current = 'pointer';
            }}
            onFocus={(event) => {
              const key = event.target.closest<HTMLElement>('[data-node]')?.dataset.key;
              if (key === undefined) return;
              setActiveKey(key);
              // A card the keyboard reaches is brought into view by the least pan that shows it; one the mouse
              // pressed is where the pointer already is, and the view stays put under it
              if (modality.current === 'pointer' && !focusVisible(event.target)) return;
              const box = boxOfKey(key);
              if (box === undefined) return;
              const next = revealMinimum(view, box, size, REVEAL_MARGIN);
              if (next !== view) onViewChange(next);
            }}
          >
            <EdgeLayer edges={edges} markerId={markerId} onLine={showLine} onLineLeave={hideLine} />
            {tiered === null ? (
              <>
                {left.map((side, index) => column(direction('in', side.step), index, columnItems(side.items, index)))}
                {column(t('focusColumn'), focusColumn, renderFocus(focusColumn), true)}
                {layout.out.map((side, index) =>
                  column(
                    direction('out', side.step),
                    focusColumn + 1 + index,
                    columnItems(side.items, focusColumn + 1 + index),
                  ),
                )}
              </>
            ) : (
              tiered.lanes.map((lane, index) => {
                const label = laneLabel(lane.pos);
                return (
                  <div
                    key={`lane-${String(lane.pos)}`}
                    data-lane={String(lane.pos)}
                    className={cn(
                      'flex w-fit min-w-60 shrink-0 flex-col gap-2 rounded-lg border border-dashed p-2',
                      lane.isFocus ? 'border-primary-border bg-primary-subtle' : 'border-border',
                    )}
                  >
                    <div className="flex items-baseline gap-2">
                      <h3
                        className={cn('type-label', lane.isFocus ? 'text-primary-text' : 'text-foreground-secondary')}
                      >
                        {label}
                      </h3>
                      <span className="num type-meta text-foreground-tertiary">
                        {t('lanes.pages', { count: lane.count })}
                      </span>
                    </div>
                    {lane.empty ? (
                      <p className="type-meta text-foreground-tertiary">
                        {t('lanes.empty', {
                          tier: lane.pos === UNTIERED_POSITION ? t('untiered').toLowerCase() : `T${String(lane.pos)}`,
                        })}
                      </p>
                    ) : null}
                    {lane.isFocus ? renderFocus(index) : null}
                    {(tiered.cardsByLane.get(lane.pos) ?? []).map((item) => renderCard(item, index))}
                    {(tiered.extrasByLane.get(lane.pos) ?? []).map((item) => renderItem(item, index, 0))}
                  </div>
                );
              })
            )}
          </div>
        </CanvasViewport>
        <div className="absolute bottom-3 left-3">
          <ViewControls
            percent={Math.round(view.scale * 100)}
            minimap={minimap}
            atMin={view.scale <= MIN_SCALE}
            atMax={view.scale >= MAX_SCALE}
            onZoomOut={() => onViewChange(stepZoom(view, -1, size))}
            onZoomIn={() => onViewChange(stepZoom(view, 1, size))}
            onActualSize={() => onViewChange(zoomAt(view, 1, middle))}
            onFit={fit}
            onCenterFocus={centerFocus}
            onToggleMinimap={() => setMinimap((current) => !current)}
            canReset={offsets.size > 0}
            onReset={resetPositions}
            helpOpen={helpOpen}
            helpId={helpId}
            onToggleHelp={() => setHelpOpen((current) => !current)}
          />
        </div>
        {helpOpen ? (
          // Between the top row and the toolbar, so the panel covers neither
          <div className="pointer-events-none absolute inset-x-3 top-16 bottom-16 flex items-end">
            <div className="pointer-events-auto max-h-full max-w-full">
              <CanvasHelp id={helpId} tier={layoutMode === 'tier'} />
            </div>
          </div>
        ) : null}
        {focusAway || selected.size > 0 ? (
          // One wrapping row for the back button and the selection bar: on a narrow canvas they stack, never overlap
          <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-start gap-2">
            {focusAway ? (
              <Button
                variant="secondary"
                size="sm"
                data-canvas-control=""
                className="pointer-events-auto shadow-popover"
                onClick={centerFocus}
              >
                <Icon icon={Crosshair} size="sm" className="text-primary-text" />
                {t('backToFocus')}
              </Button>
            ) : null}
            {selected.size > 0 ? (
              <div className="pointer-events-auto max-w-full">
                <SelectionBar
                  count={selected.size}
                  onSetTier={onSetTier === undefined ? undefined : setTierOfSelection}
                  onShowLinks={showTheirLinks}
                  onClear={() => {
                    // The bar and the button that had focus are gone: focus goes to the card the person was on
                    changeSelection(NO_KEYS);
                    focusKey(tabKey);
                  }}
                />
              </div>
            ) : null}
          </div>
        ) : null}
        <div
          ref={marquee}
          hidden
          aria-hidden="true"
          className="pointer-events-none absolute rounded-sm border border-primary bg-primary-subtle opacity-60"
        />
        {lineTip === null ? null : (
          <LineTip tip={lineTip} facts={edges.lines.find((line) => line.id === lineTip.id)?.facts ?? null} />
        )}
        {minimap ? (
          <div className="absolute right-3 bottom-3">
            <Minimap
              label={t('map')}
              content={content}
              cards={edges.cards}
              shown={{
                left: -view.x / view.scale,
                top: -view.y / view.scale,
                width: size.width / view.scale,
                height: size.height / view.scale,
              }}
              onMove={(point) =>
                onViewChange(centerOn(view, { left: point.x, top: point.y, width: 0, height: 0 }, size))
              }
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** What a line is: the anchor, the type of link and its attribute, next to the pointer. */
function LineTip({ tip, facts }: { tip: { x: number; y: number }; facts: LineFacts | null }): ReactElement | null {
  const t = useTranslations('linkCanvas.line');
  if (facts === null) return null;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute rounded-md border border-border bg-surface-elevated p-2 shadow-popover"
      style={{ left: tip.x, top: tip.y }}
    >
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 type-meta">
        <dt className="text-foreground-tertiary">{t('anchor')}</dt>
        <dd className="text-foreground">{facts.anchor === null ? t('anchorNone') : `“${facts.anchor}”`}</dd>
        <dt className="text-foreground-tertiary">{t('type')}</dt>
        <dd className="text-foreground">{facts.type}</dd>
        <dt className="text-foreground-tertiary">{t('attribute')}</dt>
        <dd className="text-foreground">{facts.attribute}</dd>
      </dl>
    </div>
  );
}
