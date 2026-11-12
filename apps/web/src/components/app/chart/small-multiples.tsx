'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useCallback, useId, useMemo, useState, type ReactElement, type ReactNode } from 'react';

import { ChartFrame, type ChartEmpty, type ChartError, type ChartNotice } from './chart-frame';
import type { LegendItem } from './chart-legend';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Skeleton } from '@/components/ui/skeleton';
import { announce } from '@/lib/a11y/announcer';
import type { ChartBoundary } from '@/lib/charts/boundaries';
import { categoryChartOption, type CategorySeries, type SeriesRole } from '@/lib/charts/category-chart';
import { chartCsv } from '@/lib/charts/chart-csv';
import { rateBandOption, type RateBandPoint } from '@/lib/charts/rate-band-chart';
import type { ChartTokens } from '@/lib/design/read-tokens';
import { formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';

// ECharts loads on the client only, after the page, like the frame's own canvas (the same chunk)
const EChart = dynamic(() => import('./echart').then((module) => module.EChart), {
  ssr: false,
  loading: () => <Skeleton shape="block" className="h-full w-full" />,
});

/** One small chart: the same measure for one engine, topic or channel. */
export interface SmallMultiplePanel {
  id: string;
  /** "ChatGPT": the text name of the chart. */
  name: string;
  /** The engine's colour and marker, by its fixed order (`engineRole` of the feature). */
  role: SeriesRole;
  /** One per category; `null` is a gap, and a thin point is drawn hollow (R2). */
  points: readonly (RateBandPoint | null)[];
  /** Compare on: the previous window, dashed in `chart-reference`, on the same category index. */
  previous?: readonly (number | null)[] | undefined;
  /** The Table view and CSV words per category, "34%, 81 of 238 answers" (R1); `null` prints `chart.noValue`. */
  cellText: readonly (string | null)[];
}

type MultiplesState =
  | { status: 'loading' | 'ready' | 'refetching'; empty?: undefined; error?: undefined }
  | { status: 'empty'; empty: ChartEmpty; error?: undefined }
  | { status: 'error'; error: ChartError; empty?: undefined };

export type SmallMultiplesProps = MultiplesState & {
  title: string;
  variant: 'panel' | 'inspector';
  meta?: string | null | undefined;
  /** Stale or partial data, at the end of the meta line. */
  notice?: ChartNotice | undefined;
  footnote?: ReactNode;
  /** Week labels as on the x axis, "Oct 20". */
  categories: readonly string[];
  /** The first column of the Table view: "Week". */
  categoryHeader: string;
  /** Tooltip titles where the label is not all there is to say, "Week of Oct 20, 2026". */
  titles?: readonly string[] | undefined;
  panels: readonly SmallMultiplePanel[];
  boundaries?: readonly ChartBoundary[] | undefined;
  /** 140 in a column of charts, 180 where each chart stands on its own. */
  height: 140 | 180;
  /** What the charts show, in one or two sentences, for people who cannot see them. */
  summary: string;
  /** No PNG: the menu carries CSV and the link. */
  menu?: { fileName: string; link?: string | undefined } | undefined;
};

/** Room the x labels take under the plot, in px: the panel that carries them is this much taller, so plots stay equal. */
const LABEL_ROOM = 24;
/** Grid columns from 768 px: panels in the last row carry the x labels. */
const WIDE_COLUMNS = 2;
/** One array for every render, so a panel's option is not rebuilt when a feature gives no boundaries. */
const NO_BOUNDARIES: readonly ChartBoundary[] = [];

/** The marker of each engine by its role, as the line chart has it: circle, square, triangle, diamond (inventory 4.2). */
const PALETTE_SYMBOLS = ['rect', 'triangle', 'diamond', 'roundRect', 'pin'] as const;
function markerOf(role: SeriesRole): string {
  return role.kind === 'palette' ? (PALETTE_SYMBOLS[role.index - 2] ?? 'circle') : 'circle';
}

const highest = (top: number, value: number | null | undefined): number => Math.max(top, value ?? 0);

/**
 * The top of the rate axis of every panel (inventory 4.2): the next tenth above the highest value or band of any
 * panel or previous period, at least 0.1 and at most 1. One number for all, so a panel's height means the same
 * rate in each.
 */
export function rateCeilingOf(panels: readonly SmallMultiplePanel[]): number {
  const top = panels.reduce((panelTop, panel) => {
    const drawn = panel.points.reduce(
      (pointTop, point) => highest(highest(pointTop, point?.band?.high), point?.value),
      panelTop,
    );
    return (panel.previous ?? []).reduce(highest, drawn);
  }, 0);
  // The small step takes a tenth that floating point puts a hair above (0.3 as 0.30000000000000004) back down
  return Math.min(1, Math.max(0.1, Math.ceil(top * 10 - 1e-9) / 10));
}

export interface SmallMultipleOptionInput {
  panel: SmallMultiplePanel;
  categories: readonly string[];
  titles?: readonly string[] | undefined;
  boundaries: readonly ChartBoundary[];
  ceiling: number;
  /** Only the last panel (or row) draws the week labels. */
  showXLabels: boolean;
  formatValue: (value: number) => string;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

/**
 * The option of one panel: a category line chart of the panel's series and its previous period, then the band, hollow
 * thin points, boundaries and tooltip of `rateBandOption`, on the one ceiling. A point with no value is a gap, never 0.
 */
export function smallMultipleOption(input: SmallMultipleOptionInput, tokens: ChartTokens): Record<string, unknown> {
  const { panel, categories, titles, boundaries, ceiling, showXLabels, formatValue } = input;
  const previousId = `${panel.id}:previous`;
  const series: CategorySeries[] = [
    { id: panel.id, name: panel.name, role: panel.role, values: panel.points.map((point) => point?.value ?? null) },
    ...(panel.previous === undefined
      ? []
      : [{ id: previousId, name: panel.name, role: { kind: 'reference' } as const, values: panel.previous }]),
  ];
  const base = categoryChartOption({
    kind: 'line',
    categories,
    series,
    hidden: new Set(),
    patterns: false,
    tokens,
    formatValue,
  });
  // `categoryChartOption` picks a marker by the series' place in its chart, which is always the first here; the
  // thin point copies the marker, so it is set before `rateBandOption`
  const marker = markerOf(panel.role);
  const marked = {
    ...base,
    series: (base.series as { id?: string }[]).map((entry) =>
      entry.id === panel.id ? { ...entry, symbol: marker } : entry,
    ),
  };
  const banded = rateBandOption(marked, tokens, {
    points: { [panel.id]: panel.points },
    ceiling,
    // The band is a little stronger on the dark ground (15 section 4); the theme is a class of the page
    dark: document.documentElement.classList.contains('dark'),
    titles,
    previousId: panel.previous === undefined ? undefined : previousId,
    boundaries,
  });
  const xAxis = asRecord(banded.xAxis);
  return {
    ...banded,
    // Three labels, 0, half and the ceiling, so the one scale reads at a glance and the labels stay clear of each other
    yAxis: { ...asRecord(banded.yAxis), interval: ceiling / 2 },
    xAxis: showXLabels ? xAxis : { ...xAxis, axisLabel: { ...asRecord(xAxis.axisLabel), show: false } },
  };
}

/** The index of the last point with a value, or -1. */
function latestIndex(points: readonly (RateBandPoint | null)[]): number {
  return points.findLastIndex((point) => point?.value != null);
}

interface PanelChartProps {
  panel: SmallMultiplePanel;
  categories: readonly string[];
  titles: readonly string[] | undefined;
  boundaries: readonly ChartBoundary[];
  ceiling: number;
  showXLabels: boolean;
  height: number;
  group: string;
}

const formatRate = (value: number): string => formatPercent(value, { decimals: 0 });

function PanelChart({ panel, showXLabels, height, group, ...shared }: PanelChartProps): ReactElement {
  const { categories, titles, boundaries, ceiling } = shared;
  const option = useCallback(
    (tokens: ChartTokens): Record<string, unknown> =>
      smallMultipleOption(
        { panel, categories, titles, boundaries, ceiling, showXLabels, formatValue: formatRate },
        tokens,
      ),
    [panel, categories, titles, boundaries, ceiling, showXLabels],
  );
  return <EChart option={option} height={height} group={group} />;
}

interface TableRow {
  category: string;
  index: number;
}

/**
 * A grid of small charts of one measure (15-data-visualization.md section 5, CH-01 and CH-33): one ceiling for all,
 * one connected crosshair, one Table view of every panel, and the frame's states. A panel is a figure named in text
 * with its latest value and counts. The parts compute no rate: the feature passes finished points and words.
 */
export function SmallMultiples(props: SmallMultiplesProps): ReactElement {
  const { title, variant, meta, notice, footnote, categories, categoryHeader, titles, panels, height, summary, menu } =
    props;
  const { boundaries = NO_BOUNDARIES } = props;
  const t = useTranslations('chart');
  const multiples = useTranslations('chart.multiples');
  const group = useId();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());

  // At least one panel shows: turned-off ids that no longer match a panel never empty the grid
  const turnedOn = panels.filter((panel) => !hidden.has(panel.id));
  const shown = turnedOn.length === 0 ? panels : turnedOn;
  const ceiling = useMemo(() => rateCeilingOf(panels), [panels]);

  const toggle = (id: string): void => {
    const panel = panels.find((entry) => entry.id === id);
    if (panel === undefined) return;
    if (!hidden.has(id) && shown.length <= 1) {
      // The legend has already said it is hidden; this says what really happened, after it
      // Its own key: the legend's announcement has none, and a keyless one cancels a waiting keyless message
      announce(multiples('keepOne', { name: panel.name }), { debounceMs: 100, key: 'multiples-keep-one' });
      return;
    }
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const legend: readonly LegendItem[] = panels.map((panel) => ({
    id: panel.id,
    name: panel.name,
    role: panel.role,
    pressed: shown.includes(panel),
  }));

  // In a grid of two columns the last row is the bottom of the charts; one column has a single last panel.
  // Limit: below 768 px a grid of four or more is one column, and the panel before the last also shows labels
  // (the canvas cannot follow a breakpoint without a media query hook).
  const columns = shown.length > WIDE_COLUMNS ? WIDE_COLUMNS : 1;
  const labelledFrom = shown.length - (shown.length % columns === 0 ? columns : shown.length % columns);
  const body = (
    <div className={cn('grid grid-cols-1 gap-3', columns > 1 && 'md:grid-cols-2')}>
      {shown.map((panel, index) => {
        const showXLabels = index >= labelledFrom;
        const latest = latestIndex(panel.points);
        const latestId = `${group}-${panel.id}`;
        return (
          <figure key={panel.id} className="flex min-w-0 flex-col gap-1">
            <figcaption className="flex flex-wrap items-baseline gap-x-2">
              <span className="type-label">{panel.name}</span>
              <span id={latestId} className="type-meta">
                {latest < 0
                  ? t('noValue')
                  : multiples('latest', {
                      category: categories[latest] ?? '',
                      text: panel.points[latest]?.tip ?? t('noValue'),
                    })}
              </span>
            </figcaption>
            <div
              role="img"
              aria-label={panel.name}
              aria-describedby={latestId}
              style={{ height: showXLabels ? height + LABEL_ROOM : height }}
            >
              <PanelChart
                panel={panel}
                categories={categories}
                titles={titles}
                boundaries={boundaries}
                ceiling={ceiling}
                showXLabels={showXLabels}
                height={showXLabels ? height + LABEL_ROOM : height}
                group={group}
              />
            </div>
          </figure>
        );
      })}
    </div>
  );

  // One table for all the panels shown, a column each; a gap is "No data", never 0 (R6)
  const rows: readonly TableRow[] = categories.map((category, index) => ({ category, index }));
  const columnsOfTable: readonly PlainColumn<TableRow>[] = [
    { id: 'category', header: categoryHeader, cell: (row) => row.category },
    ...shown.map((panel) => ({
      id: panel.id,
      header: panel.name,
      wrap: true,
      cell: (row: TableRow): ReactNode => {
        const words = panel.cellText[row.index] ?? null;
        return words === null ? <span className="text-foreground-tertiary">{t('noValue')}</span> : words;
      },
    })),
  ];
  const table = (
    <PlainTable<TableRow>
      caption={title}
      columns={columnsOfTable}
      rows={rows}
      rowKey={(row) => `${row.category}-${String(row.index)}`}
      status="ready"
      errorState={null}
      emptyText={t('noValue')}
    />
  );

  // The export keeps every panel, shown or not, with the same words as the table (R1)
  const csv = useMemo(
    () =>
      chartCsv({
        categoryHeader,
        categories,
        series: panels.map((panel) => ({
          id: panel.id,
          name: panel.name,
          role: panel.role,
          values: panel.points.map((point) => point?.value ?? null),
        })),
        cellText: (id, index) => panels.find((panel) => panel.id === id)?.cellText[index] ?? null,
        failedText: t('failed'),
      }),
    [categoryHeader, categories, panels, t],
  );

  const state: MultiplesState =
    props.status === 'empty'
      ? { status: 'empty', empty: props.empty }
      : props.status === 'error'
        ? { status: 'error', error: props.error }
        : { status: props.status };

  return (
    <ChartFrame
      kind="html"
      title={title}
      variant={variant}
      meta={meta}
      notice={notice}
      footnote={footnote}
      height={height}
      summary={summary}
      legend={legend}
      onLegendToggle={toggle}
      body={body}
      table={table}
      menu={menu === undefined ? undefined : { fileName: menu.fileName, link: menu.link, csv }}
      {...state}
    />
  );
}
