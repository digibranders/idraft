'use client';

import { useTranslations } from 'next-intl';

import { useOverview } from '../../overview-context';
import { useTopicTree } from '../../scope/use-topic-tree';
import { engineLabel } from '@/lib/layouts';

/** The platform and the group of the page scope in words: the badges of the header and the meta of the first card. */
export function useScopeParts(): { platform: string; group: string } {
  const t = useTranslations('aiOverview.competitorDrawer');
  const shell = useTranslations('aiOverview.shell');
  const { scope } = useOverview();
  const { tree } = useTopicTree();
  const single = scope.engines !== null && scope.engines.length === 1 ? scope.engines[0] : undefined;
  return {
    platform: single === undefined ? t('allPlatforms') : engineLabel(single),
    group:
      scope.topic === null
        ? t('allGroups')
        : (tree.find((term) => term.termId === scope.topic)?.name ?? shell('groupUnknown')),
  };
}
