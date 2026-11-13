'use client';

import { Power } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { useOverview } from '../overview-context';
import { EmptyState } from '@/components/app/status/empty-state';
import { TextLink } from '@/components/ui/text-link';
import { projectPath } from '@/lib/routes/paths';

/**
 * The body of a project with no AI engine on (spec 3.6): the page has nothing to count, so it says why and where
 * the engines are turned on. A member who cannot turn them on is told whom to ask, with no link.
 */
export function NoEngineState(): ReactElement {
  const t = useTranslations('aiOverview.empty');
  const { workspaceSlug, project, canManageEngines } = useOverview();
  return (
    <EmptyState
      icon={Power}
      title={t('noEngineTitle')}
      reason={canManageEngines ? t('noEngineReason') : t('askAdmin')}
      headingLevel={2}
      {...(canManageEngines
        ? {
            secondaryAction: (
              <TextLink render={<Link href={projectPath(workspaceSlug, project.slug, '/settings/engines')} />}>
                {t('toEngines')}
              </TextLink>
            ),
          }
        : {})}
    />
  );
}
