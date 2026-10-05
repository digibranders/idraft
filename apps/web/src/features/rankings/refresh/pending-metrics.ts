'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';

import { PENDING_CAP_MS, PENDING_PAGES_MAX, PENDING_POLL_MS, isPendingMetrics } from './refresh-model';
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
type Heard = ReadonlyMap<string, Metrics>;

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

/** Adds the metrics a page brought to what was heard. */
function absorb(heard: Map<string, Metrics>, page: readonly TrackedKeywordRow[]): void {
  for (const row of page) {
    if (row.metrics !== null && row.metrics !== undefined) heard.set(row.tracked_keyword_id, row.metrics);
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
  signal: AbortSignal;
}

/**
 * One poll. In server mode the page on screen is read again, as the list asked for it (its sort and its
 * cursor). In client mode the keywords are read newest first, page after page by cursor, until a page ends
 * with a keyword older than the oldest waiting one (so every waiting keyword was on a page read), and at
 * most `PENDING_PAGES_MAX` pages: a project of many thousand keywords is not read whole every 30 seconds.
 */
async function readWaiting({ scope, filters, pageRequest, oldest, heard, signal }: ReadArgs): Promise<Heard> {
  const found = new Map(heard);
  if (pageRequest !== null) {
    absorb(found, (await readPage(scope, pageRequest, signal)).data);
    return found;
  }
  let cursor: string | null = null;
  for (let read = 0; read < PENDING_PAGES_MAX; read += 1) {
    const page = await readPage(
      scope,
      { ...filters, sort: '-created_at', include: ['metrics'], limit: PAGE, ...(cursor === null ? {} : { cursor }) },
      signal,
    );
    absorb(found, page.data);
    const last = page.data.at(-1);
    const reached = oldest === null || last === undefined || Date.parse(last.created_at) < oldest;
    if (reached || !page.page.has_more || page.page.next_cursor === null) break;
    cursor = page.page.next_cursor;
  }
  return found;
}

/**
 * New keywords show "Pending" until their first metrics arrive, within minutes (backend plan D8). While a
 * row on screen is still waiting (an active keyword with no metrics) the list is read again every 30 seconds
 * (see `readWaiting` for how much of it), and the metrics it brings are laid over the waiting rows. The
 * list's own queries are not touched, so fresher data in them is never overwritten. Rows keep their
 * identity (only a waiting row that got metrics is replaced), so the table does not flash and keeps its
 * selection, its scroll position and the keyword open in the inspector.
 *
 * The polling stops when no row waits, and on rows that have waited 15 minutes with the tab shown: a keyword
 * that never gets metrics (no credentials, a run cancelled) is not asked about for good. It stops with the
 * screen, pauses while the tab is hidden, and reads at once when the tab is shown again.
 */
export function usePendingMetrics({
  scope,
  filters,
  rows,
  mode,
  pageRequest,
}: PendingArgs): readonly TrackedKeywordRow[] {
  const queryClient = useQueryClient();
  const request = mode === 'server' ? pageRequest : null;
  const queryKey = [...keywordsKey(scope), filters, 'pending', request];
  // When the oldest waiting row was created: set by an effect, read by the poll
  const oldestWaiting = useRef<number | null>(null);
  const poll = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      readWaiting({
        scope,
        filters,
        pageRequest: request,
        oldest: oldestWaiting.current,
        heard: queryClient.getQueryData<Heard>(queryKey),
        signal,
      }),
    // Read by the timer below, never by the query itself
    enabled: false,
  });
  const heard = poll.data;
  const merged = useMemo(() => {
    if (heard === undefined) return rows;
    let changed = false;
    const next = rows.map((row) => {
      const metrics = isPendingMetrics(row) ? heard.get(row.tracked_keyword_id) : undefined;
      if (metrics === undefined) return row;
      changed = true;
      return { ...row, metrics };
    });
    return changed ? next : rows;
  }, [rows, heard]);

  // How long each waiting row has been waited for with the tab shown. Only effects and timers touch it.
  const waited = useRef(new Map<string, number>());
  const waiting = useMemo(() => {
    const rowsWaiting = merged.filter(isPendingMetrics);
    return {
      key: rowsWaiting.map((row) => row.tracked_keyword_id).join(','),
      oldest: rowsWaiting.reduce<number | null>((oldest, row) => {
        const created = Date.parse(row.created_at);
        return oldest === null || created < oldest ? created : oldest;
      }, null),
    };
  }, [merged]);
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
