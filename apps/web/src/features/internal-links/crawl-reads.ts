'use client';

import { skipToken, useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';

import { toast } from '@/components/ui/toast';
import { announce } from '@/lib/a11y/announcer';
import type { QueryKey } from '@/lib/api/keys';
import { isApiProblem } from '@/lib/api/problem';
import type { ApiResponse } from '@/lib/api/query';
import { startCrawlMutation } from '@/lib/internal-links/mutations';
import {
  crawlFinishedKeys,
  crawlKeys,
  crawlsQuery,
  CRAWL_SCREEN_LIMIT,
  pageTiersQuery,
} from '@/lib/internal-links/queries';
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
  /** The runs listed do not settle what the project has: more are behind them and none of these is the latest crawl. */
  | { kind: 'unknown' }
  | { kind: 'never' }
  | { kind: 'first'; run: CrawlRun }
  | { kind: 'failed-first'; run: CrawlRun }
  | { kind: 'ready'; latest: CrawlRun; active: CrawlRun | null; failed: CrawlRun | null };

/**
 * What the page shows for the crawls of a project (spec 9), from the runs newest first. The screens always show
 * the latest finished crawl (decision W19); a newer run that is under way or failed is reported beside it. A
 * first crawl that was cancelled left nothing to show, so it reads as no crawl. The API marks the latest crawl
 * (`is_latest`) apart from the page it lists, so when more runs are behind the page and none of them is marked,
 * the latest may be one of those and the state is `unknown`: never a first crawl that failed.
 */
export function crawlView(
  hasWebsite: boolean,
  runs: readonly CrawlRun[] | undefined,
  status: 'loading' | 'error' | 'ready',
  hasMore = false,
): CrawlView {
  if (!hasWebsite) return { kind: 'no-website' };
  if (runs === undefined) return status === 'error' ? { kind: 'error' } : { kind: 'loading' };
  const newest = runs[0];
  if (newest === undefined) return { kind: 'never' };
  const latestAt = runs.findIndex((run) => run.is_latest);
  const latest = runs[latestAt];
  if (latest === undefined) {
    if (hasMore) return { kind: 'unknown' };
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
 * Where the id of the latest crawl last seen is kept: in the query cache, so a visit that finds another latest
 * crawl (one that finished while the page was not open) knows what it read before is stale.
 */
export const seenCrawlKey = (scope: LinksScope): QueryKey => [
  'internal-links-seen-crawl',
  scope.workspaceId,
  scope.projectId,
];

type CrawlList = ApiResponse<'get', '/api/v1/workspaces/{workspace_id}/projects/{project_id}/link-crawls'>;
type TierList = ApiResponse<'get', '/api/v1/workspaces/{workspace_id}/page-tiers'>;

/**
 * The crawls, `CRAWL_SCREEN_LIMIT` newest first, polled while one runs. Every read of the project's links is made
 * stale (`crawlFinishedKeys`), once, when a run that was under way now has data, and when the latest crawl is not
 * the one last seen. `onEnded` is told of each run that was under way and has ended (finished, failed or
 * cancelled), once, so the page can announce it.
 */
export function useCrawls(
  scope: LinksScope,
  enabled: boolean,
  onEnded?: (run: CrawlRun) => void,
): UseQueryResult<CrawlList> {
  const queryClient = useQueryClient();
  const query = useQuery({
    ...crawlsQuery(scope, CRAWL_SCREEN_LIMIT),
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
    const latest = runs.find((run) => run.is_latest);
    let newCrawl = false;
    if (latest !== undefined) {
      const seen: unknown = queryClient.getQueryData(seenCrawlKey(scope));
      newCrawl = typeof seen === 'string' && seen !== latest.run_id;
      queryClient.setQueryData(seenCrawlKey(scope), latest.run_id);
    }
    if (newCrawl || endedNow.some(hasData)) {
      for (const queryKey of crawlFinishedKeys(scope)) void queryClient.invalidateQueries({ queryKey });
    }
  }, [runs, scope, queryClient]);
  return query;
}

/** The workspace's tiers, which every tab, filter and dialog names. */
export const useWorkspaceTiers = (workspaceId: string): UseQueryResult<TierList> =>
  useQuery(pageTiersQuery(workspaceId));

/**
 * Whether the API answered `503 crawls_disabled` to a start. It is learned from that answer alone (no request asks
 * beforehand) and kept in the query cache, so it holds while the app stays open and goes with a page reload; a start
 * that succeeds clears it.
 */
export const crawlsOffKey: QueryKey = ['internal-links-crawls-off'];

/** Crawl now (and Crawl again with a higher limit): one crawl at a time. */
export function useCrawlNow(
  scope: LinksScope,
  host: string,
): { start: (higherLimit?: boolean) => void; pending: boolean; crawlsOff: boolean } {
  const t = useTranslations('internalLinks.header');
  const queryClient = useQueryClient();
  const mutation = useMutation(startCrawlMutation);
  const { data: crawlsOff } = useQuery({
    queryKey: crawlsOffKey,
    queryFn: skipToken,
    initialData: false,
    staleTime: Infinity,
  });
  const start = (higherLimit = false): void => {
    mutation.mutate(
      {
        params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId } },
        body: { higher_limit: higherLimit },
      },
      {
        onSuccess: () => {
          queryClient.setQueryData(crawlsOffKey, false);
          toast({ type: 'info', title: t('crawlStarted'), description: t('crawlStartedText', { host }) });
        },
        onError: (error) => {
          // Not a failure: crawls are not switched on yet. The page shows a notice; no toast, no error
          if (isApiProblem(error, 'crawls_disabled')) {
            queryClient.setQueryData(crawlsOffKey, true);
            announce(t('crawlsOff'), { key: 'internal-links-crawls-off' });
          } else if (isApiProblem(error, 'crawl_in_progress')) toast({ type: 'info', title: t('crawlBusy') });
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
  return { start, pending: mutation.isPending, crawlsOff: crawlsOff === true };
}
