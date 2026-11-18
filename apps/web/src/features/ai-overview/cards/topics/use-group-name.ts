'use client';

import { useTranslations } from 'next-intl';

import { useOverview } from '../../overview-context';
import { useTopicTree } from '../../scope/use-topic-tree';

export interface ChosenGroup {
  /** The name as the Group select writes it (a group below another is named by its path); `null` for All groups. */
  name: string | null;
  /** The vocabulary trees are not read yet, so the name is not known: a title says "the chosen group" meanwhile. */
  pending: boolean;
}

/**
 * The group the page is for. A group the tree does not hold (deleted, or from another project) is "Unknown group",
 * never its id; while the trees load the name is not guessed at, so "Unknown group" never shows for a moment.
 */
export function useChosenGroup(): ChosenGroup {
  const t = useTranslations('aiOverview.shell');
  const { scope } = useOverview();
  const { tree, pending } = useTopicTree();
  if (scope.topic === null) return { name: null, pending: false };
  if (pending) return { name: null, pending: true };
  const term = tree.find((entry) => entry.termId === scope.topic);
  if (term === undefined) return { name: t('groupUnknown'), pending: false };
  return { name: term.parentId === null ? term.name : term.path, pending: false };
}
