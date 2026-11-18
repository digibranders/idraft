'use client';

import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useCallback, useRef, useState } from 'react';

import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import { decideOpportunitiesMutation } from '@/lib/internal-links/mutations';
import { reasonOf } from '@/lib/internal-links/problem-reason';
import { checkUrlId, internalLinksKeys, isOpportunityPage } from '@/lib/internal-links/queries';
import type { LinksScope, Opportunity, OpportunityPage, OpportunityStatus } from '@/lib/internal-links/types';

/**
 * The list as it reads once `keys` are decided as `status`: their rows take the status, a row that no longer matches
 * the status filter leaves, and the counts and the total follow. Only rows the page holds change.
 */
export function withDecision(
  page: OpportunityPage,
  keys: ReadonlySet<string>,
  status: OpportunityStatus,
  filter: OpportunityStatus | null,
): OpportunityPage {
  const counts = { ...page.meta.counts };
  let removed = 0;
  const data: Opportunity[] = [];
  for (const row of page.data) {
    if (!keys.has(row.key) || row.status === status) {
      data.push(row);
      continue;
    }
    counts[row.status] -= 1;
    counts[status] += 1;
    if (filter !== null && status !== filter) removed += 1;
    else data.push({ ...row, status });
  }
  return { data, meta: { ...page.meta, counts, total: page.meta.total - removed } };
}

export interface OpportunityDecisions {
  /** A decision is in flight: every decision control waits. */
  pending: boolean;
  /** Decides the rows as `status`: `done` when the API took it, `failed` when it did not, `skipped` when nothing was sent. */
  decide: (rows: readonly Opportunity[], status: OpportunityStatus) => Promise<DecisionOutcome>;
}

export type DecisionOutcome = 'done' | 'failed' | 'skipped';

/**
 * Accept, dismiss and reopen (spec 7.10). The list read changes at once and goes back to what it was when the
 * request fails, with the API's reason in a toast. One request runs at a time, so a double click sends one.
 */
export function useOpportunityDecisions(
  scope: LinksScope,
  listKey: QueryKey,
  filter: OpportunityStatus | null,
): OpportunityDecisions {
  const t = useTranslations('internalLinks.opportunities');
  const queryClient = useQueryClient();
  const { mutateAsync } = useMutation(decideOpportunitiesMutation);
  const running = useRef(false);
  const [pending, setPending] = useState(false);

  const decide = useCallback(
    async (rows: readonly Opportunity[], status: OpportunityStatus): Promise<DecisionOutcome> => {
      if (running.current || rows.length === 0) return 'skipped';
      running.current = true;
      setPending(true);
      const before = queryClient.getQueryData(listKey);
      try {
        const items = rows.map((row) => ({
          source_url_id: checkUrlId(row.source.url_id),
          target_url_id: checkUrlId(row.target.url_id),
        }));
        await queryClient.cancelQueries({ queryKey: listKey });
        const keys = new Set(rows.map((row) => row.key));
        const apply = (page: unknown): unknown =>
          isOpportunityPage(page) ? withDecision(page, keys, status, filter) : page;
        queryClient.setQueryData(listKey, apply);
        const answer = await mutateAsync({
          params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId } },
          body: { items, status },
        });
        // A read that landed meanwhile may hold the old statuses: the decision is applied again (it is idempotent)
        queryClient.setQueryData(listKey, apply);
        const [only] = rows;
        const one = rows.length === 1 && only !== undefined;
        const names = one ? { from: only.source.path, to: only.target.path } : null;
        const title = t(
          status === 'accepted' ? 'plannedToast' : status === 'dismissed' ? 'dismissedToast' : 'reopened',
        );
        const count = answer.data.changed;
        const description =
          count === 0
            ? t('noChange')
            : names !== null
              ? t(
                  status === 'accepted' ? 'plannedText' : status === 'dismissed' ? 'dismissedText' : 'reopenedText',
                  names,
                )
              : t(status === 'accepted' ? 'bulkPlanned' : status === 'dismissed' ? 'bulkDismissed' : 'bulkReopened', {
                  count,
                });
        toast({ type: status === 'accepted' ? 'success' : 'info', title, description });
        return 'done';
      } catch (failure) {
        queryClient.setQueryData(listKey, before);
        const reason = isApiProblem(failure) ? reasonOf(failure) : '';
        toast({
          type: 'error',
          title: t('decisionFailed'),
          description: reason === '' ? t('decisionFailedReason') : reason,
        });
        return 'failed';
      } finally {
        running.current = false;
        setPending(false);
        for (const queryKey of internalLinksKeys(scope)) void queryClient.invalidateQueries({ queryKey });
      }
    },
    [filter, listKey, mutateAsync, queryClient, scope, t],
  );

  return { pending, decide };
}
