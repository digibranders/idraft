'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { AliasTestSection } from './alias-test-section';
import { EntityAliasesSection } from './entity-aliases-section';
import { EntityDetailsForm } from './entity-details-form';
import { EntityDomainsSection } from './entity-domains-section';
import { entityQuery, projectQuery, type EntityDetail, type ProjectScope } from './entity-queries';
import { Banner } from '@/components/app/status/banner';
import { InlineError } from '@/components/app/status/inline-error';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { TextLink } from '@/components/ui/text-link';
import { isApiProblem } from '@/lib/api/problem';
import { canWriteEntities, useMembership } from '@/lib/permissions';
import { projectPath } from '@/lib/routes/paths';

export interface EntityEditorProps extends ProjectScope {
  entityId: string;
  workspaceSlug: string;
  projectSlug: string;
}

/**
 * The entity editor (20 section 5.19.6): an entity's details, the domains that count as its site, and the
 * aliases that count as its name in answers. The entity belongs to the workspace, so a change here holds
 * in every project that uses it. Read-only without `entities:write`.
 */
export function EntityEditor({
  workspaceId,
  projectId,
  entityId,
  workspaceSlug,
  projectSlug,
}: EntityEditorProps): ReactNode {
  const t = useTranslations('entitySettings.editor');
  const common = useTranslations('common');
  // A member limited to some projects cannot change workspace entities, whatever their role
  const canWrite = canWriteEntities(useMembership());
  const entity = useQuery(entityQuery(workspaceId, entityId));
  const project = useQuery(projectQuery({ workspaceId, projectId }));
  const version = project.data?.data.entity_config_version;
  const back = (
    <TextLink
      render={<Link href={projectPath(workspaceSlug, projectSlug, '/settings/entities')} />}
      className="inline-flex items-center gap-1 self-start type-body"
    >
      <Icon icon={ChevronLeft} size="sm" />
      {t('back')}
    </TextLink>
  );
  if (entity.isPending) {
    return (
      <div className="flex flex-col gap-5" aria-busy="true">
        {back}
        <Skeleton shape="text-14" widthPct={48} />
        <Skeleton shape="block" height="chart-180" />
      </div>
    );
  }
  // A failed refetch keeps the entity on screen: only a first load that failed replaces it
  if (entity.isError && entity.data === undefined) {
    const gone = isApiProblem(entity.error, 'not_found');
    return (
      <div className="flex flex-col gap-5">
        {back}
        <InlineError
          title={gone ? t('gone') : t('loadFailed')}
          reason={gone ? t('goneReason') : t('loadFailedReason')}
          errorId={null}
          onRetry={() => void entity.refetch()}
          retrying={entity.isFetching}
          retryLabel={common('retry')}
        />
      </div>
    );
  }
  if (entity.data === undefined) return null;
  const detail: EntityDetail = entity.data.data;
  const role = detail.projects.find((held) => held.project_id === projectId && held.removed_at === null);
  const scope: ProjectScope = { workspaceId, projectId };
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        {back}
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="type-section-title">{detail.canonical_name}</h2>
          {role === undefined ? <Badge>{t('notInProject')}</Badge> : <Badge>{t(`roles.${role.role}`)}</Badge>}
        </div>
        <p className="type-meta">
          {t('description', { count: detail.projects.filter((held) => held.removed_at === null).length })}
        </p>
        {version === undefined ? null : <p className="type-meta">{t('version', { version })}</p>}
        {canWrite ? null : <Banner tone="info" placement="region" lead={t('readOnlyLead')} message={t('readOnly')} />}
      </div>
      <EntityDetailsForm scope={scope} entity={detail} canWrite={canWrite} />
      <EntityDomainsSection scope={scope} entity={detail} canWrite={canWrite} />
      <EntityAliasesSection scope={scope} entity={detail} canWrite={canWrite} />
      {role === undefined ? null : <AliasTestSection scope={scope} version={version} />}
    </div>
  );
}
