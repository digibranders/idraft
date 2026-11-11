'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

import { MAX_GROUP_NAME } from './group-paths';
import { refreshKeywords, type ProjectScope } from '../rankings-queries';
import { refreshGroups } from '../taxonomy-queries';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation } from '@/lib/api/query';
import type { KeywordGroupUpdate } from '@/lib/api/types';
import { textLength } from '@/lib/text/length';

const GROUP = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/keyword-groups/{group_id}';
const CHANGE = apiMutation('patch', GROUP);
const REMOVE = apiMutation('delete', GROUP);

/**
 * The group writes Manage groups and the By group view share: a rename or a move (`PATCH`), and a delete. The
 * caller reads the groups and keywords again after a change; a delete does that itself.
 */
export function useChangeGroup(scope: ProjectScope): {
  change: (groupId: string, body: KeywordGroupUpdate) => Promise<void>;
  pending: boolean;
} {
  const mutation = useMutation(CHANGE);
  const { mutateAsync } = mutation;
  const change = useCallback(
    async (groupId: string, body: KeywordGroupUpdate): Promise<void> => {
      await mutateAsync({
        params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId, group_id: groupId } },
        body,
      });
    },
    [mutateAsync, scope.workspaceId, scope.projectId],
  );
  return { change, pending: mutation.isPending };
}

/**
 * Deletes a group and reads the groups and the keywords again (each keyword lists its groups). A group deleted
 * meanwhile is gone, which is what was asked; any other refusal is thrown for the caller to say.
 */
export function useDeleteGroup(scope: ProjectScope): (groupId: string) => Promise<void> {
  const queryClient = useQueryClient();
  const { mutateAsync } = useMutation(REMOVE);
  return useCallback(
    async (groupId: string): Promise<void> => {
      try {
        await mutateAsync({
          params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId, group_id: groupId } },
        });
      } catch (error) {
        if (!isApiProblem(error, 'not_found')) throw error;
      }
      await refreshGroups(queryClient, scope);
      void refreshKeywords(queryClient, scope);
    },
    [mutateAsync, queryClient, scope],
  );
}

/** What is wrong with a group name before it is sent, as a sentence, or `null` when nothing is. */
export function useGroupNameCheck(): (name: string) => string | null {
  const t = useTranslations('rankings.groups.manage');
  const pickers = useTranslations('rankings.groups');
  const refusals = useTranslations('rankings.groups.refusals');
  return useCallback(
    (name: string): string | null => {
      if (name === '') return t('nameRequired');
      if (textLength(name) > MAX_GROUP_NAME) return pickers('pathTooLong');
      return name.includes('/') ? refusals('slash') : null;
    },
    [t, pickers, refusals],
  );
}
