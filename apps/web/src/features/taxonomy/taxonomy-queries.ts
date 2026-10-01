import type { QueryClient } from '@tanstack/react-query';

import { apiQuery, type ApiQueryOptions } from '@/lib/api/query';
import type { components } from '@/lib/api/schema';

export type Vocabulary = components['schemas']['Vocabulary'];
export type VocabularyKind = Vocabulary['kind'];
export type TermNode = components['schemas']['TermNode'];

export const VOCABULARY_KINDS: readonly VocabularyKind[] = [
  'topic',
  'cluster',
  'product',
  'service',
  'market',
  'campaign',
  'persona',
  'tag',
  'custom',
];

/** The most vocabularies one page holds; a project uses a handful. */
const PAGE = 200;
const VOCABULARIES = '/api/v1/workspaces/{workspace_id}/vocabularies';
const TERMS = '/api/v1/workspaces/{workspace_id}/vocabularies/{vocabulary_id}/terms';

/** The vocabularies a project sees: its own and the workspace-wide ones. */
export const vocabulariesQuery = (workspaceId: string, projectId: string): ApiQueryOptions<typeof VOCABULARIES> =>
  apiQuery(VOCABULARIES, {
    params: { path: { workspace_id: workspaceId }, query: { 'filter[project_id]': projectId, limit: PAGE } },
  });

/** A vocabulary's terms as a tree. */
export const termsQuery = (workspaceId: string, vocabularyId: string): ApiQueryOptions<typeof TERMS> =>
  apiQuery(TERMS, {
    params: { path: { workspace_id: workspaceId, vocabulary_id: vocabularyId }, query: { format: 'tree' } },
  });

/** After a change to terms: the tree, and the vocabulary list whose term counts moved. */
export function refreshTerms(
  queryClient: QueryClient,
  workspaceId: string,
  projectId: string,
  vocabularyId: string,
): void {
  void queryClient.invalidateQueries({ queryKey: termsQuery(workspaceId, vocabularyId).queryKey });
  void queryClient.invalidateQueries({ queryKey: vocabulariesQuery(workspaceId, projectId).queryKey });
}

/** Every term of a tree, depth first, with its parent. */
export function flatten(nodes: readonly TermNode[]): TermNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

/** The ids of a term and every term under it: where it may not move. */
export function subtreeIds(node: TermNode): Set<string> {
  return new Set(flatten([node]).map((term) => term.term_id));
}

/** The ids of the terms above `id`, from the root down; empty for a top-level or unknown term. */
export function ancestorsOf(nodes: readonly TermNode[], id: string): string[] {
  for (const node of nodes) {
    if (node.term_id === id) return [];
    const below = ancestorsOf(node.children, id);
    if (below.length > 0 || node.children.some((child) => child.term_id === id)) return [node.term_id, ...below];
  }
  return [];
}

/** Each term's place by name, "CRM / CRM for startups", for lists where the tree is not shown. */
export function namedPaths(nodes: readonly TermNode[], above = ''): Map<string, string> {
  const paths = new Map<string, string>();
  for (const node of nodes) {
    const path = above === '' ? node.name : `${above} / ${node.name}`;
    paths.set(node.term_id, path);
    for (const [id, child] of namedPaths(node.children, path)) paths.set(id, child);
  }
  return paths;
}
