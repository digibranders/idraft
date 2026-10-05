'use client';

import { useQuery, type QueryClient, type UseQueryResult } from '@tanstack/react-query';

import type { ProjectScope } from './rankings-queries';
import { projectKey, workspaceKey } from '@/lib/api/keys';
import { apiQuery, type ApiResponse } from '@/lib/api/query';

/**
 * The project's keyword groups and the vocabularies it sees with their terms, as the filters and the
 * keyword inspector read them. The reads themselves are shared with the schedules of Project settings and
 * live in `@/lib/keywords/taxonomy-reads`; what stays here is what only Rankings changes or shows.
 */

export {
  keywordGroupsQuery,
  useKeywordGroups,
  useVocabularies,
  useVocabularyList,
  type NamedTerm,
  type Vocabularies,
  type Vocabulary,
  type VocabularyTerms,
} from '@/lib/keywords/taxonomy-reads';

const GROUPS = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/keyword-groups';

type GroupList = ApiResponse<'get', typeof GROUPS>;

/** After a change of which keywords a group holds: its keyword count moved. */
export function refreshGroups(queryClient: QueryClient, scope: ProjectScope): Promise<void> {
  return queryClient.invalidateQueries({
    queryKey: [...projectKey(scope.workspaceId, scope.projectId), 'keyword-groups'],
  });
}

/** After terms were made by an import: the vocabularies and every term list of the workspace read again. */
export function refreshVocabularies(queryClient: QueryClient, workspaceId: string): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: [...workspaceKey(workspaceId), 'vocabularies'] });
}

/** The project's groups as a tree, for Manage groups. Shares `refreshGroups` with the flat list. */
export function useKeywordGroupTree(scope: ProjectScope): UseQueryResult<GroupList> {
  return useQuery(
    apiQuery(GROUPS, {
      params: {
        path: { workspace_id: scope.workspaceId, project_id: scope.projectId },
        query: { format: 'tree' },
      },
    }),
  );
}
