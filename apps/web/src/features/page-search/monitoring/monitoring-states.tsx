'use client';

import { Ban } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { Banner } from '@/components/app/status/banner';
import { EmptyState } from '@/components/app/status/empty-state';
import { LinkButton } from '@/components/ui/link-button';
import { useCan } from '@/lib/permissions';
import { integrationsPath } from '@/lib/routes/paths';

export interface ProjectRef {
  workspaceSlug: string;
  projectSlug: string;
}

/** A member without `data:read` (spec 9), as Internal links says it. */
export function NoAccess(): ReactElement {
  const t = useTranslations('monitoring');
  return <EmptyState icon={Ban} title={t('noAccessTitle')} reason={t('noAccessReason')} headingLevel={2} />;
}

/** Search Console is not linked to the project: no table, and the way to link it for a member who can. */
export function NotConnectedState({ workspaceSlug, projectSlug }: ProjectRef): ReactElement {
  const t = useTranslations('monitoring');
  const p = useTranslations('pageSearch');
  const canManage = useCan('integrations:manage');
  return (
    <EmptyState
      title={t('notConnectedTitle')}
      reason={canManage ? p('states.notConnected') : p('states.askAdmin')}
      headingLevel={2}
      primaryAction={
        canManage ? (
          <LinkButton size="sm" render={<Link href={integrationsPath(workspaceSlug, projectSlug)} />}>
            {p('openIntegrations')}
          </LinkButton>
        ) : undefined
      }
    />
  );
}

/** Connected, and the first 28 days are not stored yet: the rows are listed with skeleton numbers. */
export function PendingBanner(): ReactElement {
  const t = useTranslations('monitoring');
  return <Banner tone="info" placement="region" message={t('pendingBanner')} />;
}

/** Nothing tracked yet; the Add pages button arrives with its dialog. */
export function NothingTracked({ limit }: { limit: number }): ReactElement {
  const t = useTranslations('monitoring');
  return <EmptyState variant="table" title={t('empty.title')} reason={t('empty.reason', { limit })} headingLevel={3} />;
}
