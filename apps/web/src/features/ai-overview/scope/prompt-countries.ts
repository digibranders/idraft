'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import { useRead, type Read } from '../data/read-state';
import type { ProjectRef } from '../data/overview-queries';
import { api, unwrap } from '@/lib/api/client';
import { projectKey } from '@/lib/api/keys';

/**
 * The countries the Overview's country control offers: the markets the project's prompts ask in, read from the
 * prompts list as the Prompts page's country control does (its summary has no `by_country` here yet).
 * shortcut: the prompts are read page by page for their countries, replaced by the summary's `by_country` once the
 * summary mock has it (WP-33 follow-up F5).
 */

const PROMPTS = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/prompts' as const;
/** The prompts asked for in one page. */
const PAGE = 200;
/** The list stops here whatever the API says: the base plan allows 150 active prompts a workspace. */
export const MAX_COUNTRY_PROMPTS = 1000;
const FIRST_PAGE: string | null = null;

export type PromptCountries = Read<readonly string[]> & {
  /** Every page has been read, or the cap was reached: the list is as whole as it will be. */
  complete: boolean;
};

/** Two capital letters each, sorted, once: the countries of the prompts and the one chosen (a link may name any). */
export function usePromptCountries(project: ProjectRef, chosen: string | null): PromptCountries {
  const { data, hasNextPage, isFetching, isError, error, fetchNextPage, refetch } = useInfiniteQuery({
    // Under the project's `prompts` prefix, so a change of the prompts reads the countries again
    queryKey: [...projectKey(project.workspaceId, project.projectId), 'prompts', 'overview-countries'],
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        api.GET(PROMPTS, {
          params: {
            path: { workspace_id: project.workspaceId, project_id: project.projectId },
            query: { limit: PAGE, ...(pageParam === null ? {} : { cursor: pageParam }) },
          },
          signal,
        }),
      ),
    initialPageParam: FIRST_PAGE,
    getNextPageParam: (last) => (last.page.has_more ? last.page.next_cursor : null),
  });
  const prompts = useMemo(() => (data?.pages ?? []).reduce((count, page) => count + page.data.length, 0), [data]);
  useEffect(() => {
    if (hasNextPage && !isFetching && !isError && prompts < MAX_COUNTRY_PROMPTS) void fetchNextPage();
  }, [hasNextPage, isFetching, isError, prompts, fetchNextPage]);
  const countries = useMemo((): readonly string[] | undefined => {
    if (data === undefined) return undefined;
    const found = new Set<string>(chosen === null ? [] : [chosen]);
    for (const page of data.pages) {
      for (const prompt of page.data) if (prompt.country_iso !== null) found.add(prompt.country_iso);
    }
    return [...found].sort();
  }, [data, chosen]);
  const read = useRead({ data: countries, error, isError, isFetching, refetch });
  return useMemo(
    () => ({ ...read, complete: data !== undefined && (!hasNextPage || prompts >= MAX_COUNTRY_PROMPTS) }),
    [read, data, hasNextPage, prompts],
  );
}
