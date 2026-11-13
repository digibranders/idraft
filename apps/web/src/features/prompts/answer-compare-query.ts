import type { PromptScope } from './prompt-queries';
import { apiQuery, type ApiQueryOptions, type ApiResponse } from '@/lib/api/query';

const COMPARE =
  '/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/observations/{observation_id}/compare' as const;

/** An answer against the last earlier one that named the brand (`AnswerCompare`). */
export type AnswerComparison = ApiResponse<'get', typeof COMPARE>['data'];

/**
 * `GET {P}/ai/observations/{observation_id}/compare` (`data:read`): the brands and sources an answer gained, lost and
 * kept against the newest earlier answer of the same prompt and engine that named the brand (contract note
 * `docs/ai-visibility/contracts/evidence.md`, rules D1 and D2). An answer with none is `404 no_baseline`: a reason the
 * screen words, not a failure, and not worth asking again, which the shared retry rule already holds (an answer below 500
 * is final). `observationId` is one the detail read has already given an answer for.
 */
export const answerCompareQuery = (scope: PromptScope, observationId: string): ApiQueryOptions<typeof COMPARE> =>
  apiQuery(COMPARE, {
    params: {
      path: { workspace_id: scope.workspaceId, project_id: scope.projectId, observation_id: Number(observationId) },
    },
  });
