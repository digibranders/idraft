'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';

import { ensureGroups } from './ensure-groups';
import { pathProblem, splitPath, type PathProblem } from './group-paths';
import type { ProjectScope } from '../rankings-queries';
import { refreshGroups, useKeywordGroups } from '../taxonomy-queries';
import { apiMutation } from '@/lib/api/query';

const CREATE = apiMutation('post', '/api/v1/workspaces/{workspace_id}/projects/{project_id}/keyword-groups');

/**
 * A group a picker offers or holds: one that exists, one typed to be created on save, or (for "Move to
 * group" only) none at all.
 */
export type GroupChoice =
  | { kind: 'existing'; key: string; groupId: string; path: string; count: number }
  | { kind: 'new'; key: string; path: string }
  | { kind: 'none'; key: 'none' };

export const NO_GROUP_CHOICE: GroupChoice = { kind: 'none', key: 'none' };

/** A typed path as a choice; the key ignores case, as group names do. */
export function newGroupChoice(text: string): GroupChoice {
  const path = splitPath(text).join('/');
  return { kind: 'new', key: `new:${path.toLocaleLowerCase()}`, path };
}

/** Whether a typed path can become a group. */
export const canCreatePath = (text: string): boolean => pathProblem(text) === null;

const PATH_PROBLEM_KEY = {
  empty: 'pathEmpty',
  too_long: 'pathTooLong',
  too_deep: 'pathTooDeep',
} as const satisfies Record<PathProblem, string>;

/**
 * Checks the paths typed in a form before anything is sent: answers the sentence for the first typed
 * path that cannot become a group, or `null` when every one can.
 */
export function useGroupPathCheck(): (chosen: readonly GroupChoice[]) => string | null {
  const t = useTranslations('rankings.groups');
  return useCallback(
    (chosen) => {
      for (const choice of chosen) {
        if (choice.kind !== 'new') continue;
        const problem = pathProblem(choice.path);
        if (problem !== null) return t(PATH_PROBLEM_KEY[problem]);
      }
      return null;
    },
    [t],
  );
}

export interface GroupChoices {
  choices: readonly Extract<GroupChoice, { kind: 'existing' }>[];
  byId: ReadonlyMap<string, Extract<GroupChoice, { kind: 'existing' }>>;
  ready: boolean;
  failed: boolean;
}

/** The project's groups as choices, in the API's path order. */
export function useGroupChoices(scope: ProjectScope): GroupChoices {
  const groups = useKeywordGroups(scope);
  return useMemo(() => {
    const choices = (groups.data?.data ?? []).map((group) => ({
      kind: 'existing' as const,
      key: group.group_id,
      groupId: group.group_id,
      path: group.path,
      count: group.keyword_count,
    }));
    return {
      choices,
      byId: new Map(choices.map((choice) => [choice.groupId, choice])),
      ready: groups.isSuccess,
      failed: groups.isError,
    };
  }, [groups.data, groups.isSuccess, groups.isError]);
}

/**
 * The ids of the chosen groups, creating the new ones first. Rejects with the API's refusal of a create;
 * the groups list is refreshed either way, so groups made before a refusal show.
 */
export function useEnsureGroups(scope: ProjectScope): (chosen: readonly GroupChoice[]) => Promise<string[]> {
  const queryClient = useQueryClient();
  const groups = useKeywordGroups(scope);
  const create = useMutation(CREATE);
  const { mutateAsync } = create;
  return useCallback(
    async (chosen) => {
      const existing = chosen.flatMap((choice) => (choice.kind === 'existing' ? [choice.groupId] : []));
      const typed = chosen.flatMap((choice) => (choice.kind === 'new' ? [choice.path] : []));
      if (typed.length === 0) return existing;
      try {
        const made = await ensureGroups(typed, groups.data?.data ?? [], async (name, parentId) => {
          const answer = await mutateAsync({
            params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId } },
            body: { name, parent_id: parentId },
          });
          return answer.data;
        });
        return [...new Set([...existing, ...made])];
      } finally {
        await refreshGroups(queryClient, scope);
      }
    },
    [groups.data, mutateAsync, queryClient, scope],
  );
}
