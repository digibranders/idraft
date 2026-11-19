import { apiQuery, type ApiQueryOptions } from '@/lib/api/query';

import type { SourceScope } from './types';

const PROMPTS = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/prompts' as const;
/** One page of prompts, the most the API gives. */
const PAGE = 200;

/**
 * `GET {P}/prompts`: the project's active prompts with the text the engines receive, newest first. The Competitors
 * page reads the countries of the prompts from it. One page: a prompt past it adds no country here.
 */
export const promptTextsQuery = (scope: SourceScope): ApiQueryOptions<typeof PROMPTS> =>
  apiQuery(PROMPTS, {
    params: {
      path: { workspace_id: scope.workspaceId, project_id: scope.projectId },
      query: { limit: PAGE },
    },
  });
