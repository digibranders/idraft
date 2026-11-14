'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { NewSourcesCount } from './facts-model';
import { askedEngines, brandedAskable, comparisonWindow } from '../../data/overview-queries';
import { mapRead, useRead, type Read } from '../../data/read-state';
import type { ReadOptions } from '../../data/use-overview-reads';
import { useOverview } from '../../overview-context';
import { apiQuery } from '@/lib/api/query';
import type { Schemas } from '@/lib/api/types';

const CHANGES = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/sources/changes' as const;

const countOf = (page: Schemas['SourceChangePage']): NewSourcesCount => ({
  total: page.page.total,
  minSupport: page.meta.min_support,
});

/**
 * The domains first cited in the window (`GET ai/sources/changes?kind=new&limit=1`, so the answer is `page.total`
 * and `meta.min_support`), for the "new sources" fact of What changed. It is an optional read: a card that fails to
 * get it writes no fact and shows no error, and it is not part of the card's own phase.
 *
 * It does not run for "branded only" (the route takes `include_branded` and cannot keep branded prompts alone) and
 * not with the comparison off (new means none in the window before, which the page is not showing). It keeps no data
 * across a scope change, so a figure of another scope is never written next to the new one. While `subscribed` is
 * `false` it asks nothing.
 * shortcut: `total` counts rows, one per domain and role, so a domain listed under two roles counts twice, until the
 * route answers a count of domains.
 */
export function useNewSources({ subscribed = true }: ReadOptions = {}): Read<NewSourcesCount> {
  const { workspaceId, project, scope, enabledEngines } = useOverview();
  const asked = askedEngines({ scope, enabledEngines });
  const runs = asked.length > 0 && brandedAskable(scope) && comparisonWindow(scope) !== null;
  const query = useQuery({
    ...apiQuery(CHANGES, {
      params: {
        path: { workspace_id: workspaceId, project_id: project.id },
        query: {
          kind: 'new',
          from: scope.range.from,
          to: scope.range.to,
          include_branded: scope.branded !== 'excluded',
          limit: 1,
          // Every enabled engine asked is what leaving the filter out means
          ...(asked.length === enabledEngines.length ? {} : { 'filter[engine_code_in]': [...asked] }),
          ...(scope.country === null ? {} : { 'filter[country_iso]': scope.country }),
          ...(scope.topic === null ? {} : { 'filter[term]': scope.topic }),
        },
      },
    }),
    enabled: runs && subscribed,
  });
  // Paused (customize mode): the count it already has for this scope stays, otherwise nothing, and never a request
  const read = useRead(query, !runs ? 'idle' : subscribed ? 'run' : 'paused');
  return useMemo(() => mapRead(read, countOf), [read]);
}
