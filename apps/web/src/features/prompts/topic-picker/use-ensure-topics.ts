'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback } from 'react';

import {
  leafTermId,
  splitSelections,
  splitTopicPath,
  TOPIC_VOCABULARY_NAME,
  type TopicSelection,
} from './topic-picker-model';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation, apiQuery } from '@/lib/api/query';
import { formatList } from '@/lib/format';
import type { TaxonomyScope } from '@/lib/keywords/taxonomy-reads';

const CREATE = apiMutation('post', '/api/v1/workspaces/{workspace_id}/vocabularies/{vocabulary_id}/terms');
const CREATE_VOCABULARY = apiMutation('post', '/api/v1/workspaces/{workspace_id}/vocabularies');
const TERMS = '/api/v1/workspaces/{workspace_id}/vocabularies/{vocabulary_id}/terms';
const VOCABULARIES = '/api/v1/workspaces/{workspace_id}/vocabularies';
/** As `useVocabularies` asks, so the two share the cache. */
const VOCABULARY_PAGE = 200;

/** The vocabularies the project sees, the request `useVocabularies` makes, so the two share the cache. */
const vocabulariesQuery = (scope: TaxonomyScope): ReturnType<typeof apiQuery<typeof VOCABULARIES>> =>
  apiQuery(VOCABULARIES, {
    params: {
      path: { workspace_id: scope.workspaceId },
      query: { 'filter[project_id]': scope.projectId, limit: VOCABULARY_PAGE },
    },
  });

/** The tree of a vocabulary's terms, the request `useVocabularies` makes, so the two share the cache. */
const treeQuery = (scope: TaxonomyScope, vocabularyId: string): ReturnType<typeof apiQuery<typeof TERMS>> =>
  apiQuery(TERMS, {
    params: {
      path: { workspace_id: scope.workspaceId, vocabulary_id: vocabularyId },
      query: { format: 'tree' },
    },
  });

export interface EnsuredTopics {
  /** The terms to file the prompts under: the ones that existed, then the ones made, each once. */
  termIds: readonly string[];
  /** The paths this call made, which stay when what follows fails. */
  made: readonly string[];
  /** The term id of each path in `made`, so the form can hold it as an existing term. */
  madeTermIds: ReadonlyMap<string, string>;
}

/** Why the topics could not be made, and which were made before it. */
export class EnsureTopicsFailure extends Error {
  readonly made: readonly string[];

  constructor(cause: unknown, made: readonly string[]) {
    super('The topics could not be made', { cause });
    this.name = 'EnsureTopicsFailure';
    this.made = made;
  }
}

/**
 * The form's topics as term ids, making the typed ones first (`POST terms` with `{ items: [{ path }] }`, which
 * makes the missing parents and adds nothing for a path that exists, so it is safe to repeat). The API answers
 * only the terms it made, so each new leaf's id is read from the vocabulary's tree after the call. Nothing is
 * written until this runs: the form calls it when the person submits, then makes its request. A path with no
 * vocabulary (the project has no topic vocabulary) makes the project's one first, once for all of them, and
 * uses the one that exists when the API answers `409 duplicate` (made meanwhile). Rejects with an
 * `EnsureTopicsFailure`; the terms of the vocabulary are read again after topics were made. A vocabulary made
 * and then left empty by a failure is not a topic made: it is named in no sentence, and the next try uses it.
 */
export function useEnsureTopics(
  scope: TaxonomyScope,
): (selections: readonly TopicSelection[]) => Promise<EnsuredTopics> {
  const queryClient = useQueryClient();
  const { mutateAsync } = useMutation(CREATE);
  const { mutateAsync: createVocabulary } = useMutation(CREATE_VOCABULARY);

  /** The id of the project's topic vocabulary: made now, or the one that exists when the API says it does. */
  const projectTopics = useCallback(async (): Promise<string> => {
    const path = { workspace_id: scope.workspaceId };
    try {
      const answer = await createVocabulary({
        params: { path },
        body: {
          kind: 'topic',
          name: TOPIC_VOCABULARY_NAME,
          project_id: scope.projectId,
          is_hierarchical: true,
          is_single_valued: false,
        },
      });
      // The screens that list the vocabularies read them again to show it
      void queryClient.invalidateQueries({ queryKey: vocabulariesQuery(scope).queryKey });
      return answer.data.vocabulary_id;
    } catch (error) {
      if (!isApiProblem(error, 'duplicate')) throw error;
      const list = await queryClient.fetchQuery({ ...vocabulariesQuery(scope), staleTime: 0 });
      const existing = list.data.find(
        (vocabulary) =>
          vocabulary.kind === 'topic' &&
          vocabulary.project_id === scope.projectId &&
          vocabulary.name.toLowerCase() === TOPIC_VOCABULARY_NAME.toLowerCase(),
      );
      if (existing === undefined) throw error;
      return existing.vocabulary_id;
    }
  }, [createVocabulary, queryClient, scope]);

  return useCallback(
    async (selections) => {
      const { termIds, created } = splitSelections(selections);
      if (created.length === 0) return { termIds, made: [], madeTermIds: new Map() };
      const ids = new Set(termIds);
      const made: string[] = [];
      const madeTermIds = new Map<string, string>();
      try {
        // The vocabulary comes before any term in it, and is made once however many topics were typed
        let projectVocabularyId: string | null = null;
        const byVocabulary = new Map<string, typeof created>();
        for (const entry of created) {
          const vocabularyId = entry.vocabularyId ?? (projectVocabularyId ??= await projectTopics());
          byVocabulary.set(vocabularyId, [...(byVocabulary.get(vocabularyId) ?? []), entry]);
        }
        for (const [vocabularyId, entries] of byVocabulary) {
          const answer = await mutateAsync({
            params: { path: { workspace_id: scope.workspaceId, vocabulary_id: vocabularyId } },
            body: { items: entries.map((entry) => ({ path: splitTopicPath(entry.path).join('/') })) },
          });
          const madeIds = new Set(answer.data.map((term) => term.term_id));
          const tree = await queryClient.fetchQuery({ ...treeQuery(scope, vocabularyId), staleTime: 0 });
          for (const entry of entries) {
            const id = leafTermId(tree.data, splitTopicPath(entry.path));
            if (id === null) throw new Error(`The topic ${entry.path} is not in the tree it was made in`);
            ids.add(id);
            if (madeIds.has(id)) {
              made.push(entry.path);
              madeTermIds.set(entry.path, id);
            }
          }
        }
        return { termIds: [...ids], made, madeTermIds };
      } catch (error) {
        throw new EnsureTopicsFailure(error, made);
      }
    },
    [mutateAsync, projectTopics, queryClient, scope],
  );
}

/**
 * The sentence that tells the topics made before a failed add stay: "Topic “Startups” was created. The prompts
 * were not added." `null` when none were made.
 */
export function useTopicLeftover(): (made: readonly string[]) => string | null {
  const t = useTranslations('prompts.add.topicPicker');
  const locale = useLocale();
  return useCallback(
    (made) =>
      made.length === 0
        ? null
        : t('leftover', {
            count: made.length,
            paths: formatList(
              made.map((path) => t('quoted', { value: path })),
              locale,
            ),
          }),
    [locale, t],
  );
}
