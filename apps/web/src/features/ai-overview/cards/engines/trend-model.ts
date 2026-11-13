import { engineRole } from './engine-role';
import { percentNumber } from './percent';
import type { OverviewAggregates } from '../../data/aggregates';
import type { SmallMultiplePanel } from '@/components/app/chart/small-multiples';
import { addDays } from '@/components/app/date-range/business-date';
import type { EngineCode, EngineSummary, MetricCell, ProjectEngine, PromptsSummary, WeekCells } from '@/lib/api/types';
import type { RateBandPoint } from '@/lib/charts/rate-band-chart';
import { rateTipText, type RateTipWords } from '@/lib/charts/rate-tip';
import type { CsvCell } from '@/lib/csv/csv-write';
import { promptWeightedRate, rateState, wilsonInterval, type Interval, type RateState } from '@/lib/stats';

/**
 * The weekly points of the rates of the engines (WP-34 plan, CH-01 and WB-OV-05), as plain data: the card puts
 * words and a canvas to them. Every point is a rate over valid answers with its counts; a week without an answer
 * is a gap and never 0, and a point over fewer than `MIN_OBSERVATIONS` answers has no band (R2, R6).
 *
 * The API pools the weekly points of a prompt row over the trailing 4 weeks (C-11), so a project point built from
 * prompt rows is such a pool and says so (R7). When the summary carries `total` the points are its own, and say
 * what pool they hold, if any.
 */

export type TrendMetric = 'mention' | 'citation' | 'share_of_voice';

export const TREND_METRICS: readonly TrendMetric[] = ['mention', 'citation', 'share_of_voice'];

export const isTrendMetric = (value: string): value is TrendMetric => TREND_METRICS.some((metric) => metric === value);

const CELL_OF = { mention: 'mentioned', citation: 'cited' } as const;

export interface TrendPoint {
  /** The Monday the week starts on, a project day. */
  weekStart: string;
  /** The rate; `null` for a week with no valid answer (a gap). A thin point keeps its value, so it can be drawn hollow. */
  value: number | null;
  /** The answers that count; `null` for share of voice (it has no count of successes) and for a gap. */
  k: number | null;
  /** The valid answers behind the value (those that name a brand, for share of voice); 0 for a gap. */
  n: number;
  /** The prompts the value is the mean over, each counted once; `null` where that is not a figure of the point. */
  prompts: number | null;
  /** The 95 percent Wilson interval of the pooled answers, from `MIN_OBSERVATIONS` of them; never for share of voice. */
  band: Interval | null;
  /** Fewer valid answers than `MIN_OBSERVATIONS`: no rate is written and no band drawn. */
  thin: boolean;
  /** The weeks the point pools, only when it holds more than its own week. */
  pooledWeeks: number | null;
  /** The window cuts the week: part of its days are outside it. */
  partial: boolean;
}

export interface TrendSeries {
  engineCode: EngineCode;
  /** One point for every week of the chart, in the order of `TrendModel.weeks`. */
  points: TrendPoint[];
  /** The previous window by week index, values only; `null` with no comparison. */
  previous: (number | null)[] | null;
}

export interface TrendModel {
  metric: TrendMetric;
  /** The Mondays of the chart, oldest first: the weeks of any engine's series. */
  weeks: string[];
  series: TrendSeries[];
  /** Where the points come from: the summary's `total`, or the sum of its prompt rows. */
  source: 'total' | 'prompts';
  /** The weeks in which at least one engine has a valid answer: a trend needs two. */
  weeksWithAnswers: number;
  /** The tracked set of brands changed inside the window, which matters to share of voice only. */
  entitiesChanged: boolean;
}

export interface TrendInput {
  current: PromptsSummary;
  /** The window before; `null` unless the comparison is on and paired with the current read. */
  previous: PromptsSummary | null;
  /** The engines drawn, in the order to draw them. */
  asked: readonly EngineCode[];
  metric: TrendMetric;
  /** The window asked, in project days: it says which weeks are cut. */
  range: { from: string; to: string };
}

interface Parts {
  value: number | null;
  k: number | null;
  n: number;
  prompts: number | null;
  pooledWeeks: number | null;
}

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

const isWhole = (value: number): boolean => Number.isInteger(value) && value >= 0;

/** Whether the days of the week from its Monday are not all inside the window. */
const isPartialWeek = (weekStart: string, range: TrendInput['range']): boolean =>
  weekStart < range.from || addDays(weekStart, 6) > range.to;

const GAP: Parts = { value: null, k: null, n: 0, prompts: null, pooledWeeks: null };

/** The weeks a point pools, when that is more than its own week. */
const poolOf = (week: WeekCells): number | null => {
  const weeks = week.is_pooled ? (week.pool?.weeks ?? 1) : 1;
  return weeks > 1 ? weeks : null;
};

/** A point from its parts: the interval and the thin state come from the counts and from nothing else. */
function pointOf(weekStart: string, parts: Parts, metric: TrendMetric, range: TrendInput['range']): TrendPoint {
  const state: RateState = rateState(parts.n);
  const hasBand = metric !== 'share_of_voice' && state === 'ok' && parts.k !== null;
  return {
    weekStart,
    ...parts,
    band: hasBand && parts.k !== null ? wilsonInterval(parts.k, parts.n) : null,
    thin: state === 'insufficient',
    partial: isPartialWeek(weekStart, range),
  };
}

/** The point of prompt rows in one week: each prompt's own pooled cell, added up, the value their mean (C-19). */
function promptsPart(cells: readonly { week: WeekCells; cell: MetricCell }[], metric: TrendMetric): Parts {
  if (cells.length === 0) return GAP;
  const pooledWeeks = cells.reduce<number | null>((most, { week }) => {
    const weeks = poolOf(week);
    return weeks !== null && (most === null || weeks > most) ? weeks : most;
  }, null);
  const counts = cells.map(({ cell }) => ({ k: cell.numerator, n: cell.denominator }));
  const n = sum(counts.map((count) => count.n));
  // No valid answer in the week is a gap, not a rate of 0
  if (n === 0) return GAP;
  if (metric === 'share_of_voice') {
    // One answer one weight: the numerators are sums of shares, so they are no count of successes
    return { value: sum(counts.map((count) => count.k)) / n, k: null, n, prompts: null, pooledWeeks };
  }
  if (counts.some((count) => !isWhole(count.k) || !isWhole(count.n) || count.k > count.n)) return GAP;
  return {
    value: promptWeightedRate(counts),
    k: sum(counts.map((count) => count.k)),
    n,
    prompts: counts.filter((count) => count.n >= 1).length,
    pooledWeeks,
  };
}

/** The point of a total row: its cell is prompt weighted, so its counts are in `pooled`. */
function totalPart(week: WeekCells, cell: MetricCell, metric: TrendMetric): Parts {
  const pooledWeeks = poolOf(week);
  if (metric === 'share_of_voice') {
    return cell.denominator > 0 ? { value: cell.value, k: null, n: cell.denominator, prompts: null, pooledWeeks } : GAP;
  }
  const n = cell.pooled?.trials ?? cell.denominator;
  const k = cell.pooled?.successes ?? cell.numerator;
  if (!isWhole(n) || n === 0 || !isWhole(k) || k > n) return GAP;
  return { value: cell.value, k, n, prompts: cell.pooled === null ? week.prompts : cell.denominator, pooledWeeks };
}

const cellOf = (week: WeekCells, metric: TrendMetric): MetricCell =>
  metric === 'share_of_voice' ? week.share_of_voice : week[CELL_OF[metric]];

const totalSeries = (summary: PromptsSummary, code: EngineCode): readonly WeekCells[] | null => {
  const engine: EngineSummary | undefined = summary.total?.engines.find((entry) => entry.engine_code === code);
  return engine?.series != null && engine.series.length > 0 ? engine.series : null;
};

/** The weeks of an engine's series over the prompt rows, oldest first. */
const promptWeeks = (summary: PromptsSummary, code: EngineCode): string[] =>
  [
    ...new Set(
      summary.prompts.flatMap((prompt) =>
        (prompt.engines.find((engine) => engine.engine_code === code)?.series ?? []).map((week) => week.week_start),
      ),
    ),
  ].sort();

/**
 * The weekly points of one engine and metric over the summary, oldest first: the summary's `total` when it has a
 * series for the engine, else the sum of its prompt rows' points. A week with no valid answer is a gap.
 */
export function projectWeeks(
  summary: PromptsSummary,
  code: EngineCode,
  metric: TrendMetric,
  range: TrendInput['range'],
): TrendPoint[] {
  const total = totalSeries(summary, code);
  if (total !== null) {
    return total.map((week) => pointOf(week.week_start, totalPart(week, cellOf(week, metric), metric), metric, range));
  }
  return promptWeeks(summary, code).map((weekStart) => {
    const cells = summary.prompts.flatMap((prompt) => {
      const week = prompt.engines
        .find((engine) => engine.engine_code === code)
        ?.series?.find((entry) => entry.week_start === weekStart);
      return week === undefined ? [] : [{ week, cell: cellOf(week, metric) }];
    });
    return pointOf(weekStart, promptsPart(cells, metric), metric, range);
  });
}

/** The values of the previous window to draw against the weeks of the chart: a thin or empty week has none. */
function previousValues(
  summary: PromptsSummary,
  code: EngineCode,
  metric: TrendMetric,
  range: TrendInput['range'],
  length: number,
): (number | null)[] {
  const points = projectWeeks(summary, code, metric, range);
  return Array.from({ length }, (_, index) => {
    const point = points[index];
    return point === undefined || point.thin ? null : point.value;
  });
}

const gapAt = (weekStart: string, range: TrendInput['range']): TrendPoint => pointOf(weekStart, GAP, 'mention', range);

/** The weekly model of the engines asked: every engine has a point for every week of the chart. */
export function buildTrend({ current, previous, asked, metric, range }: TrendInput): TrendModel {
  const own = asked.map((code) => ({ code, points: projectWeeks(current, code, metric, range) }));
  const weeks = [...new Set(own.flatMap(({ points }) => points.map((point) => point.weekStart)))].sort();
  const series = own.map(({ code, points }): TrendSeries => {
    const byWeek = new Map(points.map((point) => [point.weekStart, point]));
    return {
      engineCode: code,
      points: weeks.map((weekStart) => byWeek.get(weekStart) ?? gapAt(weekStart, range)),
      previous: previous === null ? null : previousValues(previous, code, metric, range, weeks.length),
    };
  });
  return {
    metric,
    weeks,
    series,
    source: asked.some((code) => totalSeries(current, code) !== null) ? 'total' : 'prompts',
    weeksWithAnswers: weeks.filter((_, index) => series.some((entry) => (entry.points[index]?.n ?? 0) > 0)).length,
    entitiesChanged: current.entity_config_versions.length > 1,
  };
}

/** The finished words a point needs on top of the shared tooltip words. */
export interface TrendWords {
  rate: RateTipWords;
  /** "50%, 8 answers that name a brand". */
  share: (value: number, n: number) => string;
  /** "partial week". */
  partial: string;
}

function tipOf(point: TrendPoint, metric: TrendMetric, words: TrendWords): string {
  const { value, k, n, prompts, band, thin, pooledWeeks } = point;
  const pooled = pooledWeeks ?? undefined;
  const text =
    metric === 'share_of_voice' && !thin && value !== null
      ? [words.share(value, n), pooled === undefined ? null : words.rate.pooled(pooled)]
          .filter((part): part is string => part !== null)
          .join(', ')
      : rateTipText({ value, k, n, prompts: prompts ?? undefined, band, thin, pooledWeeks: pooled }, words.rate);
  return point.partial ? `${text}, ${words.partial}` : text;
}

/**
 * The panels of `SmallMultiples`, one for each engine drawn: a gap is `null`, a thin point is drawn hollow with the
 * words of its answers and no percent, and the Table view and the tip say the same words (R1).
 */
export function panelsOf(
  model: TrendModel,
  labelOf: (code: EngineCode) => string,
  words: TrendWords,
): SmallMultiplePanel[] {
  return model.series.map((series): SmallMultiplePanel => {
    const points = series.points.map((point): RateBandPoint | null =>
      point.n === 0
        ? null
        : { value: point.value, band: point.band, thin: point.thin, tip: tipOf(point, model.metric, words) },
    );
    return {
      id: series.engineCode,
      name: labelOf(series.engineCode),
      role: engineRole(series.engineCode),
      points,
      previous: series.previous === null ? undefined : series.previous,
      cellText: points.map((point) => point?.tip ?? null),
    };
  });
}

/** What the card says of an engine over the whole window: the figure of the strip, so the two agree. */
export interface SummaryItem {
  engineCode: EngineCode;
  state: RateState;
  value: number | null;
  k: number | null;
  n: number;
  prompts: number;
  /** The change since the window before; `null` without a comparison. Colour it only when `detectable` is true. */
  change: { delta: number; detectable: boolean | null } | null;
}

/** The window figures of the engines asked for `metric`, from the strip's own aggregates (R12). */
export function trendSummary(
  aggregates: OverviewAggregates,
  asked: readonly EngineCode[],
  metric: TrendMetric,
): SummaryItem[] {
  return asked.flatMap((code): SummaryItem[] => {
    const engine = aggregates.engines.find((entry) => entry.engineCode === code);
    if (engine === undefined) return [];
    const [figure, change] =
      metric === 'mention'
        ? ([engine.mentioned, engine.change.mentioned] as const)
        : metric === 'citation'
          ? ([engine.cited, engine.change.cited] as const)
          : ([engine.shareOfVoice, engine.change.shareOfVoice] as const);
    return [
      {
        engineCode: code,
        state: figure.state,
        value: figure.value,
        k: figure.successes,
        n: figure.answers,
        prompts: figure.prompts,
        change: change.delta === null ? null : { delta: change.delta, detectable: change.detectable },
      },
    ];
  });
}

/** Why an engine has or has not a panel: asked, off in the project, or left out of the page's engine filter. */
export type EngineGate = 'asked' | 'off' | 'outsideFilter';

export function engineGate(
  code: EngineCode,
  projectEngines: readonly ProjectEngine[],
  chosen: readonly string[] | null,
): EngineGate {
  const project = projectEngines.find((entry) => entry.engine.engine_code === code);
  if (project?.is_enabled !== true) return 'off';
  return chosen === null || chosen.includes(code) ? 'asked' : 'outsideFilter';
}

/** The rows of the Table view and of the export: a block of the card, an unknown value empty with a status. */
export interface TrendExport {
  header: readonly string[];
  rows: CsvCell[][];
}

export function trendExport(model: TrendModel, labelOf: (code: EngineCode) => string): TrendExport {
  const rows = model.weeks.flatMap((weekStart, index) =>
    model.series.map((series) => {
      const point = series.points[index];
      const shown = point !== undefined && point.n > 0 && !point.thin && point.value !== null;
      return [
        weekStart,
        labelOf(series.engineCode),
        shown ? percentNumber(point.value ?? 0) : null,
        point?.k ?? null,
        point?.n ?? 0,
        point?.prompts ?? null,
        point?.band == null ? null : percentNumber(point.band.low),
        point?.band == null ? null : percentNumber(point.band.high),
        point?.pooledWeeks ?? null,
        point?.partial === true ? 'true' : 'false',
        point === undefined || point.n === 0 ? 'no_answers' : point.thin ? 'insufficient' : 'ok',
      ];
    }),
  );
  return {
    header: [
      'week',
      'engine',
      'value_percent',
      'k',
      'n',
      'prompts',
      'interval_low_percent',
      'interval_high_percent',
      'pooled_weeks',
      'partial_week',
      'status',
    ],
    rows,
  };
}
