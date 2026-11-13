import type { SourceScope } from './types';
import { apiQuery, type ApiQueryOptions } from '@/lib/api/query';

const PROMPTS = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/prompts' as const;
/** One page of prompts, the most the API gives. */
const PAGE = 200;

/**
 * `GET {P}/prompts`: the project's active prompts with the text the engines receive, newest first. The Citations
 * page names the prompts of `sources/prompts` by it. One page: a prompt past it has no text here and the page says so.
 */
export const promptTextsQuery = (scope: SourceScope): ApiQueryOptions<typeof PROMPTS> =>
  apiQuery(PROMPTS, {
    params: {
      path: { workspace_id: scope.workspaceId, project_id: scope.projectId },
      query: { limit: PAGE },
    },
  });

/** The text of each prompt of a page, by its id; empty while the read has no page. */
export const promptTextsById = (
  page: { data: readonly { prompt_id: string; current_version: { text: string } }[] } | undefined,
): ReadonlyMap<string, string> =>
  new Map((page?.data ?? []).map((prompt) => [prompt.prompt_id, prompt.current_version.text]));
