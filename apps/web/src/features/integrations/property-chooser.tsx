'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, type ReactElement } from 'react';

import { propertyRows, type PropertyRow } from './google-model';
import { refreshGoogle, searchConsolePropertiesQuery, type GoogleScope } from './google-queries';
import { useChooseProperty } from './use-choose-property';
import { Banner } from '@/components/app/status/banner';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { isApiProblem } from '@/lib/api/problem';
import { useErrorId } from '@/lib/api/use-error-id';
import type { Connection, SiteProperty } from '@/lib/api/types';

const KNOWN_PERMISSIONS = ['siteOwner', 'siteFullUser', 'siteRestrictedUser', 'siteUnverifiedUser'] as const;
type KnownPermission = (typeof KNOWN_PERMISSIONS)[number];
const isKnownPermission = (value: string): value is KnownPermission =>
  KNOWN_PERMISSIONS.some((known) => known === value);

export interface PropertyChooserProps extends GoogleScope {
  connection: Connection;
  account: string | null;
  /** Called once the property is saved, after the page has read the new state. */
  onChosen: () => void;
  /** Starts connecting Google again, for a connection Google no longer accepts. */
  onReconnect: () => void;
}

/**
 * The Search Console property picker after Google (docs/18 section 4.1): every property the account can see,
 * with its type and the account's permission. An unverified user's entry is disabled with the reason, since
 * Search Console refuses to hand it numbers; one already linked to a project is disabled too; one that
 * overlaps a linked site warns. The property matching the project's primary domain comes first and has the
 * primary button.
 */
export function PropertyChooser({
  workspaceId,
  projectId,
  connection,
  account,
  onChosen,
  onReconnect,
}: PropertyChooserProps): ReactElement {
  const t = useTranslations('integrations.chooser');
  const shared = useTranslations('integrations');
  const reauth = useTranslations('integrations.reauth');
  const common = useTranslations('common');
  const queryClient = useQueryClient();
  const properties = useQuery(searchConsolePropertiesQuery(workspaceId, connection.connection_id));
  const errorId = useErrorId(properties.error);
  const { choosing, pick } = useChooseProperty(
    { workspaceId, projectId },
    connection.connection_id,
    'gsc',
    () => void properties.refetch(),
  );
  const needsReauth = properties.isError && isApiProblem(properties.error, 'integration_reauth_required');
  const scopeMissing = properties.isError && isApiProblem(properties.error, 'integration_scope_missing');
  // The API marks the connection when it finds the sign-in refused, so the page reads it again and switches
  // to its reconnect state; the banner below covers the moment before that
  useEffect(() => {
    if (needsReauth || scopeMissing) void refreshGoogle(queryClient, { workspaceId, projectId });
  }, [needsReauth, scopeMissing, queryClient, workspaceId, projectId]);

  const rows = propertyRows(properties.data?.data ?? [], projectId);
  const permissionLabel = (level: string): string =>
    isKnownPermission(level) ? shared(`permissions.${level}`) : level;
  const typeLabel = (type: SiteProperty['property_type']): string =>
    shared(`propertyTypes.${type === 'domain' ? 'domain' : 'urlPrefix'}`);

  const choose = async (row: PropertyRow): Promise<void> => {
    if (await pick(row.property.external_property, row.property.external_property)) onChosen();
  };

  const columns: PlainColumn<PropertyRow>[] = [
    {
      id: 'property',
      header: t('columns.property'),
      wrap: true,
      // The type and the notes sit under the name, so a narrow screen scrolls sideways for nothing it needs
      cell: ({ property, suggested, blocked }) => (
        <span className="flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2 text-foreground">
            <span className="wrap-anywhere">{property.label}</span>
            <Badge variant="outline">{typeLabel(property.property_type)}</Badge>
            {suggested ? <Badge tone="info">{t('suggested')}</Badge> : null}
          </span>
          {property.label === property.external_property ? null : (
            <span className="type-label wrap-anywhere">{property.external_property}</span>
          )}
          {suggested ? <span className="type-label">{t('suggestedNote')}</span> : null}
          {blocked === 'unverified' ? <span className="type-label">{t('unverified')}</span> : null}
          {blocked === 'linked' ? <span className="type-label">{t('linked')}</span> : null}
          {property.overlap_warning === null ? null : (
            <span className="type-label text-warning-text">
              {t('overlap', { property: property.overlap_warning.external_property })}
            </span>
          )}
        </span>
      ),
    },
    {
      id: 'access',
      header: t('columns.access'),
      cell: ({ property }) => permissionLabel(property.permission_level),
    },
    {
      id: 'actions',
      header: t('columns.actions'),
      hideHeader: true,
      actions: true,
      cell: (row) => (
        <Button
          size="sm"
          variant={row.suggested ? 'primary' : 'secondary'}
          aria-label={t('chooseProperty', { property: row.property.label })}
          disabled={row.blocked !== null || (choosing !== null && choosing !== row.property.external_property)}
          loading={choosing === row.property.external_property}
          onClick={() => void choose(row)}
        >
          {t('choose')}
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="gsc-chooser-title" className="type-body-strong">
            {t('title')}
          </h3>
          <p className="mt-1 type-meta">{t('description')}</p>
          {account === null ? null : <p className="type-meta">{t('account', { account })}</p>}
        </div>
        <Button
          size="sm"
          loading={properties.isFetching && !properties.isPending}
          onClick={() => void properties.refetch()}
        >
          {t('reload')}
        </Button>
      </div>
      {needsReauth ? (
        <Banner
          tone="warning"
          placement="region"
          lead={reauth('lead')}
          message={reauth('message', { account: account ?? shared('accountUnknown') })}
          actions={
            <Button size="sm" onClick={onReconnect}>
              {t('reconnect')}
            </Button>
          }
        />
      ) : scopeMissing ? (
        <Banner
          tone="warning"
          placement="region"
          message={shared('product.gsc.accessMissing')}
          actions={
            <Button size="sm" onClick={onReconnect}>
              {t('reconnect')}
            </Button>
          }
        />
      ) : properties.isError ? (
        <InlineError
          title={t('loadFailed')}
          reason={t('loadFailedReason')}
          errorId={errorId}
          onRetry={() => void properties.refetch()}
          retrying={properties.isFetching}
          retryLabel={common('retry')}
        />
      ) : !properties.isPending && rows.length === 0 ? (
        <EmptyState variant="inline" headingLevel={3} title={t('emptyTitle')} reason={t('emptyReason')} />
      ) : (
        <PlainTable<PropertyRow>
          caption={t('tableLabel')}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.property.external_property}
          status={properties.isPending ? 'loading' : 'ready'}
          errorState={null}
          emptyText={t('emptyTitle')}
          skeletonRows={3}
        />
      )}
    </div>
  );
}
