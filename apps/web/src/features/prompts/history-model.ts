import { TZDate } from '@date-fns/tz';

import type { DateRange } from './prompt-model';
import type { EngineSummary, ObservationSummary, PointPool } from '@/lib/api/types';
import type { SeriesRole } from '@/lib/charts/category-chart';
import { formatIsoDate } from '@/lib/format';
import { rateState, wilsonInterval, type Interval } from '@/lib/stats';

/**
 * The History tab of the prompt inspector (parity spec G94 and G96): the weekly mention rate of a prompt per engine
 * with its Wilson band, and the events read from its answers. Plain data; the tab puts words and a chart to it.
 */

/**
 * One point of one engine, as the API gives it: a prompt row's point already pools the valid answers of its week and
 * the weeks before it (a prompt is asked twice a week, so one week alone never holds the answers a rate needs).
 */
export interface WeekPoint {
  /** The Monday of the week the point is dated by, a project day. */
  weekStart: string;
  /** How many weeks the point pools: up to 4 on a prompt row, fewer where the window opens; 1 when it is not pooled. */
  span: number;
  /** The days the pool covers, inside the window; undefined when the point is not pooled. */
  window?: PointPool['window'];
  k: number;
  n: number;
  /** `k / n`; `null` with no valid answer in the point (a gap, never a 0). */
  value: number | null;
  /** The 95 percent Wilson interval of the counts; only over enough valid answers. */
  band: Interval | null;
  /** Fewer valid answers than `MIN_OBSERVATIONS`: drawn as a hollow point with no band. */
  thin: boolean;
}

export interface EngineHistory {
  engineCode: string;
  /** One entry for each week of `History.weeks`; `null` where the engine's series has no point for the week. */
  points: (WeekPoint | null)[];
}

export interface History {
  /** The Mondays of every engine's series together, oldest first. */
  weeks: string[];
  engines: EngineHistory[];
}

/**
 * The weekly points of the engines in `engineCodes`, in that order, from a summary read with `include=series`, one for
 * each week of the series of any of them, each read as the API pools it. An engine whose series lists no week has a gap there. `null` when no engine asked for has a series (not loaded, an older API, or a read made without it).
 */
export function weeklyHistory(
  engineCodes: readonly string[],
  cells: readonly EngineSummary[] | undefined,
): History | null {
  const chosen = engineCodes.flatMap((engineCode) => {
    const series = cells?.find((cell) => cell.engine_code === engineCode)?.series;
    return series == null ? [] : [{ engineCode, series }];
  });
  if (chosen.length === 0) return null;
  const weeks = [...new Set(chosen.flatMap(({ series }) => series.map((entry) => entry.week_start)))].sort();
  return {
    weeks,
    engines: chosen.map(({ engineCode, series }) => ({
      engineCode,
      points: weeks.map((weekStart): WeekPoint | null => {
        const entry = series.find((point) => point.week_start === weekStart);
        if (entry === undefined) return null;
        // The counts are the point's own: it is already pooled, so adding the points before it would count answers twice
        const { numerator: k, denominator: n } = entry.mentioned;
        // A point with counts that cannot be real is no point
        if (!Number.isInteger(k) || !Number.isInteger(n) || k < 0 || k > n) return null;
        const state = rateState(n);
        return {
          weekStart,
          span: entry.pool?.weeks ?? 1,
          ...(entry.pool == null ? {} : { window: entry.pool.window }),
          k,
          n,
          value: n > 0 ? k / n : null,
          band: state === 'ok' ? wilsonInterval(k, n) : null,
          thin: state === 'insufficient',
        };
      }),
    })),
  };
}

/** The fixed order of the engines in a chart (14-badges-status.md section 4): ChatGPT `chart-1`, Gemini `chart-2`, AI Mode `chart-3`. */
const ENGINE_ORDER = ['chatgpt_web', 'gemini_web', 'google_ai_mode'] as const;

/** The role (colour) of an engine's series: by the engine's place in the fixed order, never by its place in the data. */
export function engineRole(engineCode: string): SeriesRole {
  const place = ENGINE_ORDER.findIndex((code) => code === engineCode);
  if (place === 0) return { kind: 'brand' };
  return place === 1 || place === 2 ? { kind: 'palette', index: place === 1 ? 2 : 3 } : { kind: 'other' };
}

/** The top of the rate axis: the next tenth above the highest rate or band, at least 10 percent and at most 100 percent. */
export function rateCeiling(history: History | null): number {
  const highest = (history?.engines ?? [])
    .flatMap((engine) => engine.points)
    .reduce((top, point) => Math.max(top, point?.band?.high ?? 0, point?.value ?? 0), 0);
  // The small step takes a tenth that floating point puts a hair above (0.3 as 0.30000000000000004) back down
  return Math.min(1, Math.max(0.1, Math.ceil(highest * 10 - 1e-9) / 10));
}

/** Something that happened to the prompt, from what the page already has. */
export interface HistoryEvent {
  id: string;
  kind: 'added' | 'model' | 'stale';
  /** The instant of the event; for `stale`, the last valid answer of the gap (or the start of the window). */
  at: string;
  /** `model` and `stale`: the engine. */
  engineCode?: string;
  /** `model` only: the model the engine reported before and after. */
  from?: string;
  to?: string;
  /** `stale` only: whole days without a valid answer. */
  days?: number;
}

const DAY_MS = 86_400_000;

// shortcut: twice the twice-weekly schedule, replace with the shared stale rule of WP-18 (CF-27) when it lands
/** An engine with no valid answer for this many days is called stale. */
export const STALE_AFTER_DAYS = 7;

/** The instants a stale gap is measured between. */
export interface StaleWindow {
  from: string;
  end: string;
}

/**
 * The window of the page as instants: from the start of its first project day (or when the prompt was added, if
 * that is later: a prompt cannot be silent before it exists) to the close of its last day, never past `now`.
 */
export function staleWindow(range: DateRange, createdAt: string, timeZone: string, now: Date): StaleWindow {
  const dayStart = (isoDate: string, shift: number): number => {
    const [year = 1970, month = 1, day = 1] = isoDate.split('-').map(Number);
    return new TZDate(year, month - 1, day + shift, timeZone).getTime();
  };
  const from = Math.max(dayStart(range.from, 0), Date.parse(createdAt));
  const end = Math.min(dayStart(range.to, 1), now.getTime());
  return { from: new Date(from).toISOString(), end: new Date(end).toISOString() };
}

/**
 * One event for each gap of `STALE_AFTER_DAYS` days or more without a valid answer on an engine in `engineCodes`:
 * between two valid answers, and from the last one to the end of the window. An engine with no valid answer in the
 * list is silent from the start of the window. The gap before the first valid answer is not measured (the list holds
 * 200 answers at most, so its start is unknown). An answer with no facts or an invalid one ends no gap.
 */
export function staleEvents(
  engineCodes: readonly string[],
  observations: readonly ObservationSummary[],
  { from, end }: StaleWindow,
  /** False when the list is only the newest answers: an engine with none in it may have answered earlier. */
  complete = true,
): HistoryEvent[] {
  return engineCodes.flatMap((engineCode) => {
    const valid = observations
      .filter((answer) => answer.engine_code === engineCode && answer.facts?.is_valid === true)
      .map((answer) => answer.observed_at)
      .sort((a, b) => Date.parse(a) - Date.parse(b));
    if (valid.length === 0 && !complete) return [];
    const starts = valid.length === 0 ? [from] : valid;
    const stops = valid.length === 0 ? [end] : [...valid.slice(1), end];
    return starts.flatMap((at, place): HistoryEvent[] => {
      const days = Math.floor((Date.parse(stops[place] ?? end) - Date.parse(at)) / DAY_MS);
      return days >= STALE_AFTER_DAYS ? [{ id: `stale:${engineCode}:${at}`, kind: 'stale', at, engineCode, days }] : [];
    });
  });
}

/** A change of the model of one engine, on the week of the chart it happened in. */
export interface ModelBoundary {
  /** The Monday of the week, one of `weeks`. */
  week: string;
  engineCode: string;
  from: string;
  to: string;
}

/**
 * The `model` events as marks on the weeks of the chart: each on the latest week that starts on or before the day of
 * the change in the project zone. A change before the first week is left out (no mark is better than one on a wrong
 * week). One mark for each change, so two engines changing in one week are two marks, never one pooled.
 */
export function modelBoundaries(
  events: readonly HistoryEvent[],
  weeks: readonly string[],
  timeZone: string,
): ModelBoundary[] {
  return events.flatMap((event): ModelBoundary[] => {
    if (event.kind !== 'model' || event.engineCode === undefined) return [];
    const day = formatIsoDate(event.at, timeZone);
    const week = weeks.filter((start) => start <= day).at(-1);
    return week === undefined
      ? []
      : [{ week, engineCode: event.engineCode, from: event.from ?? '', to: event.to ?? '' }];
  });
}

/**
 * The prompt's events, newest first: when it was added, and for each engine every answer that reports another model
 * than the one before it (the answers are those of the list, so a change before the window is not seen). An answer
 * that reports no model is skipped, not read as a change.
 */
export function historyEvents(createdAt: string, observations: readonly ObservationSummary[]): HistoryEvent[] {
  const oldestFirst = [...observations].sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
  const lastModel = new Map<string, string>();
  const changes: HistoryEvent[] = [];
  for (const answer of oldestFirst) {
    const model = answer.model_reported;
    if (model === null) continue;
    const before = lastModel.get(answer.engine_code);
    if (before !== undefined && before !== model) {
      changes.push({
        id: `model:${answer.observation_id}`,
        kind: 'model',
        at: answer.observed_at,
        engineCode: answer.engine_code,
        from: before,
        to: model,
      });
    }
    lastModel.set(answer.engine_code, model);
  }
  const added: HistoryEvent = { id: 'added', kind: 'added', at: createdAt };
  return [...changes, added].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
