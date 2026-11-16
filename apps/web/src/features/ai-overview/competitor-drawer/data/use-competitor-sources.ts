'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { askedEngines } from '../../data/overview-queries';
import { useRead, type Read } from '../../data/read-state';
import { useOverview } from '../../overview-context';
import { brandedParams } from '../../scope/scope-model';
import type { CitedDomain, CompetitorSources } from '../model/sources';
import { apiFetch } from '@/lib/api/api-fetch';
import { problemFrom } from '@/lib/api/problem';
import { queryKey } from '@/lib/api/keys';

/**
 * BACKEND REQUEST SHAPE (request 6 of `docs/ai-visibility/backend-requests-overview.md`). The API has no read of which
 * domains are cited in the answers that mention each brand, so `GET {P}/ai/sources/overlap` is not in the generated client.
 * Until the backend builds it, the Cited domains tab says "Not collected yet" and nothing is asked: a build with API mocking
 * off (production) never sends the request, and the mock handler (`mocks/handlers/ai-source-overlap.ts`) answers it with a
 * fixture so the tab can be seen and tested. A real answer is `{ data: { theirs, yours } }` as `CompetitorSources`.
 */
export const SOURCES_COLLECTED = process.env.NEXT_PUBLIC_API_MOCKING !== 'off';

const OVERLAP = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/sources/overlap';

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function domainsOf(value: unknown): CitedDomain[] {
  if (!Array.isArray(value)) throw new TypeError('The sources answer has no domain list');
  return value.map((entry: unknown): CitedDomain => {
    if (
      !isRecord(entry) ||
      typeof entry.domain !== 'string' ||
      typeof entry.share !== 'number' ||
      typeof entry.third_party !== 'boolean'
    ) {
      throw new TypeError('A cited domain of the sources answer is malformed');
    }
    return { domain: entry.domain, share: entry.share, thirdParty: entry.third_party };
  });
}

/** The answer of the overlap read, checked at the boundary: a malformed body is an error, never an empty list. */
export function parseSources(body: unknown): CompetitorSources {
  const data = isRecord(body) ? body.data : undefined;
  if (!isRecord(data)) throw new TypeError('The sources answer has no data');
  return { theirs: domainsOf(data.theirs), yours: domainsOf(data.yours) };
}

export function useCompetitorSources(entityId: string, subscribed: boolean): Read<CompetitorSources> {
  const { workspaceId, project, scope, enabledEngines } = useOverview();
  const asked = useMemo(() => askedEngines({ scope, enabledEngines }), [scope, enabledEngines]);
  const enabled = SOURCES_COLLECTED && subscribed && asked.length > 0;
  const query = useQuery({
    queryKey: queryKey(
      OVERLAP,
      { workspace_id: workspaceId, project_id: project.id },
      {
        entity_id: entityId,
        from: scope.range.from,
        to: scope.range.to,
        branded: scope.branded,
        engines: asked.join(','),
        country: scope.country,
        term: scope.topic,
      },
    ),
    queryFn: async ({ signal }): Promise<CompetitorSources> => {
      const url = new URL(
        OVERLAP.replace('{workspace_id}', encodeURIComponent(workspaceId)).replace(
          '{project_id}',
          encodeURIComponent(project.id),
        ),
        window.location.origin,
      );
      const params = {
        entity_id: entityId,
        from: scope.range.from,
        to: scope.range.to,
        'filter[engine_code_in]': asked.join(','),
        ...brandedParams(scope.branded),
        ...(scope.country === null ? {} : { 'filter[country_iso]': scope.country }),
        ...(scope.topic === null ? {} : { 'filter[term]': scope.topic }),
      };
      for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
      const response = await apiFetch(
        new Request(url, { credentials: 'same-origin', signal, headers: { accept: 'application/json' } }),
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw problemFrom(response, body);
      return parseSources(body);
    },
    enabled,
    placeholderData: keepPreviousData,
  });
  return useRead(query, enabled ? 'run' : 'idle');
}
