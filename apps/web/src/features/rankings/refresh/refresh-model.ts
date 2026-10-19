import type { ManualRuns, ValidationItem } from '@/lib/api/types';
import type { FinishedStatus } from '@/lib/runs/run-status';

/**
 * What the metrics refresh knows without asking anyone (19-api-specification.md section 3.6.1, "As built
 * (step 5, metrics refresh)"): the request it sends, the runs it follows and the words for how they end.
 * What a run's status and reason mean is shared with Runs (`@/lib/runs/run-status`).
 */

/** Metrics older than this many days are stale: the API's own default, sent so the dialog's words are true. */
export const STALE_DAYS = 25;
/** One refresh takes at most this many keyword ids. */
export const MAX_REFRESH_KEYWORDS = 1000;
/** How often a run that has not ended is asked about. */
export const RUN_POLL_MS = 5_000;
/** A run still queued after this long is said to take longer than usual: the worker plans one within a minute. */
export const RUN_SLOW_MS = 15 * 60_000;
/** A run that cannot be read this many times in a row is let go of: it is followed no longer. */
export const RUN_FAILURES_MAX = 5;
/** How often the list is read again while a keyword on screen waits for its first metrics. */
export const PENDING_POLL_MS = 30_000;
/** A keyword the page saw pending is waited for this long (with the tab shown), and no longer. */
export const PENDING_CAP_MS = 15 * 60_000;
/** The most pages one poll for first metrics reads in client mode, 200 keywords each. */
export const PENDING_PAGES_MAX = 5;
/** The open manual refreshes a reload looks for: a project starts at most 20 manual runs a day. */
export const OPEN_RUNS_LIMIT = 20;

/** What a refresh is asked to cover. */
export type RefreshChoice = 'selection' | 'matching' | 'stale';

/** The request body of a refresh: ids of keywords (`keyword_id`, not `tracked_keyword_id`) or the stale ones. */
export type RefreshBody = { keyword_ids: string[] } | { stale_days: number };

export const refreshBody = (choice: RefreshChoice, keywordIds: readonly string[]): RefreshBody =>
  choice === 'stale' ? { stale_days: STALE_DAYS } : { keyword_ids: [...keywordIds] };

/**
 * The keywords of rows, each once, in the order they come: a keyword tracked at several locations or on
 * both devices is one keyword, and the API refreshes it at each place.
 */
export function uniqueKeywordIds(rows: readonly { keyword: { keyword_id: string } }[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) seen.add(row.keyword.keyword_id);
  return [...seen];
}

/** How many manual runs the project may still start today. */
export const leftToday = (manual: ManualRuns): number => Math.max(manual.limit - manual.used, 0);

/** A keyword that waits for its first metrics: active, and none read yet. */
export const isPendingMetrics = (row: { is_active: boolean; metrics?: unknown }): boolean =>
  row.is_active && (row.metrics === null || row.metrics === undefined);

/**
 * A keyword added within this long is expected to get its first rank check soon: the worker plans a new
 * keyword within minutes. An older keyword that was never checked is in a project that is paused or blocked by
 * its budget, or was imported long ago and waits in a queue: asking about it every 30 seconds for a quarter
 * of an hour on every visit would only cost requests.
 */
export const FIRST_CHECK_WINDOW_MS = 60 * 60_000;

/**
 * A keyword that waits for its first rank check: active, added within the last hour (`now`, in ms) and not
 * checked by the API yet. A check that ran and failed (`failed`) is a check, so the keyword stops waiting; the
 * check is tried again by the worker. A creation time that is not a date is not waited for.
 */
export const waitsForFirstCheck = (
  row: { is_active: boolean; created_at: string; state: { current: { state: string } } },
  now: number,
): boolean => {
  if (!row.is_active || row.state.current.state !== 'not_checked') return false;
  const created = Date.parse(row.created_at);
  return Number.isFinite(created) && now - created <= FIRST_CHECK_WINDOW_MS;
};

/** A keyword the page still waits for: its metrics, or its first rank check. */
export const isWaiting = (
  row: {
    is_active: boolean;
    created_at: string;
    metrics?: unknown;
    state: { current: { state: string } };
  },
  now: number,
): boolean => isPendingMetrics(row) || waitsForFirstCheck(row, now);

/** What the screen has seen of a tracked keyword: which keyword it tracks, and whether it was active. */
export interface SeenKeyword {
  keywordId: string;
  active: boolean;
}

/**
 * The keywords behind the chosen tracked keywords, each once: those seen on a page and still known as
 * active. A chosen row may sit on a page that is no longer on screen, which is why the rows seen are kept.
 */
export function chosenKeywordIds(chosen: ReadonlySet<string>, seen: ReadonlyMap<string, SeenKeyword>): string[] {
  const ids = new Set<string>();
  for (const id of chosen) {
    const keyword = seen.get(id);
    if (keyword?.active === true) ids.add(keyword.keywordId);
  }
  return [...ids];
}

/**
 * The chosen tracked keywords the list no longer holds, after it was read again. A list that holds every
 * keyword (client mode, read to its end) tells it for all of them; a list of one page (server mode) only for
 * those that were on the page before: a chosen keyword of another page may well be there still.
 */
export function leftTheList(
  chosen: ReadonlySet<string>,
  before: readonly { tracked_keyword_id: string }[],
  now: readonly { tracked_keyword_id: string }[],
  complete: boolean,
): string[] {
  const held = new Set(now.map((row) => row.tracked_keyword_id));
  const known = complete ? null : new Set(before.map((row) => row.tracked_keyword_id));
  return [...chosen].filter((id) => !held.has(id) && (known === null || known.has(id)));
}

/**
 * The positions in `keyword_ids` that a `keyword_unknown` error names (`keyword_ids.3`, `keyword_ids[3]`),
 * or an empty list when it names the field as a whole, which is what says nothing about which keyword.
 */
export function unknownPositions(errors: readonly ValidationItem[]): number[] {
  return errors.flatMap((item) => {
    if (item.code !== 'keyword_unknown') return [];
    const found = /^keyword_ids(?:\.|\[|\/)(\d+)\]?$/.exec(item.path);
    return found?.[1] === undefined ? [] : [Number(found[1])];
  });
}

/** The catalog key of how a run ended, under `rankings.refresh.finished`: keys are camelCase, the API's codes are not. */
export const FINISH_KEYS = {
  completed: 'completed',
  completed_with_errors: 'completedWithErrors',
  failed: 'failed',
  cancelled: 'cancelled',
  budget_blocked: 'budgetBlocked',
} as const satisfies Record<FinishedStatus, string>;
