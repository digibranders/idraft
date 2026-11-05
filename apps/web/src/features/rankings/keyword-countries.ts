'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { ProjectScope } from './rankings-queries';
import { apiQuery } from '@/lib/api/query';

/**
 * The countries a project has keywords in (19 section 3.5), for the table's country control and the Country
 * filter. Its key sits under `keywordsKey`, so `refreshKeywords` reads it again after any change to the keywords.
 */

const COUNTRIES = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords/countries';

export interface KeywordCountry {
  locationId: number;
  name: string;
  countryIso: string;
  keywordCount: number;
}

export interface KeywordCountries {
  countries: readonly KeywordCountry[];
  /** No answer yet. */
  loading: boolean;
  /** The read failed: the list is empty because it is unknown, not because the project has no keywords. */
  failed: boolean;
}

export function useKeywordCountries(scope: ProjectScope): KeywordCountries {
  const query = useQuery(
    apiQuery(COUNTRIES, { params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId } } }),
  );
  const countries = useMemo(
    () =>
      (query.data?.data ?? []).map((entry) => ({
        locationId: entry.location.location_id,
        name: entry.location.name,
        countryIso: entry.location.country_iso,
        keywordCount: entry.keyword_count,
      })),
    [query.data],
  );
  return { countries, loading: query.isPending, failed: query.isError };
}
