'use client';

import { useQueries, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMemo } from 'react';

import { apiQuery, type ApiQueryOptions, type ApiResponse } from '@/lib/api/query';
import type { TermNode } from '@/lib/api/types';

/**
 * The reads of the project's keyword groups and of the vocabularies it sees with their terms, shared by
 * the screens that file or select keywords by them (Rankings, and the selector of a schedule). The
 * requests are the taxonomy screen's, so every screen shares one cache.
 */

const GROUPS = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/keyword-groups';
const VOCABULARIES = '/api/v1/workspaces/{workspace_id}/vocabularies';
const TERMS = '/api/v1/workspaces/{workspace_id}/vocabularies/{vocabulary_id}/terms';
/** As the taxonomy screen asks, so the two share the cache. */
const VOCABULARY_PAGE = 200;

/** The workspace and the project whose taxonomy is read. */
export interface TaxonomyScope {
  workspaceId: string;
  projectId: string;
}

type GroupList = ApiResponse<'get', typeof GROUPS>;
type TermTree = ApiResponse<'get', typeof TERMS>;
type VocabularyList = ApiResponse<'get', typeof VOCABULARIES>;
export type Vocabulary = VocabularyList['data'][number];

/** The read of the project's groups as a flat list, for `useKeywordGroups` and for a form that reads it on save. */
export const keywordGroupsQuery = (scope: TaxonomyScope): ApiQueryOptions<typeof GROUPS> =>
  apiQuery(GROUPS, {
    params: {
      path: { workspace_id: scope.workspaceId, project_id: scope.projectId },
      query: { format: 'flat' },
    },
  });

/** The project's groups as a flat list, each with its path ("Services / Audits"). */
export function useKeywordGroups(scope: TaxonomyScope): UseQueryResult<GroupList> {
  return useQuery(keywordGroupsQuery(scope));
}

/** One term with its place by name, "SEO / Local SEO". */
export interface NamedTerm {
  termId: string;
  path: string;
}

export interface VocabularyTerms {
  vocabulary: Vocabulary;
  /** Depth first, as the tree lists them. */
  terms: readonly NamedTerm[];
}

export interface Vocabularies {
  /** The vocabularies whose terms have loaded, in the API's order. */
  loaded: readonly VocabularyTerms[];
  /** A list is still loading or failed: a value that names a term may yet be known. */
  pending: boolean;
  error: boolean;
}

/** Each term's place by name, depth first. */
function namedPaths(nodes: readonly TermNode[], above = ''): NamedTerm[] {
  return nodes.flatMap((node) => {
    const path = above === '' ? node.name : `${above} / ${node.name}`;
    return [{ termId: node.term_id, path }, ...namedPaths(node.children, path)];
  });
}

/** The trees of the vocabularies, and whether any is still loading or failed. */
const combineTrees = (
  results: readonly { data?: TermTree | undefined; isPending: boolean; isError: boolean }[],
): { trees: (TermTree | undefined)[]; pending: boolean; error: boolean } => ({
  trees: results.map((result) => result.data),
  pending: results.some((result) => result.isPending),
  error: results.some((result) => result.isError),
});

/** The read of the vocabularies the project sees, without their terms. */
const vocabulariesQuery = (scope: TaxonomyScope): ApiQueryOptions<typeof VOCABULARIES> =>
  apiQuery(VOCABULARIES, {
    params: {
      path: { workspace_id: scope.workspaceId },
      query: { 'filter[project_id]': scope.projectId, limit: VOCABULARY_PAGE },
    },
  });

/** The vocabularies the project sees, for a choice of one; `enabled` holds the read back until it is needed. */
export function useVocabularyList(scope: TaxonomyScope, enabled = true): UseQueryResult<VocabularyList> {
  return useQuery({ ...vocabulariesQuery(scope), enabled });
}

/** The vocabularies the project sees, each with its terms. */
export function useVocabularies(scope: TaxonomyScope): Vocabularies {
  const vocabularies = useQuery(vocabulariesQuery(scope));
  const terms = useQueries({
    queries: (vocabularies.data?.data ?? []).map((vocabulary) =>
      apiQuery(TERMS, {
        params: {
          path: { workspace_id: scope.workspaceId, vocabulary_id: vocabulary.vocabulary_id },
          query: { format: 'tree' },
        },
      }),
    ),
    combine: combineTrees,
  });
  const { trees } = terms;
  const loaded = useMemo(
    (): VocabularyTerms[] =>
      (vocabularies.data?.data ?? []).flatMap((vocabulary, index) => {
        const tree = trees[index];
        return tree === undefined ? [] : [{ vocabulary, terms: namedPaths(tree.data) }];
      }),
    [vocabularies.data, trees],
  );
  return {
    loaded,
    pending: vocabularies.isPending || terms.pending,
    error: vocabularies.isError || terms.error,
  };
}
