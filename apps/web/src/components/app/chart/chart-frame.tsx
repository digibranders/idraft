'use client';

import { CircleDashed, Clock } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';

import { useCardReadiness, useCurrentCardId } from './card-readiness';
import { ChartLegend, type LegendItem } from './chart-legend';
import { ChartMenu, type ChartMenuAction } from './chart-menu';
import { InlineError, type InlineErrorProps } from '@/components/app/status/inline-error';
import { EmptyState } from '@/components/app/status/empty-state';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { categoryChartOption, seriesColor, type CategorySeries } from '@/lib/charts/category-chart';
import { chartCsv } from '@/lib/charts/chart-csv';
import { readLightChartColors, type LightChartColors } from '@/lib/charts/light-tokens';
import type { PngFrameText } from '@/lib/charts/png-layout';
import type { CsvTable } from '@/lib/csv/csv-write';
import type { ChartTokens } from '@/lib/design/read-tokens';
import { cn } from '@/lib/utils';

// ECharts loads on the client only, after the page; the frame holds the chart's height meanwhile
const EChart = dynamic(() => import('./echart').then((module) => module.EChart), {
  ssr: false,
  loading: () => <Skeleton shape="block" className="h-full w-full" />,
});

export type ChartHeight = 140 | 180 | 240 | 280;

export type ChartStatus = 'loading' | 'ready' | 'refetching' | 'empty' | 'error';

/** Empty (17-empty-loading-error-states.md section 2): what is missing, why, and the one action that changes it. */
export interface ChartEmpty {
  title: string;
  reason: string;
  action?: ReactNode | undefined;
}

/** Error (17 section 5.2): `InlineError` in the chart's reserved height. */
export type ChartError = Omit<InlineErrorProps, 'live'>;

/** A qualifier of ready data, shown at the end of the meta line (17 section 7.1). */
export interface ChartNotice {
  kind: 'stale' | 'partial';
  /** "Stale: last collected Sep 27, 18:30 CEST", "Partial data: 612 of 1,000 prompts asked". */
  text: string;
}

/** What the html kind's body draws into the PNG: an image of the body in the light colours, at `width`. */
export interface PngBodyImage {
  image: CanvasImageSource;
  height: number;
}
export type ChartPngBody = (colors: LightChartColors, width: number) => Promise<PngBodyImage>;

interface ChartMenuBase {
  /** File name without extension, chosen by the feature: "mention-rate-by-engine". */
  fileName: string;
  /** An absolute address that opens this view; Copy link copies it as given. */
  link?: string | undefined;
}
export interface CategoryChartMenu extends ChartMenuBase {
  /** Download PNG: the frame draws the chart as shown (hidden series, patterns) in the light theme. */
  png?: boolean | undefined;
  /** Download CSV: `true` writes the series (`chartCsv`), a table replaces it. */
  csv?: boolean | CsvTable | undefined;
}
export interface HtmlChartMenu extends ChartMenuBase {
  /** Draws the body in the light colours it is given; the frame adds the title, meta, legend and footnote. */
  png?: ChartPngBody | undefined;
  csv?: CsvTable | undefined;
}

interface ChartFrameCommon {
  title: string;
  /** `panel` on a page; `inspector` drops the border and side padding and uses the smaller title. */
  variant: 'panel' | 'inspector';
  /** Window, sample size, version boundaries: "Last 12 months, Google Ads data". */
  meta?: string | null | undefined;
  /** Stale or partial data, at the end of the meta line. */
  notice?: ChartNotice | undefined;
  /** Method and filters that change how to read it. */
  footnote?: ReactNode;
  /** Controls that change what is drawn (a window, layers), between the header and the chart. */
  controls?: ReactNode;
  /** Reserved for the skeleton, the empty and the error state; the canvas height of line and bar. */
  height: ChartHeight;
  /**
   * Loading only: the height in px the loading body reserves when the loaded body is taller than `height` (a list
   * of rows), so the panel does not grow when the data arrives. Never less than `height`; left out, the loading body
   * is `height` tall. The empty and error states and the ready chart ignore it.
   */
  loadingHeight?: number | undefined;
  /** What the chart shows, in one or two sentences, for people who cannot see it. */
  summary: string;
}

type ChartFrameState =
  | { status: 'loading' | 'ready' | 'refetching'; empty?: undefined; error?: undefined }
  | { status: 'empty'; empty: ChartEmpty; error?: undefined }
  | { status: 'error'; error: ChartError; empty?: undefined };

export interface CategoryFrameProps extends ChartFrameCommon {
  kind: 'line' | 'bar';
  categories: readonly string[];
  /** The first column of the table view: "Month". */
  categoryHeader: string;
  series: readonly CategorySeries[];
  formatValue: (value: number) => string;
  /**
   * The words of one point in the Table view, where the bare value is not all there is to say ("40%, 4 of 10
   * answers, 15% to 70%"); `null` keeps the value. Keep it stable (`useCallback`).
   */
  cellText?: ((seriesId: string, index: number) => string | null) | undefined;
  /** Adds to the line or bar option, such as a rank axis (`lib/charts/rank-chart.ts`). Keep it stable (`useCallback`). */
  extendOption?: ((option: Record<string, unknown>, tokens: ChartTokens) => Record<string, unknown>) | undefined;
  /** Bars of a category stack into one column; lines ignore it. */
  stacked?: boolean | undefined;
  menu?: CategoryChartMenu | undefined;
}

export interface HtmlBodyView {
  patterns: boolean;
}

export interface HtmlFrameProps extends ChartFrameCommon {
  kind: 'html';
  legend?: readonly LegendItem[] | undefined;
  /** Given: the legend items are toggle buttons; left out: a plain key. */
  onLegendToggle?: ((id: string) => void) | undefined;
  /** The chart itself: a list, a table, bars in HTML. A function receives the Patterns state. */
  body: ReactNode | ((view: HtmlBodyView) => ReactNode);
  /** The Table view: a `SimpleTable` with value, k, n and interval columns. */
  table: ReactNode;
  /** Show the Patterns toggle (bars that use decals or hatching). */
  patterns?: boolean | undefined;
  menu?: HtmlChartMenu | undefined;
  /** Natural content height: does not force minHeight on the loaded body. */
  fitContent?: boolean | undefined;
}

export type ChartFrameProps = (CategoryFrameProps | HtmlFrameProps) & ChartFrameState;

type CategoryProps = Extract<ChartFrameProps, { kind: 'line' | 'bar' }>;
type HtmlProps = Extract<ChartFrameProps, { kind: 'html' }>;

/**
 * Every chart's frame (15-data-visualization.md section 2): the title, a meta line, a React legend that
 * toggles series, a Table view of the same numbers, Patterns for bars, an overflow menu, and a footnote. A
 * line or bar chart is a canvas, an image named by the title and described by the summary; an html chart is
 * its own body. The table is the full alternative of both. Loading, empty and error keep the title and the
 * height, and refetching keeps the chart.
 */
export function ChartFrame(props: ChartFrameProps): ReactElement {
  const cardId = useCurrentCardId();
  const readiness = useCardReadiness();
  useEffect(() => {
    if (cardId && readiness) {
      readiness.report(cardId, props.status);
    }
  }, [cardId, readiness, props.status]);

  return props.kind === 'html' ? <HtmlFrame {...props} /> : <CategoryFrame {...props} />;
}

function CategoryFrame(props: CategoryProps): ReactElement {
  const { kind, categories, categoryHeader, series, formatValue, cellText, stacked, extendOption, menu } = props;
  const { title, meta, notice, height } = props;
  const t = useTranslations('chart');
  const summaryId = useId();
  const section = useRef<HTMLElement>(null);
  const footnote = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [table, setTable] = useState(false);
  const [patterns, setPatterns] = useState(false);
  const toggleSeries = (id: string): void =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const option = useCallback(
    (tokens: ChartTokens): Record<string, unknown> => {
      const base = categoryChartOption({ kind, categories, series, hidden, patterns, tokens, formatValue, stacked });
      return extendOption === undefined ? base : extendOption(base, tokens);
    },
    [kind, categories, series, hidden, patterns, formatValue, stacked, extendOption],
  );
  const legend: LegendItem[] = series.map((entry) => ({
    id: entry.id,
    name: entry.name,
    role: entry.role,
    pressed: !hidden.has(entry.id),
  }));
  const csv = menu?.csv;
  const actions: ChartMenuAction = {
    png:
      menu?.png === true
        ? () =>
            exportPng(
              (colors) => pngFrameText({ title, meta, notice, legend, footnote }, colors),
              section,
              (png) => png.echartBody(option, height),
            )
        : undefined,
    csv:
      csv === undefined || csv === false
        ? undefined
        : () =>
            csv === true ? chartCsv({ categoryHeader, categories, series, cellText, failedText: t('failed') }) : csv,
    link: menu?.link,
  };
  return (
    <FrameShell
      common={props}
      state={props}
      summaryId={summaryId}
      section={section}
      footnoteRef={footnote}
      legend={<ChartLegend title={title} items={legend} onToggle={toggleSeries} />}
      views={{
        patterns: kind === 'bar' ? { on: patterns, onToggle: () => setPatterns((on) => !on) } : null,
        table: { on: table, onToggle: () => setTable((on) => !on) },
        fileName: menu?.fileName ?? '',
        actions,
      }}
    >
      {table ? (
        <ChartTable
          title={title}
          categoryHeader={categoryHeader}
          categories={categories}
          series={series}
          formatValue={formatValue}
          cellText={cellText}
          noValue={t('noValue')}
        />
      ) : (
        <div role="img" aria-label={title} aria-describedby={summaryId} style={{ height }}>
          <EChart option={option} height={height} />
        </div>
      )}
    </FrameShell>
  );
}

function HtmlFrame(props: HtmlProps): ReactElement {
  const {
    title,
    meta,
    notice,
    height,
    legend = [],
    onLegendToggle,
    body,
    table: tableView,
    patterns: hasPatterns,
    menu,
  } = props;
  const summaryId = useId();
  const section = useRef<HTMLElement>(null);
  const footnote = useRef<HTMLDivElement>(null);
  const [table, setTable] = useState(false);
  const [patterns, setPatterns] = useState(false);
  const png = menu?.png;
  const csv = menu?.csv;
  const actions: ChartMenuAction = {
    png:
      png === undefined
        ? undefined
        : () =>
            exportPng(
              (colors) => pngFrameText({ title, meta, notice, legend, footnote }, colors),
              section,
              () => png,
            ),
    csv: csv === undefined ? undefined : () => csv,
    link: menu?.link,
  };
  return (
    <FrameShell
      common={props}
      state={props}
      summaryId={summaryId}
      section={section}
      footnoteRef={footnote}
      legend={<ChartLegend title={title} items={legend} onToggle={onLegendToggle} />}
      views={{
        patterns: hasPatterns === true ? { on: patterns, onToggle: () => setPatterns((on) => !on) } : null,
        table: { on: table, onToggle: () => setTable((on) => !on) },
        fileName: menu?.fileName ?? '',
        actions,
      }}
    >
      {table ? (
        tableView
      ) : (
        <div style={{ minHeight: props.fitContent ? undefined : height }}>
          {typeof body === 'function' ? body({ patterns }) : body}
        </div>
      )}
    </FrameShell>
  );
}

type ChartPngModule = typeof import('./chart-png');

/**
 * The image is drawn by `chart-png.ts`, which loads only now: ECharts and the canvas code stay out of the first
 * chunk. The light colours are read once, for the legend and for the drawing.
 */
async function exportPng(
  frame: (colors: LightChartColors) => PngFrameText,
  section: RefObject<HTMLElement | null>,
  body: (png: ChartPngModule) => ChartPngBody,
): Promise<Blob> {
  const png = await import('./chart-png');
  const colors = readLightChartColors();
  return png.renderChartPng({
    frame: frame(colors),
    colors,
    // 0 before the frame is laid out; `renderChartPng` falls back to a default width
    width: section.current?.clientWidth ?? 0,
    body: body(png),
  });
}

interface PngFrameSource {
  title: string;
  meta: string | null | undefined;
  notice: ChartNotice | undefined;
  legend: readonly LegendItem[];
  footnote: RefObject<HTMLDivElement | null>;
}

/**
 * The text and legend of the image: what the frame shows now, in the light theme's colours. The stale or partial
 * notice goes on the meta line, so the picture keeps the qualifier of its numbers.
 */
function pngFrameText(
  { title, meta, notice, legend, footnote }: PngFrameSource,
  colors: LightChartColors,
): PngFrameText {
  const tokens = colors.chart;
  const note = footnote.current?.textContent.trim() ?? '';
  const metaLine = [meta, notice?.text].filter((part) => part !== null && part !== undefined && part !== '').join(', ');
  return {
    title,
    meta: metaLine === '' ? null : metaLine,
    // Like the legend on screen, the image has none for a single series
    legend:
      legend.length < 2
        ? []
        : legend
            .filter((item) => item.pressed)
            .map((item) => ({
              name: item.name,
              color: seriesColor(item.role, tokens),
              dash: item.role.kind === 'reference' || item.role.kind === 'other' ? 'dashed' : 'solid',
            })),
    footnote: note === '' ? null : note,
  };
}

interface ViewsProps {
  /** `null` where the chart has no patterns. */
  patterns: { on: boolean; onToggle: () => void } | null;
  table: { on: boolean; onToggle: () => void };
  /** The menu's file name and actions; no menu when `actions` has none. */
  fileName: string;
  actions: ChartMenuAction;
}

interface FrameShellProps {
  common: ChartFrameCommon;
  state: ChartFrameState;
  summaryId: string;
  section: RefObject<HTMLElement | null>;
  footnoteRef: RefObject<HTMLDivElement | null>;
  legend: ReactNode;
  views: ViewsProps;
  /** What a ready or refetching chart shows. */
  children: ReactNode;
}

/** The parts every chart has, whatever it draws: the header, the states, the views and the footnote. */
function FrameShell({
  common,
  state,
  summaryId,
  section,
  footnoteRef,
  legend,
  views,
  children,
}: FrameShellProps): ReactElement {
  const t = useTranslations('chart');
  const { title, variant, meta, notice, footnote, controls, height, loadingHeight, summary } = common;
  const { status } = state;
  // "Updating" appears when a refetch has run for 400 ms (the table's rule)
  const [showUpdating, setShowUpdating] = useState(false);
  useEffect(() => {
    if (status !== 'refetching') return undefined;
    const timer = setTimeout(() => setShowUpdating(true), 400);
    return () => {
      clearTimeout(timer);
      setShowUpdating(false);
    };
  }, [status]);
  const hasControls = controls !== undefined && controls !== null;
  const hasMeta = meta !== null && meta !== undefined;
  const showViews = status === 'ready' || status === 'refetching';
  const viewsGroup = showViews ? <ChartViews title={title} {...views} alignEnd={hasControls} /> : null;
  const inspector = variant === 'inspector';
  const Title = inspector ? 'h3' : 'h2';

  if (status === 'empty') {
    const { empty } = state;
    return (
      <section
        ref={section}
        aria-label={title}
        data-slot="empty-state"
        className={cn(
          'flex min-w-0 flex-col justify-center transition-colors',
          inspector ? 'py-1' : 'rounded-lg border border-border bg-surface px-4 py-3',
        )}
      >
        <p id={summaryId} className="sr-only">
          {summary}
        </p>
        {hasControls ? <div className="flex flex-wrap items-center gap-x-2 gap-y-2 pb-2">{controls}</div> : null}
        <div data-slot="chart-state" className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <Title className={inspector ? 'type-subsection-title' : 'shrink-0 type-section-title'}>{title}</Title>
            <h3 className="sr-only">{empty.title}</h3>
            <p className="max-w-full truncate type-meta text-foreground-secondary">{empty.reason || empty.title}</p>
          </div>
          {empty.action ? <div className="shrink-0">{empty.action}</div> : null}
        </div>
        {footnote ? <div className="sr-only">{footnote}</div> : null}
      </section>
    );
  }

  return (
    <section
      ref={section}
      aria-busy={status === 'loading' || status === 'refetching' ? true : undefined}
      className={cn(
        'flex h-full flex-col gap-3',
        inspector ? 'py-1' : 'rounded-lg border border-border bg-surface p-4',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* The title keeps a readable measure: the legend and the views wrap to the next line before it narrows */}
        <div className="flex min-w-0 shrink grow basis-64 flex-col">
          <div className="flex items-center gap-2">
            <Title className={inspector ? 'type-subsection-title' : 'type-section-title'}>{title}</Title>
            {showUpdating ? (
              <span className="inline-flex items-center gap-1 type-meta">
                <Spinner size="sm" />
                {t('updating')}
              </span>
            ) : null}
          </div>
          {hasMeta || notice !== undefined ? (
            <div className="flex flex-wrap items-center gap-x-2">
              {hasMeta ? <p className="type-meta">{meta}</p> : null}
              {notice === undefined ? null : (
                <p className="inline-flex items-center gap-1 type-meta text-warning-text">
                  <Icon icon={notice.kind === 'stale' ? Clock : CircleDashed} size="sm" />
                  {notice.text}
                </p>
              )}
            </div>
          ) : null}
        </div>
        {legend}
        {hasControls ? null : viewsGroup}
      </div>
      {hasControls ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          {controls}
          {viewsGroup}
        </div>
      ) : null}
      {/* Read before the chart, which is why it comes first; the canvas also points at it */}
      <p id={summaryId} className="sr-only">
        {summary}
      </p>
      <FrameBody state={state} height={height} loadingHeight={loadingHeight}>
        {children}
      </FrameBody>
      {footnote === undefined || footnote === null ? null : (
        <div ref={footnoteRef} className="mt-auto type-meta">
          {footnote}
        </div>
      )}
    </section>
  );
}

/** The chart, or what stands in for it in the height it reserves. */
function FrameBody({
  state,
  height,
  loadingHeight,
  children,
}: {
  state: ChartFrameState;
  height: ChartHeight;
  loadingHeight: number | undefined;
  children: ReactNode;
}): ReactElement {
  if (state.status === 'loading') {
    return (
      <div style={{ height: Math.max(height, loadingHeight ?? 0) }}>
        <Skeleton shape="block" className="h-full w-full" />
      </div>
    );
  }
  if (state.status === 'empty') {
    return (
      <div data-slot="chart-state" style={{ minHeight: height }}>
        <EmptyState
          variant="inline"
          headingLevel={3}
          title={state.empty.title}
          reason={state.empty.reason}
          primaryAction={state.empty.action}
        />
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div data-slot="chart-state" style={{ minHeight: height }}>
        <InlineError {...state.error} />
      </div>
    );
  }
  return (
    // The same wrapper for ready and refetching, so the chart stays mounted when a refetch starts
    <div className="relative min-h-0 flex-1">
      {state.status === 'refetching' ? (
        <div aria-hidden="true" data-slot="chart-refetch-bar" className="absolute inset-x-0 top-0 h-0.5 bg-primary" />
      ) : null}
      {children}
    </div>
  );
}

function ChartViews({
  title,
  patterns,
  table,
  fileName,
  actions,
  alignEnd,
}: ViewsProps & { title: string; alignEnd: boolean }): ReactElement {
  const t = useTranslations('chart');
  return (
    <div
      role="group"
      aria-label={t('views', { title })}
      className={cn('flex items-center gap-1', alignEnd && 'ml-auto')}
    >
      {/* Toggle buttons: pressed reads as the secondary fill, released as ghost */}
      {patterns !== null && !table.on ? (
        <Button size="sm" variant="ghost" aria-pressed={patterns.on} onClick={patterns.onToggle}>
          {t('patterns')}
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" aria-pressed={table.on} onClick={table.onToggle}>
        {t('table')}
      </Button>
      <ChartMenu title={title} fileName={fileName} actions={actions} />
    </div>
  );
}

/** The chart's numbers as a simple table (12-tables.md section 15): a row per category, a column per series. */
function ChartTable({
  title,
  categoryHeader,
  categories,
  series,
  formatValue,
  cellText,
  noValue,
}: {
  title: string;
  categoryHeader: string;
  categories: readonly string[];
  series: readonly CategorySeries[];
  formatValue: (value: number) => string;
  cellText: CategoryFrameProps['cellText'];
  noValue: string;
}): ReactElement {
  const t = useTranslations('chart');
  return (
    // A scrolling region is reached by keyboard and named (WCAG 2.1.1, axe scrollable-region-focusable)
    <div
      role="region"
      aria-label={t('tableRegion', { title })}
      tabIndex={0}
      className="max-h-70 overflow-auto rounded-lg border border-border-subtle outline-none focus-visible:focus-ring"
    >
      <table className="w-full border-collapse type-table">
        <caption className="sr-only">{title}</caption>
        <thead>
          <tr className="bg-surface-subtle">
            <th scope="col" className="h-row-compact px-4 text-left type-table-header">
              {categoryHeader}
            </th>
            {series.map((entry) => (
              <th key={entry.id} scope="col" className="h-row-compact px-4 text-left type-table-header">
                {entry.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {categories.map((category, index) => (
            <tr key={`${category}-${String(index)}`} className="border-t border-border-subtle">
              <th
                scope="row"
                className="h-row-compact px-4 text-left font-normal whitespace-nowrap text-foreground-secondary"
              >
                {category}
              </th>
              {series.map((entry) => {
                const value = entry.values[index];
                return (
                  <td key={entry.id} className="h-row-compact px-4 text-left num">
                    {value === 'failed' ? (
                      <span className="text-foreground-secondary">{t('failed')}</span>
                    ) : value === null || value === undefined ? (
                      <span className="text-foreground-tertiary">{noValue}</span>
                    ) : (
                      (cellText?.(entry.id, index) ?? formatValue(value))
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
