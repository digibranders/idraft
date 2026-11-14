'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { type PromptScope } from '../prompt-queries';
import { apiQuery, type ApiQueryOptions, type ApiResponse } from '@/lib/api/query';

const LIMITS = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/limits' as const;
/** The limits move with every add, run and archive, which refresh them; this long a read stands for the next one. */
const STALE_MS = 10_000;

export type AiLimitsAnswer = ApiResponse<'get', typeof LIMITS>;

/**
 * `GET {P}/ai/limits` (contract C1): the active prompts of the workspace against their limit, its AI answers this
 * month, and the manual runs the project has had today. The key sits under the project's AI reads, so
 * `refreshPrompts` reads it again after a change.
 */
export const aiLimitsQuery = (scope: PromptScope): ApiQueryOptions<typeof LIMITS> =>
  apiQuery(LIMITS, { params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId } } });

export function useAiLimits(
  scope: PromptScope,
  { enabled = true }: { enabled?: boolean } = {},
): UseQueryResult<AiLimitsAnswer> {
  return useQuery({ ...aiLimitsQuery(scope), enabled, staleTime: STALE_MS });
}
