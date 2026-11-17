'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';

import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import { startCrawlMutation } from '@/lib/internal-links/mutations';
import { crawlFinishedKeys, crawlKeys, crawlsQuery, pageTiersQuery } from '@/lib/internal-links/queries';
import type { CrawlRun, LinksScope } from '@/lib/internal-links/types';

/** While a crawl runs, the list is read again this often (spec 6.2: pages found so far). */
export const CRAWL_POLL_MS = 30_000;

const ACTIVE: ReadonlySet<CrawlRun['state']> = new Set(['queued', 'crawling', 'processing']);
export const isActive = (run: CrawlRun): boolean => ACTIVE.has(run.state);
/** A crawl that left data to read: it finished, or stopped at its ceiling with the pages found so far. */
const hasData = (run: CrawlRun): boolean => run.state === 'ready' || run.state === 'stopped_at_ceiling';

export type CrawlView =
  | { kind: 'no-website' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'never' }
  | { kind: 'first'; run: CrawlRun }
  | { kind: 'failed-first'; run: CrawlRun }
  | { kind: 'ready'; latest: CrawlRun; active: CrawlRun | null; failed: CrawlRun | null };

/**
 * What the page shows for the crawls of a project (spec 9), from the runs newest first. The screens always show
 * the latest finished crawl (decision W19); a newer run that is under way or failed is reported beside it. A
 * first crawl that was cancelled left nothing to show, so it reads as no crawl.
 */
export function crawlView(
  hasWebsite: boolean,
  runs: readonly CrawlRun[] | undefined,
  status: 'loading' | 'error' | 'ready',
): CrawlView {
  if (!hasWebsite) return { kind: 'no-website' };
  if (runs === undefined) return status === 'error' ? { kind: 'error' } : { kind: 'loading' };
  const newest = runs[0];
  if (newest === undefined) return { kind: 'never' };
  const latestAt = runs.findIndex((run) => run.is_latest);
  const latest = runs[latestAt];
  if (latest === undefined) {
    if (isActive(newest)) return { kind: 'first', run: newest };
    return newest.state === 'failed' ? { kind: 'failed-first', run: newest } : { kind: 'never' };
  }
  const newer = runs.slice(0, latestAt);
  return {
    kind: 'ready',
    latest,
    active: newer.find(isActive) ?? null,
    failed: newest.state === 'failed' ? newest : null,
  };
}

/**
 * The crawls, polled while one runs. A crawl that was under way and now has data makes every read of the
 * project's links stale, because the latest crawl is a new one (`crawlFinishedKeys`). `onEnded` is told of each
 * run that was under way and has ended (finished, failed or cancelled), once, so the page can announce it.
 */
export function useCrawls(scope: LinksScope, enabled: boolean, onEnded?: (run: CrawlRun) => void) {
  const queryClient = useQueryClient();
  const query = useQuery({
    ...crawlsQuery(scope),
    enabled,
    refetchInterval: (current) => ((current.state.data?.data ?? []).some(isActive) ? CRAWL_POLL_MS : false),
  });
  const underWay = useRef<ReadonlySet<string>>(new Set());
  const ended = useRef(onEnded);
  // Declared before the effect below, so it reads this render's callback
  useEffect(() => {
    ended.current = onEnded;
  });
  const runs = query.data?.data;
  useEffect(() => {
    if (runs === undefined) return;
    const endedNow = runs.filter((run) => underWay.current.has(run.run_id) && !isActive(run));
    underWay.current = new Set(runs.filter(isActive).map((run) => run.run_id));
    for (const run of endedNow) ended.current?.(run);
    if (endedNow.some(hasData))
      for (const queryKey of crawlFinishedKeys(scope)) void queryClient.invalidateQueries({ queryKey });
  }, [runs, scope, queryClient]);
  return query;
}

/** The workspace's tiers, which every tab, filter and dialog names. */
export const useWorkspaceTiers = (workspaceId: string) => useQuery(pageTiersQuery(workspaceId));

/** Crawl now (and Crawl again with a higher limit): one crawl at a time. */
export function useCrawlNow(scope: LinksScope, host: string) {
  const t = useTranslations('internalLinks.header');
  const queryClient = useQueryClient();
  const mutation = useMutation(startCrawlMutation);
  const start = (higherLimit = false): void => {
    mutation.mutate(
      {
        params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId } },
        body: { higher_limit: higherLimit },
      },
      {
        onSuccess: () => {
          toast({ type: 'info', title: t('crawlStarted'), description: t('crawlStartedText', { host }) });
        },
        onError: (error) => {
          if (isApiProblem(error, 'crawl_in_progress')) toast({ type: 'info', title: t('crawlBusy') });
          else if (isApiProblem(error, 'budget_exceeded'))
            toast({ type: 'error', title: t('crawlFailed'), description: t('crawlBudget') });
          else if (isApiProblem(error, 'no_website'))
            toast({ type: 'error', title: t('crawlFailed'), description: t('crawlNoWebsite') });
          else toast({ type: 'error', title: t('crawlFailed') });
        },
        // Either way the crawl list is what changed or what the person must now see
        onSettled: () => {
          for (const queryKey of crawlKeys(scope)) void queryClient.invalidateQueries({ queryKey });
        },
      },
    );
  };
  return { start, pending: mutation.isPending };
}
