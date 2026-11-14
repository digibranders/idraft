import type { EngineCode, FanoutMeta, FanoutQueryPage, FanoutQueryRow } from './types';

/**
 * What the fan-out surfaces decide from a read, with no React in it: which period came before the window, which
 * queries are new in it, and what the notes have to say (docs/16-metrics-methodology.md section 9). Every
 * statement that cannot be made says so (`unknown`, `null`) and never answers with a zero or a guess.
 */

/** A list whose newest query is older than this many days may be out of date. */
export const STALE_AFTER_DAYS = 7;

const DAY_MS = 86_400_000;

/** A window as the route takes it: the first and the last day, `YYYY-MM-DD` in the project's zone. */
export interface DayWindow {
  from: string;
  to: string;
}

const dayNumber = (isoDay: string): number => Math.round(Date.parse(`${isoDay}T00:00:00Z`) / DAY_MS);
const isoDayOf = (days: number): string => new Date(days * DAY_MS).toISOString().slice(0, 10);

/**
 * The period before a window: the same number of days, ending the day before `from`. Days are counted on the UTC
 * calendar, because a business date carries no zone and a daylight saving change must not move it.
 */
export function previousWindow({ from, to }: DayWindow): DayWindow {
  const start = dayNumber(from);
  const length = dayNumber(to) - start + 1;
  return { from: isoDayOf(start - length), to: isoDayOf(start - 1) };
}

/** What a query is told apart by: its engine and its normalized text, so the queries of two engines never merge. */
export const rowKey = (row: Pick<FanoutQueryRow, 'engine_code' | 'normalized_text'>): string =>
  `${row.engine_code}:${row.normalized_text}`;

/** The part of a read the verdict needs: `idle` and `loading` mean the period before is not in hand. */
export interface PreviousRead {
  status: 'idle' | 'loading' | 'error' | 'ready';
  data: FanoutQueryPage | undefined;
}

/** Why a query cannot be called new or not new. `loading` says nothing to the person: the read is on its way. */
export type NewUnknownReason = 'noPrevious' | 'tooMany' | 'failed' | 'loading';

/**
 * `known`: `newKeys` holds the `rowKey` of every listed query that did not appear in the period before. `unknown`:
 * nothing is called new, and the reason is what the note says. A query is never new because the period before is
 * missing, cut or unread.
 */
export type NewVerdict =
  { kind: 'known'; newKeys: ReadonlySet<string> } | { kind: 'unknown'; reason: NewUnknownReason };

/**
 * New in the window (WB-PIF-02): a listed query that is not in the period before. The period before is read with
 * `min_support=1`, so it holds every query it had, and it counts only when the whole of it is in hand.
 */
export function newVerdict(rows: readonly FanoutQueryRow[], previous: PreviousRead): NewVerdict {
  if (previous.status === 'error') return { kind: 'unknown', reason: 'failed' };
  if (previous.status !== 'ready' || previous.data === undefined) return { kind: 'unknown', reason: 'loading' };
  const { data, meta, page } = previous.data;
  if (meta.answers === 0) return { kind: 'unknown', reason: 'noPrevious' };
  if (page.total > data.length) return { kind: 'unknown', reason: 'tooMany' };
  const before = new Set(data.map(rowKey));
  return { kind: 'known', newKeys: new Set(rows.map(rowKey).filter((key) => !before.has(key))) };
}

/** The answers that kept fewer queries than they issued, of the answers read; `null` when none was cut. */
export function truncatedOf(meta: FanoutMeta): { cut: number; answers: number } | null {
  return meta.answers_truncated > 0 ? { cut: meta.answers_truncated, answers: meta.answers } : null;
}

/** How many queries are listed of how many there are; `null` when the page holds all of them. */
export function listCut(page: FanoutQueryPage): { shown: number; total: number } | null {
  return page.page.total > page.data.length ? { shown: page.data.length, total: page.page.total } : null;
}

/**
 * The newest `last_seen_at` of the rows when it is more than `STALE_AFTER_DAYS` days before `now`, else `null`. A
 * list with no row is not called old: there is no date to say.
 */
export function staleAt(rows: readonly FanoutQueryRow[], now: Date): string | null {
  let newest: { at: string; time: number } | null = null;
  for (const row of rows) {
    const time = Date.parse(row.last_seen_at);
    if (newest === null || time > newest.time) newest = { at: row.last_seen_at, time };
  }
  return newest !== null && now.getTime() - newest.time > STALE_AFTER_DAYS * DAY_MS ? newest.at : null;
}

/** "In 6 of 12 ChatGPT answers": the answers that issued the query, of the answers read on its engine. */
export function timesUsedOf(
  row: Pick<FanoutQueryRow, 'observations' | 'engine_code'>,
  meta: Pick<FanoutMeta, 'answers'>,
): { count: number; total: number; engine: EngineCode } {
  return { count: row.observations, total: meta.answers, engine: row.engine_code };
}
