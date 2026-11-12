import type { EngineSummary, ObservationSummary } from '@/lib/api/types';
import type { SeriesRole } from '@/lib/charts/category-chart';
import { rateState, wilsonInterval, type Interval } from '@/lib/stats';

/**
 * The History tab of the prompt inspector (parity spec G94 and G96): the weekly mention rate of a prompt per engine
 * with its Wilson band, and the events read from its answers. Plain data; the tab puts words and a chart to it.
 */

/** One week of one engine: the valid answers that name the brand over all the valid ones. */
export interface WeekPoint {
  /** The Monday of the week, a project day. */
  weekStart: string;
  k: number;
  n: number;
  /** `k / n`; `null` for a week with no valid answer (a gap, never a 0) and for counts that cannot be real. */
  value: number | null;
  /** The 95 percent Wilson interval of the week; only for a week over enough valid answers. */
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
 * The weekly series of the engines in `engineCodes`, in that order, from a summary read with `include=series`. A week
 * the series of an engine does not list is a gap of that engine. `null` when no engine asked for has a series (not
 * loaded, an older API, or a read made without it).
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
        const entry = series.find((candidate) => candidate.week_start === weekStart);
        if (entry === undefined) return null;
        const { numerator: k, denominator: n } = entry.mentioned;
        const real = Number.isInteger(k) && Number.isInteger(n) && k >= 0 && k <= n;
        const state = rateState(n);
        return {
          weekStart,
          k,
          n,
          value: real && n > 0 ? k / n : null,
          band: real && state === 'ok' ? wilsonInterval(k, n) : null,
          thin: real && state === 'insufficient',
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
  kind: 'added' | 'model';
  /** The instant of the event. */
  at: string;
  /** `model` only: the engine, and the model it reported before and after. */
  engineCode?: string;
  from?: string;
  to?: string;
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
