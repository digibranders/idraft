import type { EngineCode, Schemas } from '@/lib/api/types';
import { ENGINES } from '@/lib/layouts/catalog';

/**
 * What the two collection-day cards say about a day of one engine (WP-37 plan T7, CH-20 and CH-21). Pure: the cards
 * read `ai/collection/daily` through `useCollectionDaily` and hand its rows here. Counts are answers, exactly as the
 * route sends them; nothing is turned into a rate here, and a schedule the route cannot name stays `null`.
 */

/** The five statuses of a stored answer, in the order the chart stacks them. They add up to the answers of the day. */
export const STATUSES = ['complete', 'partial', 'empty', 'refused', 'error'] as const;
export type AnswerStatus = (typeof STATUSES)[number];

export interface DayCounts extends Record<AnswerStatus, number> {
  /** A project day, `YYYY-MM-DD`. */
  date: string;
  engine: EngineCode;
  /** Answers the schedules planned that day; `null` where the route cannot name a schedule, never 0 for unknown. */
  scheduled: number | null;
  /** Answers stored that day: the five statuses added up. */
  answers: number;
  /** Complete plus partial, which is what the route and every rate call valid. */
  valid: number;
  /** Refused plus error: the answers that failed. Empty answers are apart. */
  failures: number;
  /** Runs of the day a budget blocked; runs, so never added across engines. */
  budgetBlocked: number;
}

export function dayCounts(row: Schemas['CollectionDay']): DayCounts {
  const { complete, partial, empty, refused, error } = row.by_status;
  return {
    date: row.date,
    engine: row.engine_code,
    scheduled: row.scheduled,
    complete,
    partial,
    empty,
    refused,
    error,
    answers: complete + partial + empty + refused + error,
    valid: complete + partial,
    failures: refused + error,
    budgetBlocked: row.budget_blocked,
  };
}

/** A day that has a schedule, an answer or a blocked run: the days the chart draws and the table lists. */
export const isRunDay = (counts: DayCounts): boolean =>
  counts.scheduled !== null || counts.answers > 0 || counts.budgetBlocked > 0;

/** The days of ONE engine, oldest first. Engines are never added together: another engine's rows are left out. */
export function engineDays(rows: readonly Schemas['CollectionDay'][], engine: EngineCode): DayCounts[] {
  return rows
    .filter((row) => row.engine_code === engine)
    .map(dayCounts)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The engines of the tabs: those the scope asks first, then any other the response holds, each group in catalog
 * order. The first tab is the one the card opens on.
 */
export function engineTabs(held: readonly EngineCode[], asked: readonly EngineCode[]): EngineCode[] {
  const inCatalog = ENGINES.map((engine) => engine.code).filter((code) => held.includes(code));
  return [...inCatalog.filter((code) => asked.includes(code)), ...inCatalog.filter((code) => !asked.includes(code))];
}

/** The answers of the engine's days, and how many of them are valid: the counts the meta line and the summary state. */
export function totalsOf(days: readonly DayCounts[]): {
  answers: number;
  valid: number;
  empty: number;
  refused: number;
  error: number;
} {
  return days.reduce(
    (total, day) => ({
      answers: total.answers + day.answers,
      valid: total.valid + day.valid,
      empty: total.empty + day.empty,
      refused: total.refused + day.refused,
      error: total.error + day.error,
    }),
    { answers: 0, valid: 0, empty: 0, refused: 0, error: 0 },
  );
}
