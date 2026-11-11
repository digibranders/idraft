'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, type ReactElement } from 'react';

import { analyticsRows, type AnalyticsRow } from './google-model';
import { analyticsPropertiesQuery, refreshGoogle, type GoogleScope } from './google-queries';
import { useChooseProperty } from './use-choose-property';
import { Banner } from '@/components/app/status/banner';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { isApiProblem } from '@/lib/api/problem';
import { useErrorId } from '@/lib/api/use-error-id';
import type { AnalyticsProperty, Connection } from '@/lib/api/types';

export interface AnalyticsChooserProps extends GoogleScope {
  connection: Connection;
  account: string | null;
  /** Called once the property is saved, after the page has read the new state. */
  onChosen: () => void;
  /** Starts connecting Google again. */
  onReconnect: () => void;
}

const TYPE_KEYS = {
  ordinary: 'ordinary',
  subproperty: 'subproperty',
  rollup: 'rollup',
  unspecified: 'unspecified',
} as const satisfies Record<AnalyticsProperty['property_type'], string>;

/**
 * The GA4 property picker: every property the account can see in Google Analytics, each labelled with its
 * account. Nothing is matched to the project's domain and nothing is suggested, since a property's site is a
 * web stream that the list does not carry; the person picks by account and name. A property another project
 * already uses is disabled.
 */
export function AnalyticsChooser({
  workspaceId,
  projectId,
  connection,
  account,
  onChosen,
  onReconnect,
}: AnalyticsChooserProps): ReactElement {
  const t = useTranslations('integrations.analyticsChooser');
  const shared = useTranslations('integrations');
  const chooser = useTranslations('integrations.chooser');
  const reauth = useTranslations('integrations.reauth');
  const common = useTranslations('common');
  const queryClient = useQueryClient();
  const properties = useQuery(analyticsPropertiesQuery(workspaceId, connection.connection_id));
  const errorId = useErrorId(properties.error);
  const { choosing, pick } = useChooseProperty(
    { workspaceId, projectId },
    connection.connection_id,
    'ga4',
    () => void properties.refetch(),
  );
  const needsReauth = properties.isError && isApiProblem(properties.error, 'integration_reauth_required');
  const scopeMissing = properties.isError && isApiProblem(properties.error, 'integration_scope_missing');
  useEffect(() => {
    if (needsReauth || scopeMissing) void refreshGoogle(queryClient, { workspaceId, projectId });
  }, [needsReauth, scopeMissing, queryClient, workspaceId, projectId]);

  const rows = analyticsRows(properties.data?.data ?? []);

  const choose = async (row: AnalyticsRow): Promise<void> => {
    if (await pick(row.property.external_property, row.property.label)) onChosen();
  };

  const columns: PlainColumn<AnalyticsRow>[] = [
    {
      id: 'property',
      header: t('columns.property'),
      wrap: true,
      cell: ({ property, blocked }) => (
        <span className="flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2 text-foreground">
            <span className="wrap-anywhere">{property.label}</span>
            <Badge variant="outline">{t(`types.${TYPE_KEYS[property.property_type]}`)}</Badge>
          </span>
          <span className="type-label wrap-anywhere">{property.external_property}</span>
          {blocked === 'linked' ? <span className="type-label">{chooser('linked')}</span> : null}
        </span>
      ),
    },
    {
      id: 'account',
      header: t('columns.account'),
      wrap: true,
      cell: ({ property }) => <span className="wrap-anywhere">{property.account_label}</span>,
    },
    {
      id: 'actions',
      header: t('columns.actions'),
      hideHeader: true,
      actions: true,
      cell: (row) => (
        <Button
          size="sm"
          aria-label={t('chooseProperty', { property: row.property.label, account: row.property.account_label })}
          disabled={row.blocked !== null || (choosing !== null && choosing !== row.property.external_property)}
          loading={choosing === row.property.external_property}
          onClick={() => void choose(row)}
        >
          {chooser('choose')}
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="ga4-chooser-title" className="type-body-strong">
            {t('title')}
          </h3>
          <p className="mt-1 type-meta">{t('description')}</p>
          {account === null ? null : <p className="type-meta">{chooser('account', { account })}</p>}
        </div>
        <Button
          size="sm"
          loading={properties.isFetching && !properties.isPending}
          onClick={() => void properties.refetch()}
        >
          {chooser('reload')}
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
              {chooser('reconnect')}
            </Button>
          }
        />
      ) : scopeMissing ? (
        <Banner
          tone="warning"
          placement="region"
          message={shared('product.ga4.accessMissing')}
          actions={
            <Button size="sm" onClick={onReconnect}>
              {chooser('reconnect')}
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
        <PlainTable<AnalyticsRow>
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
