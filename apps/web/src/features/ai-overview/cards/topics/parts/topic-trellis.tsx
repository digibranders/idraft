'use client';

import dynamic from 'next/dynamic';
import { useCallback, useId, useRef, type ReactElement, type ReactNode, type RefObject } from 'react';

import { ChartLegend, type LegendItem } from '@/components/app/chart/chart-legend';
import { smallMultipleOption, type SmallMultiplePanel } from '@/components/app/chart/small-multiples';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Skeleton } from '@/components/ui/skeleton';
import type { ChartBoundary } from '@/lib/charts/boundaries';
import { chartCsv } from '@/lib/charts/chart-csv';
import type { CsvTable } from '@/lib/csv/csv-write';
import type { ChartTokens } from '@/lib/design/read-tokens';
import { formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';

// shortcut: a card local grid of small charts built on `smallMultipleOption` and `rateCeilingOf`, because
// `SmallMultiples` is a frame of its own with one grid and one group; fold it into `SmallMultiples` with a `columns`
// prop and a group per row when WP-06 allows it (plan lease L-E, follow-up F3).

// ECharts loads on the client only, after the page, like the frame's own canvas (the same chunk)
const EChart = dynamic(() => import('@/components/app/chart/echart').then((module) => module.EChart), {
  ssr: false,
  loading: () => <Skeleton shape="block" className="h-full w-full" />,
});

/** The height of every plot, in px. The last row is taller by `LABEL_ROOM`, the room its week labels take. */
const PLOT_HEIGHT = 140;
const LABEL_ROOM = 24;
const MAX_COLUMNS = 3;
/** Grid columns from the container's `@xl` width; one column below it. The classes are whole so Tailwind finds them. */
const GRID: Readonly<Record<number, string>> = { 1: '', 2: '@xl:grid-cols-2', 3: '@xl:grid-cols-3' };
const NO_BOUNDARIES: readonly ChartBoundary[] = [];

/** One small chart, or the words that stand in for it when its engine sent no series. */
export interface TrellisCell {
  /** The text name, the colour and the points of the panel; the id is unique in the card. */
  panel: SmallMultiplePanel;
  /** What the legend turns off: the engine's code. */
  column: string;
  /** The text above the chart. */
  caption: string;
  /** False: no chart is drawn, the cell says there is no weekly data. */
  hasSeries: boolean;
}

/** A row of cells. Cells of one row share a crosshair; rows do not. */
export interface TrellisRow {
  id: string;
  /** The heading of the row (the topic); `null` for none. */
  label: string | null;
  meta: string | null;
  group: string;
  cells: readonly TrellisCell[];
}

export interface TrellisWords {
  noWeekly: string;
  /** A gap in the Table view. */
  noValue: string;
  /** The latest week of a panel with its words: "Nov 9: 34%, 81 of 238 answers". */
  latest: (category: string, text: string) => string;
}

export interface TrellisLegend {
  /** The title of the card: the list is named "Series in {title}". */
  title: string;
  items: readonly LegendItem[];
  onToggle: (id: string) => void;
}

export interface TopicTrellisProps {
  rows: readonly TrellisRow[];
  /** Week labels as on the x axis. */
  categories: readonly string[];
  /** Tooltip titles, "Week of Oct 20, 2026". */
  titles: readonly string[];
  /** The top of the axis of every panel. */
  ceiling: number;
  /** The columns the legend has turned off. */
  hidden: ReadonlySet<string>;
  words: TrellisWords;
  legend?: TrellisLegend | undefined;
}

const formatRate = (value: number): string => formatPercent(value, { decimals: 0 });

/** The index of the last point with a value, or -1. */
const latestIndex = (panel: SmallMultiplePanel): number => panel.points.findLastIndex((point) => point?.value != null);

interface PanelChartProps {
  panel: SmallMultiplePanel;
  categories: readonly string[];
  titles: readonly string[];
  ceiling: number;
  showXLabels: boolean;
  height: number;
  group: string;
  /** The id of the panel the pointer is over; read when the tooltip is drawn, so it never goes stale. */
  hovered: RefObject<string | null>;
}

function PanelChart({
  panel,
  categories,
  titles,
  ceiling,
  showXLabels,
  height,
  group,
  hovered,
}: PanelChartProps): ReactElement {
  const option = useCallback(
    (tokens: ChartTokens): Record<string, unknown> =>
      smallMultipleOption(
        {
          panel,
          categories,
          titles,
          boundaries: NO_BOUNDARIES,
          ceiling,
          showXLabels,
          formatValue: formatRate,
          isActive: () => hovered.current === panel.id,
        },
        tokens,
      ),
    [panel, categories, titles, ceiling, showXLabels, hovered],
  );
  return <EChart option={option} height={height} group={group} />;
}

/**
 * The topic trends as a grid (CH-45, CH-33): a row for each topic with one small chart for each engine, all on one
 * ceiling, the crosshair connected along a row, the week labels on the last row only. Each chart is a figure named in
 * text with its latest week and counts; one that has no series says so and draws nothing. The part computes no rate:
 * the card passes finished points and words.
 */
export function TopicTrellis({
  rows,
  categories,
  titles,
  ceiling,
  hidden,
  words,
  legend,
}: TopicTrellisProps): ReactElement {
  const instance = useId();
  // The panel under the pointer: a ref, so moving between panels redraws nothing
  const hovered = useRef<string | null>(null);
  const shown = rows
    .map((row) => ({ row, cells: row.cells.filter((cell) => !hidden.has(cell.column)) }))
    .filter(({ cells }) => cells.length > 0);
  const columns = Math.min(MAX_COLUMNS, Math.max(1, ...shown.map(({ cells }) => cells.length)));
  return (
    <div className="@container flex flex-col gap-4">
      {legend === undefined ? null : (
        <ChartLegend title={legend.title} items={legend.items} onToggle={legend.onToggle} />
      )}
      {shown.map(({ row, cells }, rowIndex) => {
        const showXLabels = rowIndex === shown.length - 1;
        const height = showXLabels ? PLOT_HEIGHT + LABEL_ROOM : PLOT_HEIGHT;
        return (
          <div key={row.id} data-slot="trellis-row" className="flex flex-col gap-2">
            {row.label === null ? null : (
              <div className="flex flex-wrap items-baseline gap-x-2">
                <h3 className="type-body-strong">{row.label}</h3>
                {row.meta === null ? null : <span className="type-meta">{row.meta}</span>}
              </div>
            )}
            <div className={cn('grid grid-cols-1 gap-3', GRID[columns])}>
              {cells.map((cell) => {
                const { panel } = cell;
                const latest = latestIndex(panel);
                const latestId = `${instance}-${panel.id}`;
                return (
                  <figure
                    key={panel.id}
                    className="flex min-w-0 flex-col gap-1"
                    onPointerEnter={() => {
                      hovered.current = panel.id;
                    }}
                    onPointerLeave={() => {
                      if (hovered.current === panel.id) hovered.current = null;
                    }}
                  >
                    <figcaption className="flex flex-wrap items-baseline gap-x-2">
                      <span className="type-label">{cell.caption}</span>
                      <span id={latestId} className="type-meta">
                        {!cell.hasSeries
                          ? words.noWeekly
                          : latest < 0
                            ? words.noValue
                            : words.latest(categories[latest] ?? '', panel.points[latest]?.tip ?? words.noValue)}
                      </span>
                    </figcaption>
                    <div role="img" aria-label={panel.name} aria-describedby={latestId} style={{ height }}>
                      {cell.hasSeries ? (
                        <PanelChart
                          panel={panel}
                          categories={categories}
                          titles={titles}
                          ceiling={ceiling}
                          showXLabels={showXLabels}
                          height={height}
                          group={`${instance}-${row.group}`}
                          hovered={hovered}
                        />
                      ) : (
                        <p className="type-meta text-foreground-tertiary">{words.noWeekly}</p>
                      )}
                    </div>
                  </figure>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface WeekRow {
  category: string;
  index: number;
}

export interface TrellisTableProps {
  rows: readonly TrellisRow[];
  categories: readonly string[];
  /** The first column: "Week". */
  categoryHeader: string;
  /** Names the table for assistive technology. */
  caption: string;
  hidden: ReadonlySet<string>;
  words: Pick<TrellisWords, 'noValue'>;
}

/** The Table view: a row for each week, a column for each panel shown, with the words of the tooltips (R1); a gap is words, never 0. */
export function TrellisTable({
  rows,
  categories,
  categoryHeader,
  caption,
  hidden,
  words,
}: TrellisTableProps): ReactElement {
  const cells = rows.flatMap((row) => row.cells).filter((cell) => !hidden.has(cell.column));
  const weeks: readonly WeekRow[] = categories.map((category, index) => ({ category, index }));
  const columns: readonly PlainColumn<WeekRow>[] = [
    { id: 'category', header: categoryHeader, cell: (week) => week.category },
    ...cells.map((cell) => ({
      id: cell.panel.id,
      header: cell.panel.name,
      wrap: true,
      cell: (week: WeekRow): ReactNode => {
        const text = cell.panel.cellText[week.index] ?? null;
        return text === null ? <span className="text-foreground-tertiary">{words.noValue}</span> : text;
      },
    })),
  ];
  return (
    <PlainTable<WeekRow>
      caption={caption}
      columns={columns}
      rows={weeks}
      rowKey={(week) => `${week.category}-${String(week.index)}`}
      status="ready"
      errorState={null}
      emptyText={words.noValue}
    />
  );
}

export interface TrellisCsvInput {
  rows: readonly TrellisRow[];
  categories: readonly string[];
  categoryHeader: string;
  /** The word for a failed point (`chart.failed`). */
  failedText: string;
}

/** The export keeps every panel, shown or not, with the same words as the table (R1); a gap is an empty cell. */
export function trellisCsv({ rows, categories, categoryHeader, failedText }: TrellisCsvInput): CsvTable {
  const cells = rows.flatMap((row) => row.cells);
  return chartCsv({
    categoryHeader,
    categories,
    series: cells.map(({ panel }) => ({
      id: panel.id,
      name: panel.name,
      role: panel.role,
      values: panel.points.map((point) => point?.value ?? null),
    })),
    cellText: (id, index) => cells.find((cell) => cell.panel.id === id)?.panel.cellText[index] ?? null,
    failedText,
  });
}
