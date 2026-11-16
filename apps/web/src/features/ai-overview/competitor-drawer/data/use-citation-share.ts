'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { citationShareOf, type CitationShare } from './citation-share';
import { askedEngines } from '../../data/overview-queries';
import { mapRead, useRead, type Read } from '../../data/read-state';
import { useOverview } from '../../overview-context';
import { brandedParams } from '../../scope/scope-model';
import { apiQuery } from '@/lib/api/query';

const COMPETITORS = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/competitors' as const;

/**
 * `GET ai/competitors` for the own brand and one competitor, over the window and filters of the page scope. It carries the
 * citation share of each entity and engine; the mention rate and the share of voice come from the prompts summary, as on
 * the cards, so the two reads are never mixed for one number.
 */
export function useCitationShare(ownId: string | undefined, rivalId: string, subscribed: boolean): Read<CitationShare> {
  const { workspaceId, project, scope, enabledEngines } = useOverview();
  const asked = useMemo(() => askedEngines({ scope, enabledEngines }), [scope, enabledEngines]);
  const enabled = ownId !== undefined && asked.length > 0 && subscribed;
  const query = useQuery({
    ...apiQuery(COMPETITORS, {
      params: {
        path: { workspace_id: workspaceId, project_id: project.id },
        query: {
          from: scope.range.from,
          to: scope.range.to,
          ...brandedParams(scope.branded),
          'filter[engine_code_in]': [...asked],
          ...(scope.country === null ? {} : { 'filter[country_iso]': scope.country }),
          ...(scope.topic === null ? {} : { 'filter[term]': scope.topic }),
          entity_ids: ownId === undefined ? [rivalId] : [ownId, rivalId],
        },
      },
    }),
    enabled,
    placeholderData: keepPreviousData,
  });
  const read = useRead(query, enabled ? 'run' : 'idle');
  return useMemo(
    () => mapRead(read, (response) => citationShareOf(response, asked, ownId ?? '', rivalId)),
    [read, asked, ownId, rivalId],
  );
}
