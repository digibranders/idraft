'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  PENDING_CAP_MS,
  PENDING_PAGES_MAX,
  PENDING_POLL_MS,
  isPendingMetrics,
  isWaiting,
  waitsForFirstCheck,
} from './refresh-model';
import {
  keywordsKey,
  readPage,
  type KeywordFilters,
  type ListMode,
  type ListQuery,
  type ProjectScope,
} from '../rankings-queries';
import type { TrackedKeywordRow } from '@/lib/api/types';

/** The most rows the API answers a page. */
const PAGE = 200;

type Metrics = NonNullable<TrackedKeywordRow['metrics']>;
type RankState = TrackedKeywordRow['state'];

/** What the polls heard of a keyword: its metrics and its rank state, each only once it is something. */
interface Fresh {
  metrics: Metrics | null;
  /** The rank state once the API has checked the keyword (a failed check included); never `not_checked`. */
  state: RankState | null;
}
type Heard = ReadonlyMap<string, Fresh>;

interface PendingArgs {
  scope: ProjectScope;
  /** The list's filters: the poll reads the keywords the list does. */
  filters: KeywordFilters;
  /** The rows on screen. */
  rows: readonly TrackedKeywordRow[];
  /** How the list was read: the whole list in memory, or the one page on screen. */
  mode: ListMode | null;
  /** Server mode: the request that reads the page on screen. */
  pageRequest: ListQuery | null;
}

/** Adds the metrics and the first rank checks a page brought to what was heard. */
function absorb(heard: Map<string, Fresh>, page: readonly TrackedKeywordRow[]): void {
  for (const row of page) {
    const metrics = row.metrics ?? null;
    const state = row.state.current.state === 'not_checked' ? null : row.state;
    if (metrics === null && state === null) continue;
    const before = heard.get(row.tracked_keyword_id);
    heard.set(row.tracked_keyword_id, {
      metrics: metrics ?? before?.metrics ?? null,
      state: state ?? before?.state ?? null,
    });
  }
}

interface ReadArgs {
  scope: ProjectScope;
  filters: KeywordFilters;
  /** Server mode: the request of the page on screen; `null` in client mode. */
  pageRequest: ListQuery | null;
  /** When the oldest waiting row was created (ms); `null` when none waits. */
  oldest: number | null;
  /** What the earlier polls heard, which this one adds to. */
  heard: Heard | undefined;
  /** Client mode: where the last poll stopped short of the oldest waiting keyword; this poll goes on from it. */
  resume: { cursor: string | null };
  signal: AbortSignal;
}

/**
 * One poll. In server mode the page on screen is read again, as the list asked for it (its sort and its
 * cursor). In client mode the keywords are read newest first, page after page by cursor, until a page ends
 * with a keyword older than the oldest waiting one (so every waiting keyword was on a page read), and at
 * most `PENDING_PAGES_MAX` pages: a project of many thousand keywords is not read whole every 30 seconds.
 * When the pages run out before the oldest waiting keyword, the cursor is kept: the next poll reads the
 * newest page again (new keywords wait there) and goes on from the kept cursor, so a long wait after a
 * large import reaches the oldest keywords within a few polls instead of never.
 */
async function readWaiting({ scope, filters, pageRequest, oldest, heard, resume, signal }: ReadArgs): Promise<Heard> {
  const found = new Map(heard);
  if (pageRequest !== null) {
    absorb(found, (await readPage(scope, pageRequest, signal)).data);
    return found;
  }
  let cursor: string | null = null;
  let budget = PENDING_PAGES_MAX;
  if (resume.cursor !== null) {
    // The newest page first, then where the last poll stopped
    const newest = await readPage(scope, pendingQuery(filters, null), signal);
    absorb(found, newest.data);
    budget -= 1;
    cursor = resume.cursor;
  }
  resume.cursor = null;
  for (let read = 0; read < budget; read += 1) {
    const page = await readPage(scope, pendingQuery(filters, cursor), signal);
    absorb(found, page.data);
    const last = page.data.at(-1);
    const reached = oldest === null || last === undefined || Date.parse(last.created_at) < oldest;
    if (reached || !page.page.has_more || page.page.next_cursor === null) return found;
    cursor = page.page.next_cursor;
  }
  // The pages ran out before the oldest waiting keyword: the next poll goes on from here
  resume.cursor = cursor;
  return found;
}

/** The request of one page of a poll: the keywords newest first, with their metrics (the rank state always comes). */
const pendingQuery = (filters: KeywordFilters, cursor: string | null): ListQuery => ({
  ...filters,
  sort: '-created_at',
  include: ['metrics'],
  limit: PAGE,
  ...(cursor === null ? {} : { cursor }),
});

/**
 * New keywords show "Pending" until their first metrics arrive, within minutes (backend plan D8), and in the
 * rank columns until their first rank check has run (a few minutes after, rank collection). While a row on
 * screen is still waiting for either (an active keyword with no metrics, or one added within the last hour that
 * the API has not checked) the list is read again every 30 seconds (see `readWaiting` for how much of it), and the metrics and the rank
 * state it brings are laid over the waiting rows, each over a row that still lacks it. The list's own
 * queries are not touched, so fresher data in them is never overwritten. Rows keep their identity (only a
 * waiting row that got something is replaced), so the table does not flash and keeps its selection, its
 * scroll position and the keyword open in the inspector.
 *
 * The polling stops when no row waits, and on rows that have waited 15 minutes with the tab shown: a keyword
 * that never gets metrics (no credentials, a run cancelled) or a first check (a paused project) is not asked
 * about for good. A keyword added more than an hour before the screen opened is not waited for to be checked at
 * all: in a paused or budget-blocked project that would be every visit. It stops with the screen, pauses while the tab is hidden, and reads at once when the tab is
 * shown again.
 */
export function usePendingMetrics({
  scope,
  filters,
  rows,
  mode,
  pageRequest,
}: PendingArgs): readonly TrackedKeywordRow[] {
  const queryClient = useQueryClient();
  // The moment the screen opened: a keyword that is not new by then is not waited for to be checked (see
  // `FIRST_CHECK_WINDOW_MS`). A keyword added while the screen is open is created after it, so it always waits.
  const [openedAt] = useState(() => Date.now());
  const request = mode === 'server' ? pageRequest : null;
  const queryKey = [...keywordsKey(scope), filters, 'pending', request];
  // When the oldest waiting row was created: set by an effect, read by the poll
  const oldestWaiting = useRef<number | null>(null);
  // Where the polls of client mode stopped short of the oldest waiting keyword, for the filters it was kept
  // under (a cursor is bound to its filters)
  const resume = useRef<{ filters: string; cursor: string | null }>({ filters: '', cursor: null });
  const filtersText = JSON.stringify(filters);
  const poll = useQuery({
    queryKey,
    queryFn: ({ signal }) => {
      if (resume.current.filters !== filtersText) resume.current = { filters: filtersText, cursor: null };
      return readWaiting({
        scope,
        filters,
        pageRequest: request,
        oldest: oldestWaiting.current,
        heard: queryClient.getQueryData<Heard>(queryKey),
        resume: resume.current,
        signal,
      });
    },
    // Read by the timer below, never by the query itself
    enabled: false,
  });
  const heard = poll.data;
  const merged = useMemo(() => {
    if (heard === undefined) return rows;
    let changed = false;
    const next = rows.map((row) => {
      const fresh = isWaiting(row, openedAt) ? heard.get(row.tracked_keyword_id) : undefined;
      if (fresh === undefined) return row;
      // Only what the row still lacks is laid over it: metrics it has, or a rank it was already given, stay
      const metrics = isPendingMetrics(row) ? fresh.metrics : null;
      const state = waitsForFirstCheck(row, openedAt) ? fresh.state : null;
      if (metrics === null && state === null) return row;
      changed = true;
      return { ...row, ...(metrics === null ? {} : { metrics }), ...(state === null ? {} : { state }) };
    });
    return changed ? next : rows;
  }, [rows, heard, openedAt]);

  // How long each waiting row has been waited for with the tab shown. Only effects and timers touch it.
  const waited = useRef(new Map<string, number>());
  const waiting = useMemo(() => {
    const rowsWaiting = merged.filter((row) => isWaiting(row, openedAt));
    return {
      key: rowsWaiting.map((row) => row.tracked_keyword_id).join(','),
      oldest: rowsWaiting.reduce<number | null>((oldest, row) => {
        const created = Date.parse(row.created_at);
        return oldest === null || created < oldest ? created : oldest;
      }, null),
    };
  }, [merged, openedAt]);
  const { refetch } = poll;

  useEffect(() => {
    oldestWaiting.current = waiting.oldest;
  }, [waiting.oldest]);

  useEffect(() => {
    if (waiting.key === '') return undefined;
    const ids = waiting.key.split(',');
    const clock = waited.current;
    const worthWaiting = (): boolean => ids.some((id) => (clock.get(id) ?? 0) < PENDING_CAP_MS);
    if (!worthWaiting()) return undefined;
    const read = (): void => void refetch({ cancelRefetch: false });
    const timer = setInterval(() => {
      // Time with the tab hidden is not waiting, and nothing is read then
      if (document.hidden) return;
      for (const id of ids) clock.set(id, (clock.get(id) ?? 0) + PENDING_POLL_MS);
      if (!worthWaiting()) {
        clearInterval(timer);
        return;
      }
      read();
    }, PENDING_POLL_MS);
    // A tab shown again may have missed a good while of metrics arriving: read without waiting for the tick
    const onVisibility = (): void => {
      if (!document.hidden && worthWaiting()) read();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [waiting.key, refetch]);

  return merged;
}
