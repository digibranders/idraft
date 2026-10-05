'use client';

import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';

import { ensureGroups } from './ensure-groups';
import { childNamed, pathProblem, splitPath, type GroupLike, type PathProblem } from './group-paths';
import { groupRefusal } from './group-refusals';
import type { ProjectScope } from '../rankings-queries';
import { keywordGroupsQuery, refreshGroups, useKeywordGroups } from '../taxonomy-queries';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation } from '@/lib/api/query';
import { formatList } from '@/lib/format';

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
  return { kind: 'new', key: `new:${path.toLowerCase()}`, path };
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

/** A group the forms file keywords in. */
export interface EnsuredGroup {
  groupId: string;
  path: string;
}

export interface EnsuredGroups {
  /** The chosen groups, each once: the ones that existed first, then the typed ones as the API has them. */
  groups: readonly EnsuredGroup[];
  /** The paths of the groups this call made, which stay when what follows fails. */
  made: readonly string[];
}

/**
 * Why the groups could not be ensured, and which were made before it: a later level refused after the
 * first was made leaves that one behind, and the person is told so.
 */
export class EnsureGroupsFailure extends Error {
  readonly made: readonly string[];

  constructor(cause: unknown, made: readonly string[]) {
    super('The keyword groups could not be made', { cause });
    this.name = 'EnsureGroupsFailure';
    this.made = made;
  }
}

/** The groups as the API has them now: never the copy a form was rendered with, which may be old. */
const readGroups = async (queryClient: QueryClient, scope: ProjectScope): Promise<readonly GroupLike[]> =>
  (await queryClient.fetchQuery({ ...keywordGroupsQuery(scope), staleTime: 0 })).data;

/**
 * The chosen groups, creating the typed ones that do not exist first. The list is read when this runs, so a
 * form opened on an old or unloaded list never creates a group that is there. A create refused as a
 * duplicate (a teammate made it meanwhile) uses the group that has the name, so making groups is safe to
 * repeat. Rejects with an `EnsureGroupsFailure`; the groups list is refreshed after groups were made.
 */
export function useEnsureGroups(scope: ProjectScope): (chosen: readonly GroupChoice[]) => Promise<EnsuredGroups> {
  const queryClient = useQueryClient();
  const create = useMutation(CREATE);
  const { mutateAsync } = create;
  return useCallback(
    async (chosen) => {
      const existing = chosen.flatMap((choice) =>
        choice.kind === 'existing' ? [{ groupId: choice.groupId, path: choice.path }] : [],
      );
      const typed = chosen.flatMap((choice) => (choice.kind === 'new' ? [choice.path] : []));
      if (typed.length === 0) return { groups: existing, made: [] };
      const made: GroupLike[] = [];
      try {
        const listed = await readGroups(queryClient, scope);
        // Every group seen, to name the ids ensureGroups answers
        const known: GroupLike[] = [...listed];
        const ids = await ensureGroups(typed, listed, async (name, parentId) => {
          try {
            const answer = await mutateAsync({
              params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId } },
              body: { name, parent_id: parentId },
            });
            made.push(answer.data);
            known.push(answer.data);
            return answer.data;
          } catch (error) {
            if (!isApiProblem(error, 'duplicate')) throw error;
            const sibling = childNamed(await readGroups(queryClient, scope), parentId, name);
            if (sibling === null) throw error;
            known.push(sibling);
            return sibling;
          }
        });
        const byId = new Map(existing.map((group) => [group.groupId, group] as const));
        for (const id of ids) {
          const group = known.find((candidate) => candidate.group_id === id);
          if (group === undefined) throw new Error(`The group ${id} is not in the list the groups were made from`);
          if (!byId.has(id)) byId.set(id, { groupId: id, path: group.path });
        }
        return { groups: [...byId.values()], made: made.map((group) => group.path) };
      } catch (error) {
        throw new EnsureGroupsFailure(
          error,
          made.map((group) => group.path),
        );
      } finally {
        if (made.length > 0) await refreshGroups(queryClient, scope);
      }
    },
    [mutateAsync, queryClient, scope],
  );
}

export interface GroupMessages {
  /**
   * The sentence for a failed ensure: the API's refusal, and the groups made before it when there are some.
   * Any other failure is answered as a refusal would be.
   */
  refusal: (error: unknown, options?: { single?: boolean }) => string;
  /** Says that these groups were made and a second try files the keywords in them; `null` when none were. */
  leftover: (made: readonly string[], options?: { single?: boolean }) => string | null;
}

/** The sentences the forms show when making groups, or what follows it, fails. */
export function useGroupMessages(): GroupMessages {
  const t = useTranslations('rankings.groups');
  const refusals = useTranslations('rankings.groups.refusals');
  const locale = useLocale();
  return useMemo((): GroupMessages => {
    const leftover: GroupMessages['leftover'] = (made, { single = false } = {}) =>
      made.length === 0
        ? null
        : t('leftover', { count: made.length, paths: formatList(made, locale), files: single ? 'one' : 'other' });
    return {
      leftover,
      refusal: (error, options) => {
        const cause = error instanceof EnsureGroupsFailure ? error.cause : error;
        const made = error instanceof EnsureGroupsFailure ? error.made : [];
        const note = leftover(made, options);
        const refused = groupRefusal(cause, refusals).message;
        return note === null ? refused : `${refused} ${note}`;
      },
    };
  }, [t, refusals, locale]);
}
