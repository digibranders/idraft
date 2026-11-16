'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type {
  PromptsSummaryWithFacts,
  PromptSummaryRowWithFacts,
  TopicSummaryRowWithFacts,
  TrackedEntity,
} from './types';
import type { DateRange } from '../prompt-model';
import type { PromptScope, SummaryScope } from '../prompt-queries';
import { apiQuery, type ApiQueryOptions } from '@/lib/api/query';
import { compareParams } from '@/lib/compare/compare-model';
import { publicEnv } from '@/lib/env/public';
import type { paths } from '@/lib/api/schema';

const SUMMARY = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/prompts-summary' as const;

type SummaryInclude = NonNullable<NonNullable<paths[typeof SUMMARY]['get']['parameters']['query']>['include']>[number];

/**
 * BACKEND REQUEST SHAPE: the `include` value that asks the prompt summary for the facts of
 * `docs/ai-visibility/backend-requests-prompts-page.md`. The generated client does not know it yet, so the one cast
 * lives here; drop it when `pnpm gen:api` brings the value.
 */
const FACTS_INCLUDE = 'facts' as SummaryInclude;

/**
 * Whether to send `include=facts`. The API in production refuses a value it does not know (`422`), so it is sent only
 * where the mocks answer it, until the backend ships the include. Flip this when it does.
 */
export const factsRequested = (): boolean => publicEnv.NEXT_PUBLIC_API_MOCKING === 'all';

export interface PromptFactsOptions extends Omit<SummaryScope, 'include'> {
  /** Send `include=facts`; defaults to `factsRequested()`. Without it the read is the plain summary with entities. */
  requestFacts?: boolean;
}

/**
 * `GET {P}/ai/prompts-summary` with `include=entities,facts`: the cells, the tracked entities and the per-engine facts
 * of every prompt and topic row in ONE read, never a request for a row. Without `requestFacts` it is the plain
 * summary with entities, whose rows carry no fact.
 */
export function promptFactsQuery(
  scope: PromptScope,
  range: DateRange,
  includeBranded: boolean,
  { requestFacts = factsRequested(), country, term, brandedOnly, compare }: PromptFactsOptions = {},
): ApiQueryOptions<typeof SUMMARY> {
  return apiQuery(SUMMARY, {
    params: {
      path: { workspace_id: scope.workspaceId, project_id: scope.projectId },
      query: {
        from: range.from,
        to: range.to,
        include_branded: includeBranded,
        ...(country === undefined ? {} : { 'filter[country_iso]': country }),
        ...(term === undefined ? {} : { 'filter[term]': term }),
        ...(brandedOnly === true ? { branded_only: true } : {}),
        include: requestFacts ? ['entities', FACTS_INCLUDE] : ['entities'],
        ...compareParams(compare === true),
      },
    },
  });
}

/** The facts of a summary read, found by prompt and by topic. */
export interface PromptFacts {
  prompts: ReadonlyMap<string, PromptSummaryRowWithFacts>;
  /** Topic rows by `term_id`; the row of the prompts without a topic has the key `null`. */
  topics: ReadonlyMap<string | null, TopicSummaryRowWithFacts>;
  /** The tracked entities of the project, the own brands first. */
  entities: readonly TrackedEntity[];
  /** The engines the rows carry cells for. */
  engineCodes: readonly string[];
  /** The read carried facts: `include=facts` was sent. A row field can still be absent. */
  requested: boolean;
}

/** Index a summary read; defined once so the query's `select` is stable. */
export function indexFacts(summary: PromptsSummaryWithFacts, requested: boolean): PromptFacts {
  return {
    prompts: new Map(summary.prompts.map((row) => [row.prompt_id, row])),
    topics: new Map(summary.topics.map((row) => [row.term_id, row])),
    entities: summary.entities,
    engineCodes: summary.engine_codes,
    requested,
  };
}

/**
 * The facts of the Prompts columns for every row in scope, through the one summary read. Fields the backend has not built
 * are absent on the rows, and the functions of this folder read them as unknown, never as 0.
 */
export function usePromptFacts(
  scope: PromptScope,
  range: DateRange,
  includeBranded: boolean,
  options: PromptFactsOptions = {},
): UseQueryResult<PromptFacts> {
  const requested = options.requestFacts ?? factsRequested();
  return useQuery({
    ...promptFactsQuery(scope, range, includeBranded, { ...options, requestFacts: requested }),
    select: (response) => indexFacts(response.data, requested),
  });
}
