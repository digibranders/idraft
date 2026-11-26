'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';

import { SkeletonRows } from '../crawl-states';
import { LinksDropped } from '../links-dropped';
import type { LinksTabContext } from '../tabs';
import { MapCard } from './map-card';
import { MapHelp } from './map-help';
import { MapLegend } from './map-legend';
import { MapToolbar } from './map-toolbar';
import { MapViewControls } from './map-view-controls';
import { useMapLayout } from './use-map-layout';
import { LinkMapChart, type LinkMapChartHandle, type MapFrame } from '@/components/app/link-map/link-map-chart';
import { Banner } from '@/components/app/status/banner';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { escapeHtml } from '@/lib/charts/category-chart';
import { prefersReducedMotion } from '@/lib/charts/rich-style';
import { csvBlob, downloadBlob, safeText } from '@/lib/csv/csv-write';
import { focusOf, type MapLens } from '@/lib/internal-links/map-focus';
import { colourGroups, summarise, toMapGraph, type MapColourMode } from '@/lib/internal-links/map-graph';
import type { LayoutInput } from '@/lib/internal-links/map-layout';
import { MAP_REPAINT_AT, MAP_ZOOM, mapOption, type MapView } from '@/lib/internal-links/map-option';
import { linkGraphQuery } from '@/lib/internal-links/queries';
import { tierLabel } from '@/lib/internal-links/tiers';
import { cn } from '@/lib/utils';

const HELP_ID = 'link-map-help';
const NO_HIDDEN: ReadonlySet<string> = new Set();

/** The browser's own full screen is on. (`fullscreenElement` is `null` when it is off; a test browser may not have it.) */
const inFullScreen = (): boolean => Boolean(document.fullscreenElement);

/** The tooltip: the address, then one line. Both arguments are already escaped. */
const tooltipBox = (first: string, second: string): string =>
  `<div class="max-w-72 rounded-md border border-border bg-surface-elevated px-2.5 py-1.5 shadow-popover whitespace-normal">` +
  `<div class="type-table text-foreground [overflow-wrap:anywhere]">${first}</div>` +
  `<div class="type-meta text-foreground-secondary">${second}</div></div>`;

/**
 * Whether the canvas is taller than wide, which decides the side of the block of unlinked pages. Unknown (`null`)
 * until the canvas has been measured, so the map is laid out once, on the right side.
 */
function useCanvasIsTall(stage: { current: HTMLDivElement | null }, watch: unknown): boolean | null {
  const [tall, setTall] = useState<boolean | null>(null);
  useEffect(() => {
    const node = stage.current;
    if (node === null) return undefined;
    const measure = (): void => setTall(node.clientWidth < node.clientHeight);
    if (typeof ResizeObserver === 'undefined') {
      // No observer (a test, an old browser): measured once, after this effect
      queueMicrotask(measure);
      return undefined;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [stage, watch]);
  return tall;
}

/** The Link map tab (plan 11, mock `il-map.js`): every live page of the crawl in one graph. */
export function MapTab({ context }: { context: LinksTabContext }): ReactElement {
  const t = useTranslations('internalLinks.map');
  const untiered = useTranslations('internalLinks.filters')('untiered');
  const common = useTranslations('common');
  const { scope, state, setSearch, tiers, crawl, registerExport } = context;
  const { query, includeAuto, colour: colourMode, lens, selected } = state.map;

  const read = useQuery({ ...linkGraphQuery(scope, includeAuto, crawl.run), enabled: crawl.linksAvailable });
  const answer = read.data?.data;
  const graph = useMemo(() => (answer === undefined ? null : toMapGraph(answer, tiers)), [answer, tiers]);

  // The canvas: its size decides which side the block of unlinked pages stands on
  const stage = useRef<HTMLDivElement>(null);
  const tall = useCanvasIsTall(stage, graph);
  const below = tall === true;

  const layoutInput = useMemo<LayoutInput | null>(
    () =>
      graph === null || tall === null
        ? null
        : {
            nodes: graph.nodes.map((node) => ({
              id: node.id,
              links: node.linksIn + node.linksOut,
              group: node.tierPosition ?? 99,
            })),
            edges: graph.edges,
            below,
          },
    [graph, tall, below],
  );
  const { layout } = useMapLayout(layoutInput);

  // What the address does not keep: dragged pages, legend switches, the minimap, the help, full screen
  const [moved] = useState(() => new Map<string, readonly [number, number]>());
  useEffect(() => {
    moved.clear();
  }, [layoutInput, moved]);
  const [hiddenState, setHiddenState] = useState<{ mode: MapColourMode; keys: ReadonlySet<string> }>({
    mode: colourMode,
    keys: NO_HIDDEN,
  });
  // Switches belong to the colouring they were made in: another colouring starts with every group on
  const hidden = hiddenState.mode === colourMode ? hiddenState.keys : NO_HIDDEN;
  const [minimap, setMinimap] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const [maximised, setMaximised] = useState(false);
  const [zoom, setZoom] = useState(1);
  const chart = useRef<LinkMapChartHandle>(null);

  const colour = useMemo(
    () => (graph === null ? null : colourGroups(graph, colourMode, tiers)),
    [graph, colourMode, tiers],
  );
  const focus = useMemo(
    () => (graph === null ? null : focusOf(graph, { selected, query, lens })),
    [graph, selected, query, lens],
  );
  const summary = useMemo(() => (graph === null ? null : summarise(graph)), [graph]);
  const tierName = useCallback(
    (position: number | null): string => tierLabel(tiers.find((tier) => tier.position === position) ?? null, untiered),
    [tiers, untiered],
  );

  const build = useMemo(() => {
    if (graph === null || layout === null || colour === null || focus === null) return null;
    return (frame: MapFrame): Record<string, unknown> =>
      mapOption({
        graph,
        layout,
        moved,
        focus,
        colour,
        hidden,
        minimap,
        tokens: frame.tokens,
        width: frame.width,
        height: frame.height,
        view: frame.view,
        reducedMotion: prefersReducedMotion(),
        words: {
          home: t('home'),
          blockTitle: t('blockTitle', { kind: t(includeAuto ? 'kindAuto' : 'kindEditorial') }),
          blockLine: (key, count) => t('blockLine', { tier: tierName(key === 99 ? null : key), count }),
        },
        tooltip: (target) => {
          if ('edge' in target) {
            const edge = graph.edges[target.edge];
            const from = edge === undefined ? undefined : graph.byId.get(edge.from);
            const to = edge === undefined ? undefined : graph.byId.get(edge.to);
            if (from === undefined || to === undefined) return '';
            return tooltipBox(escapeHtml(from.path), escapeHtml(t('tooltipEdge', { path: to.path })));
          }
          const node = graph.byId.get(target.page);
          if (node === undefined) return '';
          return tooltipBox(
            escapeHtml(node.path),
            escapeHtml(
              t('tooltipPage', { tier: tierName(node.tierPosition), linksIn: node.linksIn, linksOut: node.linksOut }),
            ),
          );
        },
      });
  }, [graph, layout, moved, colour, focus, hidden, minimap, includeAuto, t, tierName]);

  const select = useCallback((id: string | null) => setSearch({ mpage: id }), [setSearch]);
  const onSelect = useCallback(
    // A second click on the selected page lets it go
    (id: string | null) => select(id !== null && id === selected ? null : id),
    [select, selected],
  );
  const onMoved = useCallback(
    (id: string, position: readonly [number, number]) => {
      moved.set(id, position);
    },
    [moved],
  );
  const onView = useCallback((view: MapView) => setZoom(view.zoom), []);

  /** Brings the lit pages into view: one page is selected, several are framed together. */
  const zoomToLit = useCallback(() => {
    if (focus === null || layout === null || focus.lit === null || focus.lit.size === 0) return;
    const placed = new Map(layout.positions.map(([id, x, y]) => [id, [x, y] as const]));
    const spots = [...focus.lit].flatMap((id) => {
      const spot = moved.get(id) ?? placed.get(id);
      return spot === undefined ? [] : [spot];
    });
    if (spots.length === 0) return;
    const bounds = (list: readonly (readonly [number, number])[], axis: 0 | 1): { min: number; max: number } => {
      const values = list.map((point) => point[axis]);
      return { min: Math.min(...values), max: Math.max(...values) };
    };
    const span = (list: readonly (readonly [number, number])[], axis: 0 | 1): number => {
      const { min, max } = bounds(list, axis);
      return max - min;
    };
    const middle = (axis: 0 | 1): number => {
      const { min, max } = bounds(spots, axis);
      return (min + max) / 2;
    };
    const all = [...placed.values()];
    const next = Math.min(span(all, 0) / (span(spots, 0) + 160), span(all, 1) / (span(spots, 1) + 160), 4);
    chart.current?.show({ zoom: Math.max(1, next), center: [middle(0), middle(1)] });
    if (focus.lit.size === 1) select([...focus.lit][0] ?? null);
  }, [focus, layout, moved, select]);

  const toggleFull = useCallback(() => {
    setMaximised((on) => {
      // The browser's own full screen comes on top where it is allowed; the map fills the window either way
      if (!on) void document.documentElement.requestFullscreen?.().catch(() => undefined);
      else if (inFullScreen()) void document.exitFullscreen();
      return !on;
    });
  }, []);
  useEffect(() => {
    const left = (): void => {
      if (!inFullScreen()) setMaximised(false);
    };
    document.addEventListener('fullscreenchange', left);
    return () => {
      document.removeEventListener('fullscreenchange', left);
      // Leaving the tab ends full screen
      if (inFullScreen()) void document.exitFullscreen();
    };
  }, []);
  // Escape closes the help first, then lets the selected page go, then leaves full screen; the inspector and any open
  // menu or dialog take it before the map does
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || context.inspect.urlId !== null) return;
      if (event.target instanceof Element && event.target.closest('[role="menu"], [role="dialog"]') !== null) return;
      if (helpOpen) setHelpOpen(false);
      else if (selected !== null) select(null);
      else if (maximised && !inFullScreen()) setMaximised(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [context.inspect.urlId, helpOpen, maximised, select, selected]);

  // The page's Export downloads the pages of the map
  useEffect(() => {
    if (graph === null) {
      registerExport(null);
      return undefined;
    }
    registerExport(() => {
      const header = [
        t('export.page'),
        t('export.title'),
        t('export.tier'),
        t('export.linksIn'),
        t('export.linksOut'),
        t('export.onMap'),
        t('export.sitewide'),
      ];
      const rows = graph.nodes.map((node) => [
        safeText(node.path),
        safeText(node.title),
        safeText(tierName(node.tierPosition)),
        node.linksIn,
        node.linksOut,
        t(node.linksIn + node.linksOut > 0 ? 'export.linked' : 'export.unlinked'),
        node.sitewideFrom,
      ]);
      downloadBlob(csvBlob({ header, rows }), 'internal-links-map.csv');
      return Promise.resolve();
    });
    return () => registerExport(null);
  }, [graph, registerExport, tierName, t]);

  // A legend switch that takes the selected page off the map lets the page go: its card would point at nothing
  const toggleGroup = useCallback(
    (key: string) => {
      if (colour === null || graph === null) return;
      const next = new Set(hidden);
      if (!next.delete(key)) next.add(key);
      setHiddenState({ mode: colourMode, keys: next });
      const node = selected === null ? undefined : graph.byId.get(selected);
      if (node !== undefined && next.has(colour.keyOf(node))) select(null);
    },
    [colour, colourMode, graph, hidden, select, selected],
  );

  if (!crawl.linksAvailable) return <LinksDropped />;
  if (read.isError && answer === undefined) {
    return (
      <InlineError
        title={t('loadFailed')}
        reason={t('loadFailedReason')}
        errorId={null}
        onRetry={() => void read.refetch()}
        retrying={read.isFetching}
        retryLabel={common('retry')}
      />
    );
  }
  if (graph === null) return <SkeletonRows />;
  if (graph.nodes.length === 0) {
    return <EmptyState title={t('emptyTitle')} reason={t('empty')} headingLevel={3} />;
  }
  if (summary === null || colour === null || focus === null) return <SkeletonRows />;

  const kind = t(includeAuto ? 'kindAuto' : 'kindEditorial');
  const sentence = [
    t('summary', { pages: summary.pages, links: summary.links, kind }),
    summary.largest > 1 ? t('summaryLargest', { count: summary.largest }) : '',
    summary.unlinked > 0
      ? t('summaryUnlinked', { count: summary.unlinked, kind, side: below ? 'below' : 'right' })
      : '',
  ]
    .filter(Boolean)
    .join(' ');
  const node = selected === null ? undefined : graph.byId.get(selected);
  // The address keeps only what is not the default: a search, auto-generated links, Section colour, a highlight
  const onQuery = (value: string): void => setSearch({ mq: value === '' ? null : value, mpage: null });
  const onIncludeAuto = (on: boolean): void => setSearch({ mauto: on ? '1' : null });
  const onColour = (mode: MapColourMode): void => setSearch({ mcol: mode === 'section' ? 'section' : null });
  const onLens = (next: MapLens): void => setSearch({ mhl: next === 'none' ? null : next });

  return (
    <section
      aria-label={t('label')}
      className={cn(
        'flex flex-col overflow-hidden border-border bg-surface',
        maximised ? 'fixed inset-0 z-(--z-inspector)' : 'rounded-lg border',
      )}
    >
      <MapToolbar
        query={query}
        found={focus.searching ? t('found', { count: focus.lit?.size ?? 0, total: graph.nodes.length }) : ''}
        includeAuto={includeAuto}
        colour={colourMode}
        lens={lens}
        maximised={maximised}
        onQuery={onQuery}
        onEnter={zoomToLit}
        onIncludeAuto={onIncludeAuto}
        onColour={onColour}
        onLens={onLens}
        onToggleFull={toggleFull}
      />
      <MapLegend
        mode={colourMode}
        groups={colour.list}
        hidden={hidden}
        tierName={(group) => tierName(group.tier?.position ?? null)}
        onToggle={toggleGroup}
      />
      {graph.truncated ? (
        <Banner
          tone="info"
          placement="region"
          message={t('truncated', { shown: graph.nodes.length, total: graph.pagesTotal })}
        />
      ) : null}
      <p className="border-b border-border-subtle px-3 py-2 type-meta text-foreground-secondary">{sentence}</p>
      <div
        ref={stage}
        className={cn('relative isolate min-h-0 bg-surface-subtle', maximised && 'flex-1')}
        // The map is as tall as the room under the page's header, and never shorter than 32 rem
        style={maximised ? undefined : { height: 'max(32rem, calc(100dvh - 19rem))' }}
      >
        {build === null ? (
          <p role="status" className="absolute inset-0 grid place-items-center type-body text-foreground-secondary">
            {t('arranging')}
          </p>
        ) : (
          <LinkMapChart
            ref={chart}
            build={build}
            label={t('canvas', { summary: sentence })}
            onSelect={onSelect}
            onMoved={onMoved}
            onView={onView}
            repaintAt={MAP_REPAINT_AT}
          />
        )}
        {node === undefined ? null : (
          <MapCard
            node={node}
            tier={tierName(node.tierPosition)}
            colour={colour.list.find((group) => group.key === colour.keyOf(node))?.colour ?? { kind: 'other' }}
            onClose={() => select(null)}
            onDetails={() => context.inspect.open(node.id)}
            onJourney={() => context.openJourney(node.id)}
          />
        )}
        {helpOpen ? <MapHelp id={HELP_ID} /> : null}
        <MapViewControls
          percent={Math.round(zoom * 100)}
          minimap={minimap}
          atMin={zoom <= MAP_ZOOM.min + 0.001}
          atMax={zoom >= MAP_ZOOM.max - 0.001}
          onZoomOut={() => chart.current?.zoomBy(1 / 1.4)}
          onZoomIn={() => chart.current?.zoomBy(1.4)}
          onFit={() => chart.current?.fit()}
          onToggleMinimap={() => setMinimap((on) => !on)}
          helpOpen={helpOpen}
          helpId={HELP_ID}
          onToggleHelp={() => setHelpOpen((on) => !on)}
        />
      </div>
    </section>
  );
}
