'use client';

import { useMemo } from 'react';

import { useOverview } from '../overview-context';
import { topicsKeptOf } from './topic-options';
import { useVocabularies, type NamedTerm } from '@/lib/keywords/taxonomy-reads';

export interface TopicTree {
  /** Every topic of the project's topic vocabularies, depth first, each with its path. */
  tree: readonly NamedTerm[];
  /** The trees are loading or failed: what a topic holds below it is not known yet. */
  pending: boolean;
}

/**
 * The project's topic vocabularies' trees, the one read behind the topic filter and the count of topics under it.
 * The vocabulary reads are cached queries, so every caller shares one request.
 */
export function useTopicTree(): TopicTree {
  const { workspaceId, project } = useOverview();
  const vocabularies = useVocabularies({ workspaceId, projectId: project.id });
  const tree = useMemo(
    () => vocabularies.loaded.filter((entry) => entry.vocabulary.kind === 'topic').flatMap((entry) => entry.terms),
    [vocabularies.loaded],
  );
  return { tree, pending: vocabularies.pending || vocabularies.error };
}

/**
 * The topics the chosen topic keeps (itself and every topic below it) for the numbers' count of topics in scope;
 * `null` without a topic filter, and while the tree cannot say yet. Cards read this for any count of topics.
 */
export function useTopicsKept(): ReadonlySet<string> | null {
  const { scope } = useOverview();
  const { tree, pending } = useTopicTree();
  return useMemo(() => topicsKeptOf(tree, scope.topic, pending), [tree, scope.topic, pending]);
}
