import { engineRole } from './engine-role';
import type { EngineInfo, TopicNode } from './model-types';
import { topLevelOf } from './topic-nodes';
import { enginePoints, type TopicPoint } from './topic-points';
import { rateCeilingOf, type SmallMultiplePanel } from '@/components/app/chart/small-multiples';
import type { RateBandPoint } from '@/lib/charts/rate-band-chart';
import { rateTipText, type RateTipWords } from '@/lib/charts/rate-tip';
import { safeText, type CsvCell } from '@/lib/csv/csv-write';
import { formatChartDate } from '@/lib/format';
import type { CellMetric } from '@/lib/rates/rate-model';

/**
 * The weekly points of the top topics on each asked engine (CH-45 and CH-33), as plain data. The API pools a topic
 * week when too few prompts answered it; this reads that, and never pools itself. A week with no valid answer is a
 * gap, a point under 4 valid answers is hollow with no band, and an engine without a series has no points at all:
 * none of them is ever a point at 0. The words come in as arguments.
 */

/** The columns of the trend cards' export blocks: data names, not words for a person. */
export const TREND_EXPORT_HEADER = ['topic', 'engine', 'week', 'rate_percent', 'answers', 'status'] as const;

export const trendFileName = (metric: string): string => `topic-trends-by-engine-${metric}`;

export interface TrendWords {
  rateTip: RateTipWords;
  /** Share of voice has no count of successes: "21%, 40 valid answers name a tracked brand". */
  share: (value: number, answers: number) => string;
  /** The weeks a pooled point holds and the day they end (an ISO date): "4 weeks to Nov 12". */
  pooledTo: (weeks: number, to: string) => string;
}

export interface TrendCell {
  engine: EngineInfo;
  /** One entry for each week of the model, `null` where the engine's series has no week; `null` itself: no series at all. */
  points: (TopicPoint | null)[] | null;
}

export interface TrendRow {
  node: TopicNode;
  cells: TrendCell[];
}

export interface TrendModel {
  /** The Mondays of every series together, oldest first. */
  weeks: string[];
  rows: TrendRow[];
  /** Top level topics in the read, before the cut. */
  total: number;
}

/** More prompts first; a tie goes to the name. */
const byPromptsThenName = (a: TopicNode, b: TopicNode): number =>
  b.promptCount - a.promptCount || a.name.localeCompare(b.name);

export interface BuildTrendInput {
  nodes: readonly TopicNode[];
  engines: readonly EngineInfo[];
  metric: CellMetric;
  /** How many topics to draw. */
  count: number;
}

/** The `count` top level topics with the most prompts, and for each the weekly points of every engine asked. */
export function buildTrend({ nodes, engines, metric, count }: BuildTrendInput): TrendModel {
  const top = topLevelOf(nodes);
  const raw = [...top]
    .sort(byPromptsThenName)
    .slice(0, count)
    .map((node) => ({
      node,
      cells: engines.map((engine) => ({
        engine,
        series: enginePoints(
          node.engines.find((cells) => cells.engine_code === engine.code),
          metric,
        ),
      })),
    }));
  const weeks = [
    ...new Set(raw.flatMap((row) => row.cells.flatMap((cell) => cell.series?.map((point) => point.weekStart) ?? []))),
  ].sort();
  return {
    weeks,
    total: top.length,
    rows: raw.map(({ node, cells }) => ({
      node,
      cells: cells.map(({ engine, series }) => ({
        engine,
        points: series === null ? null : weeks.map((week) => series.find((point) => point.weekStart === week) ?? null),
      })),
    })),
  };
}

/** The axis labels of the weeks, with the year on the first and wherever it changes: "Oct 12, 2026", "Oct 19". */
export const weekLabels = (weeks: readonly string[]): string[] =>
  weeks.map((week, index) => formatChartDate(week, index === 0 || week.slice(0, 4) !== weeks[index - 1]?.slice(0, 4)));

/** What a week says in a tooltip and in the Table view: never a percent without its answers, a thin one says its answers. */
export function pointText(point: TopicPoint | null, metric: CellMetric, words: TrendWords): string {
  if (point === null || point.value === null) return words.rateTip.noAnswers;
  const base =
    metric === 'share_of_voice'
      ? point.thin
        ? words.rateTip.thin(point.n)
        : [words.share(point.value, point.n), words.rateTip.prompts(point.prompts)].join(', ')
      : rateTipText(
          { value: point.value, k: point.k, n: point.n, prompts: point.prompts, band: point.band, thin: point.thin },
          words.rateTip,
        );
  if (!point.showsPool) return base;
  const pooled =
    point.window === null ? words.rateTip.pooled(point.weeks) : words.pooledTo(point.weeks, point.window.to);
  return `${base}, ${pooled}`;
}

/** The point the chart draws: a gap (`null`) for a week with no valid answer, hollow with no band when thin. */
export function chartPoint(point: TopicPoint | null, metric: CellMetric, words: TrendWords): RateBandPoint | null {
  if (point === null || point.value === null) return null;
  return { value: point.value, band: point.band, thin: point.thin, tip: pointText(point, metric, words) };
}

export interface TrendPanel {
  /** The topic and the engine: unique in the card. */
  id: string;
  row: TrendRow;
  cell: TrendCell;
  /** False when the engine sent no series for the topic: the panel says so in text and draws no chart. */
  hasSeries: boolean;
  panel: SmallMultiplePanel;
}

/** One panel for each topic and engine, topic by topic. `nameOf` is the panel's text name. */
export function trendPanels(
  model: TrendModel,
  metric: CellMetric,
  words: TrendWords,
  nameOf: (row: TrendRow, cell: TrendCell) => string,
): TrendPanel[] {
  return model.rows.flatMap((row) =>
    row.cells.map((cell): TrendPanel => {
      const points = cell.points ?? model.weeks.map(() => null);
      const id = `${row.node.key}:${cell.engine.code}`;
      return {
        id,
        row,
        cell,
        hasSeries: cell.points !== null,
        panel: {
          id,
          name: nameOf(row, cell),
          role: engineRole(cell.engine.code),
          points: points.map((point) => chartPoint(point, metric, words)),
          cellText: points.map((point) =>
            point === null || point.value === null ? null : pointText(point, metric, words),
          ),
        },
      };
    }),
  );
}

/** The top of the axis of every panel: one number for all, so a panel's height means the same rate in each. */
export const ceilingOf = (panels: readonly TrendPanel[]): number => rateCeilingOf(panels.map((entry) => entry.panel));

/** Why a week has no rate, or `ok`. */
function statusOf(cell: TrendCell, point: TopicPoint | null): string {
  if (cell.points === null) return 'no_series';
  if (point === null || point.value === null) return 'no_answers';
  return point.thin ? 'insufficient' : 'ok';
}

/** A row for each topic, engine and week; an unknown rate is an empty cell and the status says why, never 0. */
export function trendExportRows(model: TrendModel): CsvCell[][] {
  return model.rows.flatMap((row) =>
    row.cells.flatMap((cell) =>
      model.weeks.map((week, index): CsvCell[] => {
        const point = cell.points?.[index] ?? null;
        const rate =
          point !== null && point.value !== null && !point.thin ? Math.round(point.value * 10000) / 100 : null;
        return [safeText(row.node.name), cell.engine.code, week, rate, point?.n ?? 0, statusOf(cell, point)];
      }),
    ),
  );
}

/** Whether any point on the card holds more than its own week: the footnote says the pooling only then. */
export const hasPooledPoint = (model: TrendModel): boolean =>
  model.rows.some((row) => row.cells.some((cell) => cell.points?.some((point) => point?.showsPool === true) === true));

/** Whether any point on the card has a rate: false means every panel is a gap or has no series. */
export const hasAnyRate = (model: TrendModel): boolean =>
  model.rows.some((row) =>
    row.cells.some((cell) => cell.points?.some((point) => point !== null && point.value !== null) === true),
  );

/** The engines of the model with no point that has a rate anywhere: named in the card's partial notice. */
export const enginesWithoutRate = (model: TrendModel, engines: readonly EngineInfo[]): EngineInfo[] =>
  engines.filter(
    (engine) =>
      !model.rows.some((row) =>
        row.cells.some(
          (cell) =>
            cell.engine.code === engine.code &&
            cell.points?.some((point) => point !== null && point.value !== null) === true,
        ),
      ),
  );
