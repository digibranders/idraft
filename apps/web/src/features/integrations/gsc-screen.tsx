'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Plug } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { parseAsString, useQueryState } from 'nuqs';
import { useState, type ReactElement, type ReactNode } from 'react';

import { AccessPanel } from './access-panel';
import { ConnectionPanel } from './connection-panel';
import {
  accountOf,
  canRetryConnect,
  connectErrorKey,
  displayStatus,
  gscView,
  liveIntegration,
  REQUESTED_SCOPES,
  type GscView,
} from './gsc-model';
import {
  connectionsQuery,
  DISCONNECT_GOOGLE,
  integrationsQuery,
  refreshGsc,
  SWITCH_OFF_PROPERTY,
  type GscScope,
} from './gsc-queries';
import { PropertyChooser } from './property-chooser';
import { SyncSection } from './sync-section';
import { useAuthorize } from './use-authorize';
import { PAGE_CLASS, PageHeader } from '@/components/app/shell/page-header';
import { TabNav, type TabNavItem } from '@/components/app/shell/tab-nav';
import { Banner } from '@/components/app/status/banner';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Menu, type MenuItemDef } from '@/components/ui/menu';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import { useErrorId } from '@/lib/api/use-error-id';
import { canManageIntegrations, useMembership } from '@/lib/permissions';
import { useFreshSession } from '@/lib/session/fresh-session';
import { integrationsPath } from '@/lib/routes/paths';

export interface GscScreenProps extends GscScope {
  workspaceSlug: string;
  projectSlug: string;
  /** The project's time zone, where the connection's date is written. */
  timeZone: string;
}

type Confirming = 'disconnect' | 'change' | null;
/** The other sources of Integrations: listed so the person sees what the page will offer, none has a page yet. */
const OTHER_SOURCES = ['bing', 'ga4', 'cloudflare', 'imports'] as const;

/**
 * Integrations > Google Search Console (T5, 24-page-templates.md section 9.12; docs/18 sections 4.1, 4.8 and
 * 14). One page for every state of the connection: not connected, back from Google with a connection to
 * choose a property for, connected, Google refusing the saved sign-in, and a failed return (`?error=`).
 * Connecting, choosing and disconnecting need `integrations:manage` for every project; anyone who can read
 * the project sees the state. Nothing here shows numbers the API does not have: there is no sync yet.
 */
export function GscScreen({
  workspaceId,
  workspaceSlug,
  projectId,
  projectSlug,
  timeZone,
}: GscScreenProps): ReactElement {
  const scope: GscScope = { workspaceId, projectId };
  const t = useTranslations('integrations');
  const common = useTranslations('common');
  const membership = useMembership();
  const canManage = canManageIntegrations(membership);
  const queryClient = useQueryClient();
  const integrations = useQuery(integrationsQuery(scope));
  // Connections are the workspace's credentials: only those who manage them may list them
  const connections = useQuery({ ...connectionsQuery(workspaceId), enabled: canManage });
  const [returnedId, setReturnedId] = useQueryState('connection_id', parseAsString.withOptions({ history: 'replace' }));
  const [errorCode, setErrorCode] = useQueryState('error', parseAsString.withOptions({ history: 'replace' }));
  const authorize = useAuthorize(scope);
  const withFresh = useFreshSession();
  const { mutationFn: disconnectFn } = DISCONNECT_GOOGLE;
  const { mutationFn: switchOffFn } = SWITCH_OFF_PROPERTY;
  if (disconnectFn === undefined || switchOffFn === undefined) throw new Error('apiMutation gave no mutationFn');
  const disconnect = useMutation({ ...DISCONNECT_GOOGLE, mutationFn: withFresh(disconnectFn) });
  const switchOff = useMutation({ ...SWITCH_OFF_PROPERTY, mutationFn: withFresh(switchOffFn) });
  const [confirming, setConfirming] = useState<Confirming>(null);
  // What the open dialog is about, kept from the moment it opened: the change it asks for removes the property
  // and the connection from the page, and the dialog is still fading out when they are gone
  const [subject, setSubject] = useState<{ property: string; projects: number }>({ property: '', projects: 1 });
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const loadError = integrations.error ?? connections.error;
  const errorId = useErrorId(loadError);

  const tabs: TabNavItem[] = [
    { href: integrationsPath(workspaceSlug, projectSlug), label: t('tabs.gsc'), current: true },
    ...OTHER_SOURCES.map((source): TabNavItem => ({
      href: integrationsPath(workspaceSlug, projectSlug),
      label: t(`tabs.${source}`),
      current: false,
      unavailable: t('tabs.unavailable'),
    })),
  ];
  const tabNav = <TabNav label={t('tabs.label')} items={tabs} />;

  const header = (meta: string | undefined, actions?: ReactNode): ReactElement => (
    <PageHeader title={t('title')} meta={meta} actions={actions} tabs={tabNav} />
  );

  if (integrations.isPending || (canManage && connections.isPending)) {
    return (
      <div className={PAGE_CLASS} aria-busy="true">
        {header(undefined)}
        <span className="sr-only" role="status">
          {common('loading')}
        </span>
        <Skeleton shape="block" height="chart-140" />
        <Skeleton shape="block" height="chart-140" />
      </div>
    );
  }

  if (integrations.isError && isApiProblem(integrations.error, 'forbidden')) {
    return (
      <div className={PAGE_CLASS}>
        {header(undefined)}
        <Banner tone="info" placement="region" message={t('forbidden')} />
      </div>
    );
  }

  if (integrations.isError || connections.isError) {
    return (
      <div className={PAGE_CLASS}>
        {header(undefined)}
        <InlineError
          title={integrations.isError ? t('loadFailed') : t('connectionLoadFailed')}
          reason={t('loadFailedReason')}
          errorId={errorId}
          onRetry={() => void Promise.all([integrations.refetch(), canManage ? connections.refetch() : null])}
          retrying={integrations.isFetching || connections.isFetching}
          retryLabel={common('retry')}
        />
      </div>
    );
  }

  const view = gscView({
    integration: liveIntegration(integrations.data.data),
    connections: canManage ? (connections.data?.data ?? []) : null,
    returnedId,
  });
  const account = accountOf(view);
  const accountName = account ?? t('accountUnknown');
  const connection = view.kind === 'not-connected' ? null : view.connection;
  const property =
    view.kind === 'connected' || view.kind === 'reauth' ? (view.integration?.external_property ?? null) : null;

  const meta = ((): string => {
    switch (view.kind) {
      case 'not-connected':
        return t('meta.notConnected');
      case 'choose':
        return t('meta.chooseProperty', { account: accountName });
      case 'reauth':
        return t('meta.reauth', { account: accountName });
      case 'connected':
        return displayStatus(view) === 'error'
          ? t('meta.problem', { account: accountName })
          : t('meta.connected', { account: accountName, property: view.integration.external_property });
    }
  })();

  const clearReturn = (): void => {
    void setReturnedId(null);
  };

  const closeConfirm = (open: boolean): void => {
    if (!open) {
      setConfirming(null);
      setConfirmError(null);
    }
  };

  const confirmDisconnect = async (): Promise<void> => {
    if (connection === null) return;
    setConfirmError(null);
    try {
      await disconnect.mutateAsync({
        params: { path: { workspace_id: workspaceId, connection_id: connection.connection_id } },
      });
    } catch (error) {
      // Gone already: the page only needs to read again
      if (!isApiProblem(error, 'not_found')) {
        // Cancelling the sign-in check is not a failure to explain
        if (!isApiProblem(error, 'fresh_session_required')) setConfirmError(t('disconnect.failed'));
        throw error;
      }
    }
    toast({ type: 'success', title: t('disconnect.done'), description: t('disconnect.doneDetail') });
    clearReturn();
    await refreshGsc(queryClient, scope);
  };

  const confirmChange = async (): Promise<void> => {
    if (view.kind !== 'connected' && view.kind !== 'reauth') return;
    const { integration } = view;
    if (integration === null) return;
    setConfirmError(null);
    try {
      await switchOff.mutateAsync({
        params: {
          path: { workspace_id: workspaceId, project_id: projectId, integration_id: integration.integration_id },
        },
      });
    } catch (error) {
      if (!isApiProblem(error, 'not_found')) {
        if (!isApiProblem(error, 'fresh_session_required')) setConfirmError(t('change.failed'));
        throw error;
      }
    }
    toast({ type: 'success', title: t('change.done') });
    await refreshGsc(queryClient, scope);
  };

  const menuItems: MenuItemDef[] = [
    ...(view.kind === 'connected'
      ? [{ id: 'reconnect', label: t('actions.reconnectItem'), onSelect: authorize.connect } satisfies MenuItemDef]
      : []),
    ...(connection === null
      ? []
      : [
          {
            id: 'disconnect',
            label: t('actions.disconnect'),
            tone: 'destructive',
            onSelect: () => {
              setSubject({ property: property ?? '', projects: connection.integration_count });
              setConfirming('disconnect');
            },
          } satisfies MenuItemDef,
        ]),
  ];
  const actions = canManage ? (
    <>
      {view.kind === 'reauth' ? (
        <Button variant="primary" loading={authorize.pending} onClick={authorize.connect}>
          {t('actions.reconnect')}
        </Button>
      ) : null}
      {menuItems.length === 0 ? null : (
        <Menu
          align="end"
          trigger={<IconButton icon={MoreHorizontal} variant="secondary" size="icon" label={t('actions.more')} />}
          items={menuItems}
        />
      )}
    </>
  ) : undefined;

  return (
    <div className={PAGE_CLASS}>
      {header(meta, actions)}
      {errorCode === null ? null : (
        <Banner
          tone="negative"
          placement="region"
          live
          lead={t('errors.lead')}
          message={t(`errors.${connectErrorKey(errorCode)}`)}
          actions={
            <>
              {canManage && canRetryConnect(errorCode) ? (
                <Button size="sm" loading={authorize.pending} onClick={authorize.connect}>
                  {t('errors.connectAgain')}
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => void setErrorCode(null)}>
                {t('errors.dismiss')}
              </Button>
            </>
          }
        />
      )}
      {authorize.error === null ? null : <Banner tone="negative" placement="region" live message={authorize.error} />}
      {canManage ? null : <Banner tone="info" placement="region" lead={t('readOnlyLead')} message={t('readOnly')} />}
      {view.kind === 'reauth' ? (
        <Banner
          tone="warning"
          placement="region"
          lead={t('reauth.lead')}
          message={t('reauth.message', { account: accountName })}
        />
      ) : null}
      {view.kind === 'not-connected' ? (
        <>
          <EmptyState
            icon={Plug}
            headingLevel={2}
            title={t('empty.title')}
            reason={canManage ? t('empty.reason') : t('empty.reasonReadOnly')}
            details={canManage ? <p className="type-meta">{t('empty.note')}</p> : undefined}
            primaryAction={
              canManage ? (
                <Button variant="primary" loading={authorize.pending} onClick={authorize.connect}>
                  {t('empty.connect')}
                </Button>
              ) : undefined
            }
          />
          <AccessPanel scopes={REQUESTED_SCOPES} />
        </>
      ) : (
        <ConnectedBody
          view={view}
          scope={scope}
          account={account}
          property={property}
          timeZone={timeZone}
          canManage={canManage}
          onChange={() => {
            setSubject({ property: property ?? '', projects: connection?.integration_count ?? 1 });
            setConfirming('change');
          }}
          onChosen={clearReturn}
          onReconnect={authorize.connect}
        />
      )}
      <ConfirmDialog
        open={confirming === 'disconnect'}
        onOpenChange={closeConfirm}
        title={t('disconnect.title')}
        description={
          subject.projects > 1
            ? t('disconnect.descriptionShared', { count: subject.projects })
            : t('disconnect.description')
        }
        confirmLabel={t('disconnect.confirm')}
        cancelLabel={common('cancel')}
        onConfirm={confirmDisconnect}
        error={confirmError}
      />
      <ConfirmDialog
        open={confirming === 'change'}
        onOpenChange={closeConfirm}
        title={t('change.title')}
        description={t('change.description', { property: subject.property })}
        confirmLabel={t('change.confirm')}
        cancelLabel={common('cancel')}
        onConfirm={confirmChange}
        error={confirmError}
        tone="neutral"
      />
    </div>
  );
}

interface ConnectedBodyProps {
  view: Exclude<GscView, { kind: 'not-connected' }>;
  scope: GscScope;
  account: string | null;
  property: string | null;
  timeZone: string;
  canManage: boolean;
  onChange: () => void;
  onChosen: () => void;
  onReconnect: () => void;
}

/** Everything under the header once a Google account is connected: its facts, the picker or the sync, and the access. */
function ConnectedBody({
  view,
  scope,
  account,
  property,
  timeZone,
  canManage,
  onChange,
  onChosen,
  onReconnect,
}: ConnectedBodyProps): ReactElement {
  const status = view.kind === 'choose' ? view.connection.status : displayStatus(view);
  return (
    <>
      <ConnectionPanel
        status={status}
        account={account}
        connection={view.connection}
        property={property}
        timeZone={timeZone}
        onChangeProperty={canManage && view.kind === 'connected' ? onChange : undefined}
      />
      {view.kind === 'choose' ? (
        <PropertyChooser
          {...scope}
          connection={view.connection}
          account={account}
          onChosen={onChosen}
          onReconnect={onReconnect}
        />
      ) : null}
      <AccessPanel scopes={view.connection?.scopes ?? REQUESTED_SCOPES} />
      <SyncSection propertyChosen={property !== null} />
    </>
  );
}
