'use client';

import { useTranslations } from 'next-intl';

import { useOverview } from '../../overview-context';
import { useTopicTree } from '../../scope/use-topic-tree';

/**
 * The name of the group the page is for, as the Group select writes it (a group below another is named by its path);
 * `null` for All groups. A group the tree does not hold (deleted, or from another project) is "Unknown group", never
 * its id, and while the tree loads it is the same, which the card never shows because it waits for the tree.
 */
export function useChosenGroupName(): string | null {
  const t = useTranslations('aiOverview.shell');
  const { scope } = useOverview();
  const { tree } = useTopicTree();
  if (scope.topic === null) return null;
  const term = tree.find((entry) => entry.termId === scope.topic);
  if (term === undefined) return t('groupUnknown');
  return term.parentId === null ? term.name : term.path;
}
