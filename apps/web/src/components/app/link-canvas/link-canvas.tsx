'use client';

import { useTranslations } from 'next-intl';
import {
  use,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';

import { LinkCard, type LinkCardPageProps } from './link-card';
import { ZOOMS, type Zoom } from './zoom-controls';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { announce } from '@/lib/a11y/announcer';
import { SingleKeysContext } from '@/lib/a11y/use-shortcut';
import { edgeLook, elbowPath, returnArrowPath, type Box, type EdgeLook } from '@/lib/internal-links/journey-geometry';
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
  /** The largest zoom step at which the whole journey fits the width. */
  fitZoom: () => Zoom;
}

export interface LinkCanvasProps<N extends JourneyNeighbor> {
  layout: JourneyLayout<N>;
  focus: CanvasFocus;
  /** Lines under the focus card: "18 editorial links in.", the orphan and redirect notes. */
  focusNote?: ReactNode;
  zoom: Zoom;
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

/** The space between columns that the elbows' spine runs in (mock `gap-16`; a style, since 64 px is no spacing step). */
const COLUMN_GAP = 64;
const MIN_HEIGHT = 440;
/** The legend line and the page's bottom padding stay in view under the canvas. */
const BELOW = 72;
const FLASH_MS = 1500;
/** The back links a card's marker tooltip lists. */
const BACK_ROWS = 3;

interface DrawnEdge {
  id: string;
  d: string;
  look: EdgeLook;
}

const STROKE: Readonly<Record<EdgeLook['tone'], string>> = {
  editorial: 'stroke-foreground-tertiary',
  muted: 'stroke-border-strong',
  redirect: 'stroke-warning-text',
  broken: 'stroke-negative-text',
};

/** The operating system's setting and the app's own (`data-motion` on the root, 21-motion.md): both stop script scrolls. */
const reducedMotion = (): boolean =>
  (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false) ||
  document.documentElement.dataset.motion === 'reduced';

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
  width: number;
  height: number;
}

const sameEdges = (a: DrawnEdges, b: DrawnEdges): boolean =>
  a.width === b.width &&
  a.height === b.height &&
  a.lines.length === b.lines.length &&
  a.arrows.length === b.arrows.length &&
  a.lines.every((line, index) => line.id === b.lines[index]?.id && line.d === b.lines[index].d) &&
  a.arrows.every((arrow, index) => arrow.id === b.arrows[index]?.id && arrow.d === b.arrows[index].d);

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
  zoom,
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
  const inner = useRef<HTMLDivElement>(null);
  // The card that was activated, the keys that can take focus back (itself, then what it hung under), the layout it
  // was activated on and when: focus returns once the layout is rebuilt, and not for a zoom or a hover
  const restore = useRef<PendingRestore<N> | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [flashKey, setFlashKey] = useState<string | null>(null);
  // One tab stop for the whole canvas: the card that last had focus (the focus page at first)
  const [activeKey, setActiveKey] = useState(FOCUS_KEY);
  const [edges, setEdges] = useState<DrawnEdges>({ lines: [], arrows: [], width: 0, height: 0 });
  const [height, setHeight] = useState(MIN_HEIGHT + 120);

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

  // Edges are measured from the cards as laid out, in unscaled pixels (the mock's `boxIn`)
  const draw = useCallback((): void => {
    const root = inner.current;
    if (root === null) return;
    const origin = root.getBoundingClientRect();
    const elements = new Map<string, Element>();
    for (const element of root.querySelectorAll('[data-node]')) {
      const key = element.getAttribute('data-key');
      if (key !== null) elements.set(key, element);
    }
    const boxOf = (key: string): Box | null => {
      const rect = elements.get(key)?.getBoundingClientRect();
      if (rect === undefined) return null;
      return {
        left: (rect.left - origin.left) / zoom,
        top: (rect.top - origin.top) / zoom,
        width: rect.width / zoom,
        height: rect.height / zoom,
      };
    };
    const statusOf = (key: string): number | null => {
      if (key === FOCUS_KEY) return focus.statusCode;
      const item = byKey.get(key);
      return item?.kind === 'card' || item?.kind === 'stub' ? item.node.status_code : null;
    };
    const lines: DrawnEdge[] = [];
    for (const [key, item] of byKey) {
      const parent = boxOf(item.parentKey);
      const child = boxOf(key);
      if (parent === null || child === null) continue;
      const inbound = item.dir === 'in';
      const look =
        item.kind === 'group'
          ? edgeLook(item.scope === 'both' ? null : item.scope, null)
          : edgeLook(item.node.scope, inbound ? statusOf(item.parentKey) : item.node.status_code);
      lines.push({ id: key, d: elbowPath(inbound ? child : parent, inbound ? parent : child), look });
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
        arrows.push({ id: `${key}>${back.key}`, d, look: { tone: 'editorial', dash: '6 4', rank: 2 } });
      }
    }
    // The size of the columns (offset size, in unscaled pixels), not the scroll size: the SVG layer must not hold the area open
    const next = { lines, arrows, width: root.offsetWidth, height: root.offsetHeight };
    // A hover or a pin that changes nothing on screen must not render the canvas again
    setEdges((current) => (sameEdges(current, next) ? current : next));
  }, [byKey, shownBacks, zoom, focus.statusCode]);

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
    const fit = (): void => {
      const top = scroller.current?.getBoundingClientRect().top ?? 0;
      setHeight(Math.max(MIN_HEIGHT, Math.round(window.innerHeight - top - BELOW)));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  useEffect(() => {
    if (flashKey === null) return undefined;
    const timer = window.setTimeout(() => setFlashKey(null), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [flashKey]);

  useImperativeHandle(
    ref,
    () => ({
      fitZoom: () => {
        const room = scroller.current?.clientWidth ?? 0;
        const width = inner.current?.offsetWidth ?? 0;
        return [...ZOOMS].reverse().find((step) => width * step <= room) ?? ZOOMS[0];
      },
    }),
    [],
  );

  const nodesOf = (): HTMLElement[] => [...(inner.current?.querySelectorAll<HTMLElement>('[data-node]') ?? [])];
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
      else
        current.scrollIntoView?.({
          block: 'center',
          inline: 'center',
          behavior: reducedMotion() ? 'auto' : 'smooth',
        });
    } else if (event.key === 'Escape') {
      event.preventDefault();
      focusKey(FOCUS_KEY);
    }
  };

  const findOriginal = (urlId: string): void => {
    const original = nodesOf().find((element) => element.dataset.kind === 'card' && element.dataset.url === urlId);
    if (original === undefined) return;
    original.scrollIntoView?.({ block: 'nearest', inline: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
    original.focus({ preventScroll: true });
    setFlashKey(original.dataset.key ?? null);
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
            <p role="alert" className="type-meta text-foreground-secondary">
              {t('failed')}
            </p>
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
            onActivate={() => opening(item.open, () => onToggleGroup(item.key), item.key, item.parentKey)}
            onKeyDown={onKeyDown}
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
            onActivate={() => findOriginal(item.urlId)}
            onKeyDown={onKeyDown}
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
          onFocusPage: () => onRefocus(item.urlId),
          detailsLabel: t('details', { path: node.path }),
          onDetails: () => onDetails(item.urlId),
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
                onToggle: () => onTogglePin(item.key),
                onShow: (shown) => setHoverKey(shown ? item.key : null),
              }
        }
        tabStop={item.key === tabKey}
        onActivate={() => {
          if (item.canOpen) opening(item.open, () => onToggleCard(item.key), item.key, item.parentKey);
        }}
        onKeyDown={onKeyDown}
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

  return (
    <div className="flex flex-col">
      <div
        ref={scroller}
        role="group"
        aria-label={t('label')}
        className="overflow-auto bg-surface-subtle"
        style={{ height }}
      >
        <div style={{ width: edges.width * zoom, height: edges.height * zoom }} className="relative">
          <div
            ref={inner}
            role="presentation"
            className="relative flex w-max items-start p-4"
            style={{ columnGap: COLUMN_GAP, transform: `scale(${String(zoom)})`, transformOrigin: '0 0' }}
            onFocus={(event) => {
              const key = event.target.closest<HTMLElement>('[data-node]')?.dataset.key;
              if (key !== undefined) setActiveKey(key);
            }}
          >
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute top-0 left-0"
              width={edges.width}
              height={edges.height}
            >
              <defs>
                <marker
                  id={markerId}
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto"
                >
                  <path d="M1 1L9 5L1 9z" className="fill-primary" />
                </marker>
              </defs>
              {edges.lines.map((line) => (
                <path
                  key={line.id}
                  d={line.d}
                  fill="none"
                  strokeWidth={1.5}
                  strokeDasharray={line.look.dash ?? undefined}
                  className={STROKE[line.look.tone]}
                />
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
                    onFocusPage: () => undefined,
                    detailsLabel: t('details', { path: focus.path }),
                    onDetails: () => onDetails(focus.urlId),
                  }}
                  back={null}
                  tabStop={FOCUS_KEY === tabKey}
                  onActivate={() => undefined}
                  onKeyDown={onKeyDown}
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
        </div>
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
