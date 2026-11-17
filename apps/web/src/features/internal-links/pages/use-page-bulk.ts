'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import { changeTagsMutation, resetTiersMutation, setTiersMutation } from '@/lib/internal-links/mutations';
import { checkUrlId, internalLinksKeys, pageFilterOf, type PageQuery } from '@/lib/internal-links/queries';
import type { LinksScope, PageFilter, PageTier } from '@/lib/internal-links/types';

/** What a bulk action applies to: the chosen ids, or every page the filters match (spec 5.2 "Select all N matching"). */
export interface BulkTarget {
  ids: readonly string[];
  allMatching: boolean;
}

/** One request's selection: the API takes `url_ids` or `filter`, never both. */
export type Selection = { url_ids: string[] } | { filter: PageFilter };

/** The most url ids one bulk request takes (the OpenAPI `maxItems`). */
export const ID_BATCH = 5000;

/** The requests a target needs: one for a filter (the API refuses a filter over 20,000 pages), else the ids in batches. */
export function selectionsOf(target: BulkTarget, query: PageQuery, batch: number = ID_BATCH): Selection[] {
  if (target.allMatching) return [{ filter: pageFilterOf(query) }];
  const ids = target.ids.map(checkUrlId);
  const batches: Selection[] = [];
  for (let at = 0; at < ids.length; at += batch) batches.push({ url_ids: ids.slice(at, at + batch) });
  return batches;
}

/**
 * Where an action came from. A dialog shows a failure itself, as its alert (16-drawers-dialogs-popovers.md section
 * 4.2); a key has no dialog, so a failure is a toast.
 */
export type BulkSource = 'dialog' | 'key';

interface Outcome {
  title: string;
  description: string;
}

export interface PageBulk {
  /** An action is being saved. */
  pending: boolean;
  /** Why the last dialog action was not made; `null` when it was, or before the next one. */
  error: string | null;
  clearError: () => void;
  /** Each answers whether the change was made. */
  setTier: (target: BulkTarget, tier: PageTier | null, via: BulkSource) => Promise<boolean>;
  resetToRule: (target: BulkTarget) => Promise<boolean>;
  changeTag: (target: BulkTarget, tag: { termId: string; name: string }, add: boolean) => Promise<boolean>;
}

/**
 * The bulk writes of the Pages tab: set a tier (or Untiered), reset to the rule, add or remove a tag. A tier change
 * needs no crawl (spec 6.6); every read of the project's internal links is read again after a change. Each action
 * answers whether it was made; the selection is cleared (`done`) only then. One runs at a time: a press while one runs
 * is ignored. The words say how many pages the change changed, which can be none.
 */
export function usePageBulk(scope: LinksScope, query: PageQuery, done: () => void): PageBulk {
  const t = useTranslations('internalLinks.bulk');
  const queryClient = useQueryClient();
  const setTiers = useMutation(setTiersMutation);
  const reset = useMutation(resetTiersMutation);
  const tags = useMutation(changeTagsMutation);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const path = { workspace_id: scope.workspaceId, project_id: scope.projectId };

  /** Sends each selection, sums the pages the API changed, and says what happened. */
  const run = async (
    target: BulkTarget,
    via: BulkSource,
    send: (selection: Selection) => Promise<number>,
    outcome: (changed: number) => Outcome,
  ): Promise<boolean> => {
    // Nothing chosen: nothing to send, and nothing to say
    if (running.current || (!target.allMatching && target.ids.length === 0)) return false;
    running.current = true;
    setPending(true);
    setError(null);
    let landed = 0;
    let changed = 0;
    try {
      for (const selection of selectionsOf(target, query)) {
        changed += await send(selection);
        landed += 1;
      }
      toast({ type: 'success', ...outcome(changed) });
      done();
      return true;
    } catch (failure) {
      const reason = isApiProblem(failure, 'too_many_subjects') ? t('tooMany') : landed > 0 ? t('partial') : null;
      if (via === 'dialog') setError(reason ?? t('failed'));
      else toast({ type: 'error', title: t('failed'), ...(reason === null ? {} : { description: reason }) });
      return false;
    } finally {
      running.current = false;
      setPending(false);
      if (landed > 0) for (const queryKey of internalLinksKeys(scope)) void queryClient.invalidateQueries({ queryKey });
    }
  };
  /** The sentence of a change that changed `count` pages; a no-op reads as one. */
  const said = (count: number, sentence: string): string => (count === 0 ? t('noChange') : sentence);

  return {
    pending,
    error,
    clearError: () => setError(null),
    setTier: (target, tier, via) =>
      run(
        target,
        via,
        async (selection) =>
          (await setTiers.mutateAsync({ params: { path }, body: { ...selection, tier_id: tier?.tier_id ?? null } }))
            .data.changed,
        (changed) => ({
          title: t('tierSet'),
          description: said(changed, t('tierSetText', { count: changed, tier: tier?.label ?? t('untiered') })),
        }),
      ),
    resetToRule: (target) =>
      run(
        target,
        'dialog',
        async (selection) => (await reset.mutateAsync({ params: { path }, body: selection })).data.changed,
        (changed) => ({ title: t('resetDone'), description: said(changed, t('resetDoneText', { count: changed })) }),
      ),
    changeTag: (target, tag, add) =>
      run(
        target,
        'dialog',
        async (selection) => {
          const answer = await tags.mutateAsync({
            params: { path },
            body: { ...selection, add: add ? [tag.termId] : [], remove: add ? [] : [tag.termId] },
          });
          return add ? answer.data.added : answer.data.removed;
        },
        (changed) => ({
          title: add ? t('tagAdded') : t('tagRemoved'),
          description: said(changed, t(add ? 'tagAddedText' : 'tagRemovedText', { tag: tag.name, count: changed })),
        }),
      ),
  };
}
