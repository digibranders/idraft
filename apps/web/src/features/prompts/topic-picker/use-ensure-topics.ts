'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback } from 'react';

import { leafTermId, splitSelections, splitTopicPath, type TopicSelection } from './topic-picker-model';
import { apiMutation, apiQuery } from '@/lib/api/query';
import { formatList } from '@/lib/format';
import type { TaxonomyScope } from '@/lib/keywords/taxonomy-reads';

const CREATE = apiMutation('post', '/api/v1/workspaces/{workspace_id}/vocabularies/{vocabulary_id}/terms');
const TERMS = '/api/v1/workspaces/{workspace_id}/vocabularies/{vocabulary_id}/terms';

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
 * written until this runs: the form calls it when the person submits, then makes its request. Rejects with an
 * `EnsureTopicsFailure`; the terms of the vocabulary are read again after topics were made.
 */
export function useEnsureTopics(
  scope: TaxonomyScope,
): (selections: readonly TopicSelection[]) => Promise<EnsuredTopics> {
  const queryClient = useQueryClient();
  const { mutateAsync } = useMutation(CREATE);
  return useCallback(
    async (selections) => {
      const { termIds, created } = splitSelections(selections);
      if (created.length === 0) return { termIds, made: [] };
      const byVocabulary = new Map<string, typeof created>();
      for (const entry of created)
        byVocabulary.set(entry.vocabularyId, [...(byVocabulary.get(entry.vocabularyId) ?? []), entry]);
      const ids = new Set(termIds);
      const made: string[] = [];
      try {
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
            if (madeIds.has(id)) made.push(entry.path);
          }
        }
        return { termIds: [...ids], made };
      } catch (error) {
        throw new EnsureTopicsFailure(error, made);
      }
    },
    [mutateAsync, queryClient, scope],
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
