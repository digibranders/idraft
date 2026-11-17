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
type Selection = { url_ids: string[] } | { filter: PageFilter };

/** The most url ids one bulk request takes (the OpenAPI `maxItems`). */
const ID_BATCH = 5000;

/** The requests a target needs: one for a filter (the API refuses a filter over 20,000 pages), else the ids in batches. */
function selectionsOf(target: BulkTarget, query: PageQuery): Selection[] {
  if (target.allMatching) return [{ filter: pageFilterOf(query) }];
  const ids = target.ids.map(checkUrlId);
  const batches: Selection[] = [];
  for (let at = 0; at < ids.length; at += ID_BATCH) batches.push({ url_ids: ids.slice(at, at + ID_BATCH) });
  return batches;
}

interface Outcome {
  title: string;
  description: string;
}

/**
 * The bulk writes of the Pages tab: set a tier (or Untiered), reset to the rule, add or remove a tag. A tier change
 * needs no crawl (spec 6.6); every read of the project's internal links is read again after a change. Each action
 * answers whether it was made; the selection is cleared only then. One runs at a time: a press while one runs is
 * ignored, so a held key sends one request.
 */
export function usePageBulk(scope: LinksScope, query: PageQuery, done: () => void) {
  const t = useTranslations('internalLinks.bulk');
  const queryClient = useQueryClient();
  const setTiers = useMutation(setTiersMutation);
  const reset = useMutation(resetTiersMutation);
  const tags = useMutation(changeTagsMutation);
  const [pending, setPending] = useState(false);
  const running = useRef(false);
  const path = { workspace_id: scope.workspaceId, project_id: scope.projectId };

  /** Sends each selection, sums the pages the API matched, and says what happened in a toast. */
  const run = async (
    target: BulkTarget,
    send: (selection: Selection) => Promise<number>,
    outcome: (matched: number) => Outcome,
  ): Promise<boolean> => {
    if (running.current) return false;
    running.current = true;
    setPending(true);
    let landed = 0;
    let matched = 0;
    try {
      for (const selection of selectionsOf(target, query)) {
        matched += await send(selection);
        landed += 1;
      }
      toast({ type: 'success', ...outcome(matched) });
      done();
      return true;
    } catch (error) {
      const reason = isApiProblem(error, 'too_many_subjects') ? t('tooMany') : landed > 0 ? t('partial') : undefined;
      toast({ type: 'error', title: t('failed'), ...(reason === undefined ? {} : { description: reason }) });
      return false;
    } finally {
      running.current = false;
      setPending(false);
      if (landed > 0) for (const queryKey of internalLinksKeys(scope)) void queryClient.invalidateQueries({ queryKey });
    }
  };

  return {
    pending,
    setTier: (target: BulkTarget, tier: PageTier | null): Promise<boolean> =>
      run(
        target,
        async (selection) =>
          (await setTiers.mutateAsync({ params: { path }, body: { ...selection, tier_id: tier?.tier_id ?? null } }))
            .data.matched,
        (matched) => ({
          title: t('tierSet'),
          description: t('tierSetText', { count: matched, tier: tier?.label ?? t('untiered') }),
        }),
      ),
    resetToRule: (target: BulkTarget): Promise<boolean> =>
      run(
        target,
        async (selection) => (await reset.mutateAsync({ params: { path }, body: selection })).data.matched,
        (matched) => ({ title: t('resetDone'), description: t('resetDoneText', { count: matched }) }),
      ),
    changeTag: (target: BulkTarget, tag: { termId: string; name: string }, add: boolean): Promise<boolean> =>
      run(
        target,
        async (selection) =>
          (
            await tags.mutateAsync({
              params: { path },
              body: { ...selection, add: add ? [tag.termId] : [], remove: add ? [] : [tag.termId] },
            })
          ).data.matched,
        (matched) => ({
          title: add ? t('tagAdded') : t('tagRemoved'),
          description: t(add ? 'tagAddedText' : 'tagRemovedText', { tag: tag.name, count: matched }),
        }),
      ),
  };
}
