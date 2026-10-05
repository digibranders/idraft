'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';

import { PENDING_CAP_MS, PENDING_POLL_MS, isPendingMetrics } from './refresh-model';
import { keywordsKey, readPage, type KeywordFilters, type ProjectScope } from '../rankings-queries';
import type { TrackedKeywordRow } from '@/lib/api/types';

/** The most rows the API answers a page. */
const PAGE = 200;

type Metrics = NonNullable<TrackedKeywordRow['metrics']>;

interface PendingArgs {
  scope: ProjectScope;
  /** The list's filters: the poll reads the keywords the list does, newest first. */
  filters: KeywordFilters;
  /** The rows on screen. */
  rows: readonly TrackedKeywordRow[];
}

/** The metrics the poll heard, by tracked keyword id. */
function metricsHeard(page: readonly TrackedKeywordRow[]): Map<string, Metrics> {
  const found = new Map<string, Metrics>();
  for (const row of page) {
    if (row.metrics !== null && row.metrics !== undefined) found.set(row.tracked_keyword_id, row.metrics);
  }
  return found;
}

/**
 * New keywords show "Pending" until their first metrics arrive, within minutes (backend plan D8). While a
 * row on screen is still waiting (an active keyword with no metrics) the first page of the same list is read
 * every 30 seconds, newest keywords first, and the metrics it brings are laid over the waiting rows. The
 * list's own pages are not read again: in client mode that would be one request for every 200 keywords.
 * Rows keep their identity (only a waiting row that got metrics is replaced), so the table does not flash
 * and keeps its selection and scroll position.
 *
 * The polling stops when no row waits, and on rows that have waited 15 minutes since the page first saw
 * them: a keyword that never gets metrics (no credentials, a run cancelled) is not asked about for good. It
 * stops with the screen, and pauses while the tab is hidden.
 */
export function usePendingMetrics({ scope, filters, rows }: PendingArgs): readonly TrackedKeywordRow[] {
  const poll = useQuery({
    queryKey: [...keywordsKey(scope), filters, 'pending'],
    queryFn: ({ signal }) =>
      readPage(scope, { ...filters, sort: '-created_at', include: ['metrics'], limit: PAGE }, signal),
    // Read by the timer below, never by the query itself
    enabled: false,
  });
  const heard = poll.data;
  const merged = useMemo(() => {
    if (heard === undefined) return rows;
    const found = metricsHeard(heard.data);
    let changed = false;
    const next = rows.map((row) => {
      const metrics = isPendingMetrics(row) ? found.get(row.tracked_keyword_id) : undefined;
      if (metrics === undefined) return row;
      changed = true;
      return { ...row, metrics };
    });
    return changed ? next : rows;
  }, [rows, heard]);

  // When the page first saw each waiting row. Only effects and timers touch it, never a render.
  const firstSeen = useRef(new Map<string, number>());
  const waitingKey = useMemo(
    () =>
      merged
        .filter(isPendingMetrics)
        .map((row) => row.tracked_keyword_id)
        .join(','),
    [merged],
  );
  const { refetch } = poll;

  useEffect(() => {
    if (waitingKey === '') return undefined;
    const ids = waitingKey.split(',');
    const seen = firstSeen.current;
    const arrived = Date.now();
    for (const id of ids) if (!seen.has(id)) seen.set(id, arrived);
    const worthWaiting = (): boolean => ids.some((id) => Date.now() - (seen.get(id) ?? arrived) < PENDING_CAP_MS);
    if (!worthWaiting()) return undefined;
    const timer = setInterval(() => {
      if (!worthWaiting()) {
        clearInterval(timer);
        return;
      }
      if (!document.hidden) void refetch({ cancelRefetch: false });
    }, PENDING_POLL_MS);
    return () => clearInterval(timer);
  }, [waitingKey, refetch]);

  return merged;
}
