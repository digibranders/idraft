'use client';

import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  type QueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import { api, unwrap } from '@/lib/api/client';
import { projectKey, type QueryKey } from '@/lib/api/keys';
import { apiMutation, apiQuery, type ApiQueryOptions, type ApiResponse } from '@/lib/api/query';
import type { EngineCode, Prompt } from '@/lib/api/types';

/**
 * A project's AI prompts and engines (19 section 3.7, cut to slice 1 by plan A). Every key starts with the
 * project, then `prompts`, `ai` or `engines`, so `refreshPrompts` reaches all of them.
 */

export interface PromptScope {
  workspaceId: string;
  projectId: string;
}

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const ENGINES = `${P}/engines` as const;
const ENGINE = `${ENGINES}/{engine_code}` as const;
const PROMPTS = `${P}/prompts` as const;
const PROMPT = `${PROMPTS}/{prompt_id}` as const;
const LINT = `${PROMPTS}/lint` as const;
const ENTITIES = `${P}/entities` as const;

type PromptPage = ApiResponse<'get', typeof PROMPTS>;
export type LintAnswer = ApiResponse<'post', typeof LINT>;

/** The prompts asked for in one page. */
const PAGE = 200;
/** The list stops here whatever the API says: the base plan allows 150 active prompts a workspace. */
export const MAX_PROMPTS = 1000;
const FIRST_PAGE: string | null = null;

const pathOf = (scope: PromptScope): { workspace_id: string; project_id: string } => ({
  workspace_id: scope.workspaceId,
  project_id: scope.projectId,
});

export const promptsKey = (scope: PromptScope): QueryKey => [
  ...projectKey(scope.workspaceId, scope.projectId),
  'prompts',
];
export const aiKey = (scope: PromptScope): QueryKey => [...projectKey(scope.workspaceId, scope.projectId), 'ai'];
export const enginesKey = (scope: PromptScope): QueryKey => [
  ...projectKey(scope.workspaceId, scope.projectId),
  'engines',
];

/**
 * After a change to the prompts or the engines: the prompt lists, the answers and the summary, and the engines
 * (their active prompt counts and costs). Resolves once the queries on screen have read again.
 */
export function refreshPrompts(queryClient: QueryClient, scope: PromptScope): Promise<void> {
  return Promise.all(
    [promptsKey, aiKey, enginesKey].map((key) => queryClient.invalidateQueries({ queryKey: key(scope) })),
  ).then(() => undefined);
}

/** `GET {P}/engines`: all three engines, configured or not, with the monthly cost of each. */
export const enginesQuery = (scope: PromptScope): ApiQueryOptions<typeof ENGINES> =>
  apiQuery(ENGINES, { params: { path: pathOf(scope) } });

/** `PUT {P}/engines/{engine_code}`: on or off, with the countries it asks in. */
export const PUT_ENGINE = apiMutation('put', ENGINE);

export interface PromptList {
  rows: readonly Prompt[];
  /** The first page has not arrived. */
  loading: boolean;
  error: unknown;
  fetching: boolean;
  refetch: () => void;
}

/** Every active prompt of the project, page after page up to `MAX_PROMPTS`, newest first. */
export function usePromptList(scope: PromptScope): PromptList {
  const query = useInfiniteQuery({
    queryKey: [...promptsKey(scope), 'all'],
    queryFn: ({ pageParam, signal }): Promise<PromptPage> =>
      unwrap(
        api.GET(PROMPTS, {
          params: { path: pathOf(scope), query: { limit: PAGE, ...(pageParam === null ? {} : { cursor: pageParam }) } },
          signal,
        }),
      ),
    initialPageParam: FIRST_PAGE,
    getNextPageParam: (last) => (last.page.has_more ? last.page.next_cursor : null),
  });
  const { data, hasNextPage, isFetching, isError, fetchNextPage, refetch } = query;
  const rows = useMemo(() => (data?.pages ?? []).flatMap((page) => page.data), [data]);
  useEffect(() => {
    if (hasNextPage && !isFetching && !isError && rows.length < MAX_PROMPTS) void fetchNextPage();
  }, [hasNextPage, isFetching, isError, rows.length, fetchNextPage]);
  return {
    rows,
    loading: query.isPending,
    error: query.error,
    fetching: isFetching,
    refetch: () => void refetch(),
  };
}

/** `GET {P}/prompts/{prompt_id}`. */
export const promptQuery = (scope: PromptScope, promptId: string): ApiQueryOptions<typeof PROMPT> =>
  apiQuery(PROMPT, { params: { path: { ...pathOf(scope), prompt_id: promptId } } });

/** The project's entities with their colors, for the marks of an answer. */
export const projectEntitiesQuery = (scope: PromptScope): ApiQueryOptions<typeof ENTITIES> =>
  apiQuery(ENTITIES, { params: { path: pathOf(scope) } });

/**
 * `POST {P}/prompts/lint` for the texts of a list: nothing is stored. `engineCodes` are the project's enabled
 * engines, whose length limits apply; without any, every engine's limit applies.
 */
export function usePromptLint(
  scope: PromptScope,
  texts: readonly string[],
  engineCodes: readonly EngineCode[],
): UseQueryResult<LintAnswer> {
  return useQuery({
    queryKey: [...promptsKey(scope), 'lint', texts, engineCodes],
    queryFn: ({ signal }) =>
      unwrap(
        api.POST(LINT, {
          params: { path: pathOf(scope) },
          body: { texts: [...texts], ...(engineCodes.length === 0 ? {} : { engine_codes: [...engineCodes] }) },
          signal,
        }),
      ),
    enabled: texts.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 0,
  });
}

/** `POST {P}/prompts/bulk-create`. */
export const BULK_CREATE_PROMPTS = apiMutation('post', `${PROMPTS}/bulk-create`);
/** `PATCH {P}/prompts/{prompt_id}`: here only to bring an archived prompt back. */
export const UPDATE_PROMPT = apiMutation('patch', PROMPT);
/** `DELETE {P}/prompts/{prompt_id}`: the archive; the prompt keeps its answers. */
export const ARCHIVE_PROMPT = apiMutation('delete', PROMPT);
