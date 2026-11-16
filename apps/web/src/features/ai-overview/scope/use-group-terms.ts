'use client';

import { useMemo } from 'react';

import { useOverviewSummary } from '../data/use-overview-reads';
import { useOverview } from '../overview-context';
import { groupTerms } from './group-options';
import { useTopicTree } from './use-topic-tree';
import type { NamedTerm } from '@/lib/keywords/taxonomy-reads';

/**
 * The groups the Group select offers: the topics that hold a prompt and have none with a prompt below them. They are
 * read from the topic rows of the project's whole summary (no topic, platform or location chosen, the window and the
 * branded choice of the page), so the list does not change with the other controls. `null` until the rows are read.
 */
export function useGroupTerms(): readonly NamedTerm[] | null {
  const { workspaceId, project, scope, enabledEngines } = useOverview();
  const { tree } = useTopicTree();
  const input = useMemo(
    () => ({
      project: { workspaceId, projectId: project.id },
      scope: { ...scope, topic: null, engines: null, country: null, compare: false },
      enabledEngines,
    }),
    [workspaceId, project.id, scope, enabledEngines],
  );
  const read = useOverviewSummary(input, { rows: 'topics' });
  const topics = read.data?.topics;
  return useMemo(() => (topics === undefined ? null : groupTerms(tree, topics)), [tree, topics]);
}
