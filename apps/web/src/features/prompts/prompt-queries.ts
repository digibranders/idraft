'use client';

import {
  keepPreviousData,
  queryOptions,
  useInfiniteQuery,
  useQuery,
  type QueryClient,
  type QueryFunction,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import type { DateRange } from './prompt-model';
import { api, unwrap } from '@/lib/api/client';
import { projectKey, queryKey, type QueryKey } from '@/lib/api/keys';
import { ApiProblem } from '@/lib/api/problem';
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
const OBSERVATIONS = `${P}/ai/observations` as const;
const OBSERVATION = `${OBSERVATIONS}/{observation_id}` as const;
const RAW = `${OBSERVATION}/raw` as const;
const SUMMARY = `${P}/ai/prompts-summary` as const;
const ENTITIES = `${P}/entities` as const;

type PromptPage = ApiResponse<'get', typeof PROMPTS>;
export type LintAnswer = ApiResponse<'post', typeof LINT>;
/** An answer as the read gives it (`ObservationDetail`, with the spans as lists of numbers, not pairs). */
export type ObservationAnswer = ApiResponse<'get', typeof OBSERVATION>['data'];

/** The prompts asked for in one page. */
const PAGE = 200;
/** The list stops here whatever the API says: the base plan allows 150 active prompts a workspace. */
export const MAX_PROMPTS = 1000;
/**
 * A prompt's answers in one read, the most the API gives (200). Scheduled runs make 78 to 81 over 90 days
 * (twice a week on three engines); manual runs add to them (up to 20 a day for the workspace), and the list does
 * not read a second page.
 */
const ANSWERS_PAGE = 200;
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
  /** Another page is to be read: the rows are not the whole list yet, or a page failed. */
  hasMore: boolean;
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
    // Past `MAX_PROMPTS` no page is read, so the list is as whole as it will be
    hasMore: hasNextPage && rows.length < MAX_PROMPTS,
    refetch: () => void refetch(),
  };
}

const NOT_FOUND = (): ApiProblem =>
  new ApiProblem({
    status: 404,
    code: 'not_found',
    title: 'Not Found',
    detail: null,
    requestId: null,
    errors: [],
    retryAfterSeconds: null,
    body: {},
  });

/** Whether `id` has the shape of a prompt id (a UUID): anything else names no prompt and is not looked up. */
export const isPromptId = (id: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

/**
 * `GET {P}/prompts/{prompt_id}`; an id that `isPromptId` refuses (`?inspect=prompt:abc`) is not asked and
 * rejects with a `not_found` `ApiProblem`, as the screens read a prompt that is not there.
 */
export const promptQuery = (scope: PromptScope, promptId: string): ApiQueryOptions<typeof PROMPT> => {
  if (!isPromptId(promptId)) {
    const queryFn: QueryFunction<ApiResponse<'get', typeof PROMPT>, QueryKey> = () => Promise.reject(NOT_FOUND());
    return {
      ...queryOptions({ queryKey: queryKey(PROMPT, { ...pathOf(scope), prompt_id: promptId }, {}), queryFn }),
      queryFn,
    };
  }
  return apiQuery(PROMPT, { params: { path: { ...pathOf(scope), prompt_id: promptId } } });
};

/** What narrows a summary to part of the prompts. A scope that is not given is not sent and not in the key. */
export interface SummaryScope {
  /** The prompts of one market, two capital letters. */
  country?: string;
  /** The prompts given this term or a term below it, and the topic rows of that term and those below it. */
  term?: string;
  /** The branded prompts alone; the API lets it win over `includeBranded`. */
  brandedOnly?: boolean;
}

/** `GET {P}/ai/prompts-summary`: Mentioned, Cited and the rest per prompt, topic and engine over the window. */
export const summaryQuery = (
  scope: PromptScope,
  range: DateRange,
  includeBranded: boolean,
  { country, term, brandedOnly }: SummaryScope = {},
): ApiQueryOptions<typeof SUMMARY> =>
  apiQuery(SUMMARY, {
    params: {
      path: pathOf(scope),
      query: {
        from: range.from,
        to: range.to,
        include_branded: includeBranded,
        ...(country === undefined ? {} : { 'filter[country_iso]': country }),
        ...(term === undefined ? {} : { 'filter[term]': term }),
        ...(brandedOnly === true ? { branded_only: true } : {}),
      },
    },
  });

/** `GET {P}/ai/observations` for one prompt over the window, newest first. */
export const observationsQuery = (
  scope: PromptScope,
  promptId: string,
  range: DateRange,
): ApiQueryOptions<typeof OBSERVATIONS> =>
  apiQuery(OBSERVATIONS, {
    params: {
      path: pathOf(scope),
      query: { 'filter[prompt_id]': promptId, from: range.from, to: range.to, limit: ANSWERS_PAGE },
    },
  });

/**
 * Whether `id` is an observation id a path number holds exactly. The API sends the id as text and takes a
 * 64-bit integer; the typed path wants a number, exact only up to 2^53. Ids come from a sequence and stay far
 * below that, so a larger one is no answer of ours and is not looked up as another one.
 */
export const isObservationId = (id: string): boolean => /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id));

/**
 * `GET {P}/ai/observations/{observation_id}`; an `observationId` that `isObservationId` refuses is not asked
 * and rejects with a `not_found` `ApiProblem`, as the screens read a missing answer.
 * `observedAt` is the `observed_at` of the list row: the API finds the month of the answer with it.
 */
export const observationQuery = (
  scope: PromptScope,
  observationId: string,
  observedAt?: string,
): ApiQueryOptions<typeof OBSERVATION> => {
  const query = observedAt === undefined ? {} : { observed_at: observedAt };
  if (!isObservationId(observationId)) {
    // An id typed into the address (`?inspect=answer:abc`) names no answer: nothing is asked, and the inspector
    // reaches the same not found state as for an answer that does not exist
    const queryFn: QueryFunction<ApiResponse<'get', typeof OBSERVATION>, QueryKey> = () => Promise.reject(NOT_FOUND());
    return {
      ...queryOptions({
        queryKey: queryKey(OBSERVATION, { ...pathOf(scope), observation_id: observationId }, query),
        queryFn,
      }),
      queryFn,
    };
  }
  return apiQuery(OBSERVATION, {
    params: { path: { ...pathOf(scope), observation_id: Number(observationId) }, query },
  });
};

/**
 * `GET {P}/ai/observations/{observation_id}/raw` (`raw:read`): the provider's answer as it came, as a file. An
 * answer past its retention rejects with `410 raw_expired`, one that cannot be read now with `503
 * raw_unavailable`. `observedAt` is as for `observationQuery`.
 */
export function fetchRawAnswer(scope: PromptScope, observationId: string, observedAt?: string): Promise<Blob> {
  if (!isObservationId(observationId)) return Promise.reject(NOT_FOUND());
  return unwrap(
    api.GET(RAW, {
      params: {
        path: { ...pathOf(scope), observation_id: Number(observationId) },
        query: observedAt === undefined ? {} : { observed_at: observedAt },
      },
      parseAs: 'blob',
    }),
  );
}

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
/**
 * `POST {P}/prompts/{prompt_id}/run-now`: a manual run through the standard queue, answered 202 with the run.
 * A refusal rejects with an `ApiProblem`: `422 validation_failed` with an `engine_codes` item for each engine
 * refused (`engine_not_enabled`, `prompt_too_long`, `location_not_enabled`, `price_unavailable`), `409
 * check_pending` (`body.engine_codes`), `429 manual_run_limit` (`limit` only), `422 quota_exceeded` (`limit`,
 * `used`, `requested`, `quota`) and `503 provider_paused` (`retryAfterSeconds`). On success the caller calls
 * `refreshPrompts`, which reads again every answer under `aiKey`, and refreshes the project's runs.
 */
export const RUN_NOW = apiMutation('post', `${PROMPT}/run-now`);
