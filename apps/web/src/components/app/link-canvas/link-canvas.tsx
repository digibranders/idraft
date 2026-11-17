'use client';

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
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';

import { CanvasViewport } from './canvas-viewport';
import { LinkCard, type LinkCardPageProps } from './link-card';
import { Minimap, type MinimapCard } from './minimap';
import { ViewControls } from './view-controls';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { announce } from '@/lib/a11y/announcer';
import { SingleKeysContext } from '@/lib/a11y/use-shortcut';
import {
  MAX_SCALE,
  MIN_SCALE,
  centerOn,
  firstView,
  fitView,
  revealMinimum,
  stepZoom,
  zoomAt,
  type Size,
  type View,
} from '@/lib/internal-links/canvas-view';
import { COLUMN_GAP, curvePath } from '@/lib/internal-links/journey-curves';
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
import type { TierNameLike } from '@/lib/internal-links/tiers';
import { cn } from '@/lib/utils';

/** The page the journey is centered on, from the inspector read of the feature. */
export interface CanvasFocus {
  urlId: string;
  path: string;
  title: string | null;
  tier: TierNameLike | null;
  linkingPages: number;
  linkingPagesAll: number;
  statusCode: number | null;
  clickDepth: number | null;
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

interface DrawnEdge {
  id: string;
  d: string;
  look: EdgeLook;
  /** The dot at the source end, and where the arrowhead stands (lines only). */
  start: { x: number; y: number } | null;
}

const STROKE: Readonly<Record<EdgeLook['tone'], string>> = {
  editorial: 'stroke-foreground-tertiary',
  muted: 'stroke-border-strong',
  redirect: 'stroke-warning-text',
  broken: 'stroke-negative-text',
};
const FILL: Readonly<Record<EdgeLook['tone'], string>> = {
  editorial: 'fill-foreground-tertiary',
  muted: 'fill-border-strong',
  redirect: 'fill-warning-text',
  broken: 'fill-negative-text',
};
const TONES = Object.keys(STROKE) as readonly EdgeLook['tone'][];

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
const EdgeLayer = memo(function EdgeLayer({ edges, markerId }: { edges: DrawnEdges; markerId: string }): ReactElement {
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
  pinned,
  onTogglePin,
  onToggleCard,
  onToggleGroup,
  onMore,
  onRefocus,
  onDetails,
  onRetry,
  onFull,
  ref,
}: LinkCanvasProps<N>): ReactElement {
  const t = useTranslations('linkCanvas');
  const singleKeys = use(SingleKeysContext);
  const markerId = useId();
  const scroller = useRef<HTMLDivElement>(null);
  // The focus page the first view was last set for: one first view per focus page
  const firstFor = useRef<string | null>(null);
  // How the last input reached the canvas: only the keyboard pans a focused card into view
  const modality = useRef<'keyboard' | 'pointer'>('keyboard');
  const inner = useRef<HTMLDivElement>(null);
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
  });
  const [height, setHeight] = useState(MIN_HEIGHT + 120);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  // The map is off until its button is pressed (owner decision, 2026-11-17)
  const [minimap, setMinimap] = useState(false);
  const size = useMemo<Size>(() => ({ width, height }), [width, height]);

  const tierText = useCallback((tier: TierNameLike | null): string => tier?.code ?? t('untiered'), [t]);
  const tierLong = useCallback(
    (tier: TierNameLike | null): string => (tier === null ? t('untiered') : `${tier.code} ${tier.name}`),
    [t],
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
    return { byKey: keyed, pathOf: paths, stops: nodeKeys, hasFailed: failed };
  }, [layout, focus.urlId, focus.path]);
  // The tab stop stays where focus last was; when that node is gone it falls back to the focus page
  const tabKey = stops.has(activeKey) ? activeKey : FOCUS_KEY;

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
      if (item?.kind === 'card') for (const back of item.backs) keys.add(back.key);
    }
    if (flashKey !== null) keys.add(flashKey);
    return keys;
  }, [shownBacks, byKey, flashKey]);

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
    const boxOf = (key: string): Box | null => {
      const element = elements.get(key);
      return element === undefined ? null : offsetBox(element, root);
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
      lines.push({ id: key, d: drawn.d, look, start: drawn.start });
    }
    lines.sort((a, b) => a.look.rank - b.look.rank);
    const arrows: DrawnEdge[] = [];
    for (const key of shownBacks) {
      const item = byKey.get(key);
      const from = boxOf(key);
      if (item?.kind !== 'card' || from === null) continue;
      for (const back of item.backs) {
        const to = boxOf(back.key);
        if (to === null) continue;
        const d = item.dir === 'out' ? returnArrowPath(from, to) : returnArrowPath(to, from);
        arrows.push({ id: `${key}>${back.key}`, d, look: { tone: 'editorial', dash: '6 4', rank: 2 }, start: null });
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
    };
    // A hover or a pin that changes nothing on screen must not render the canvas again
    setEdges((current) => (sameEdges(current, next) ? current : next));
  }, [byKey, shownBacks, layout, focus.urlId, focus.statusCode]);

  useLayoutEffect(() => {
    draw();
  }, [draw]);

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
    return root === null || element === undefined ? undefined : offsetBox(element, root);
  };
  const fit = (): void => onViewChange(fitView(content, size, JOURNEY_MARGIN));
  const centerFocus = (): void => {
    const box = boxOfKey(FOCUS_KEY);
    if (box !== undefined) onViewChange(centerOn(view, box, size));
  };

  // The first view of each focus page, once the journey has a size and no list is still loading (spec 7.5 "First view")
  useEffect(() => {
    if (layout.pending || edges.width === 0 || firstFor.current === focus.urlId) return;
    // The drawing must be of this journey: right after a refocus it can still be the last page's
    if (edges.layout !== layout || edges.focusId !== focus.urlId) return;
    const box = edges.cards.find((card) => card.key === FOCUS_KEY);
    if (box === undefined) return;
    firstFor.current = focus.urlId;
    onViewChange(firstView(content, box, size, JOURNEY_MARGIN));
  }, [layout, edges, content, size, focus.urlId, onViewChange]);

  useEffect(() => {
    if (flashKey === null) return undefined;
    const timer = window.setTimeout(() => setFlashKey(null), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [flashKey]);

  useImperativeHandle(ref, () => ({ fit, centerFocus }));

  const focusKey = (key: string): void => {
    for (const element of nodesOf()) if (element.dataset.key === key) element.focus();
  };

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
      focusKey(FOCUS_KEY);
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
    run();
  };

  // One function each for every card, so a card that did not change is not drawn again when the canvas pans or zooms
  const activate = useStable((key: string): void => {
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
            note={t('stubLine', { at })}
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

  const tipOf = (
    path: string,
    tier: TierNameLike | null,
    status: number | null,
    depth: number | null,
    scoped: number,
    all: number,
    link: N | null,
    both: boolean,
  ): { content: string; detail: string } => ({
    content: path,
    detail: [
      t('tipTier', { tier: tierLong(tier) }),
      status === null ? t('tipStatusUnknown') : t('tipStatus', { status }),
      depth === null ? t('tipDepthNone') : t('tipDepth', { depth }),
      t('tipLinking', { scoped, all }),
      ...(link === null
        ? []
        : [
            t('tipLink', {
              placement: placementWord(link),
              rel: link.rel.length === 0 ? t('follow') : link.rel.join(' '),
            }),
          ]),
      ...(both ? [t('tipBoth')] : []),
    ].join(' '),
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
        linkingText={linking}
        status={statusBadge(node.status_code, t('notCrawled'))}
        bothWaysText={item.bothWays ? t('bothWays') : null}
        focus={false}
        open={item.canOpen ? item.open : null}
        tip={tipOf(
          node.path,
          node.tier,
          node.status_code,
          node.click_depth,
          node.linking_pages,
          node.linking_pages_all,
          node,
          item.bothWays,
        )}
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

  const column = (label: string, index: number, children: ReactNode): ReactElement => (
    <div key={`${label}-${String(index)}`} className="flex w-64 shrink-0 flex-col gap-2">
      <h3 className="type-label text-foreground-tertiary">{label}</h3>
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

  const onViewportKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === '0') fit();
    else if (event.key === 'Home') centerFocus();
    else return;
    event.preventDefault();
  };
  const middle = { x: size.width / 2, y: size.height / 2 };

  return (
    <div className="flex flex-col">
      <div ref={scroller} className="relative" style={{ height }}>
        <CanvasViewport
          label={t('label')}
          view={view}
          onViewChange={onViewChange}
          size={size}
          onKey={onViewportKey}
          className="h-full"
        >
          <div
            ref={inner}
            role="presentation"
            className="relative flex w-max items-start p-4"
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
            <EdgeLayer edges={edges} markerId={markerId} />
            {left.map((side, index) => column(direction('in', side.step), index, columnItems(side.items, index)))}
            {column(
              t('focusColumn'),
              focusColumn,
              <div className="flex flex-col gap-2">
                <LinkCard
                  kind="card"
                  nodeKey={FOCUS_KEY}
                  parentKey={null}
                  column={focusColumn}
                  urlId={focus.urlId}
                  name={t('focusName', { path: focus.path, tier: tierLong(focus.tier), linking: focusLinking })}
                  highlighted={highlighted.has(FOCUS_KEY)}
                  path={focus.path}
                  line={focus.title ?? ''}
                  tier={focus.tier}
                  tierText={tierText(focus.tier)}
                  linkingText={focusLinking}
                  status={statusBadge(focus.statusCode, t('notCrawled'))}
                  bothWaysText={null}
                  focus
                  open={null}
                  tip={tipOf(
                    focus.path,
                    focus.tier,
                    focus.statusCode,
                    focus.clickDepth,
                    focus.linkingPages,
                    focus.linkingPagesAll,
                    null,
                    false,
                  )}
                  tools={{
                    focusLabel: null,
                    onFocusPage: none,
                    detailsLabel: t('details', { path: focus.path }),
                    onDetails: toolDetails,
                  }}
                  back={null}
                  tabStop={FOCUS_KEY === tabKey}
                  onActivate={none}
                  onKeyDown={cardKeyDown}
                />
                {focusNote}
              </div>,
            )}
            {layout.out.map((side, index) =>
              column(
                direction('out', side.step),
                focusColumn + 1 + index,
                columnItems(side.items, focusColumn + 1 + index),
              ),
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
          />
        </div>
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
      <Legend />
    </div>
  );
}

function Legend(): ReactElement {
  const t = useTranslations('linkCanvas.legend');
  const entries = [
    ['editorial', 'border-foreground-tertiary'],
    ['autoGenerated', 'border-dotted border-border-strong'],
    ['template', 'border-dashed border-border-strong'],
    ['redirect', 'border-warning-text'],
    ['broken', 'border-negative-text'],
    ['back', 'border-dashed border-primary'],
  ] as const;
  return (
    <ul
      aria-label={t('label')}
      className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border-subtle px-4 py-2 type-meta text-foreground-secondary"
    >
      {entries.map(([key, line]) => (
        <li key={key} className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className={cn('w-6 border-t-2', line)} />
          {t(key)}
        </li>
      ))}
    </ul>
  );
}
