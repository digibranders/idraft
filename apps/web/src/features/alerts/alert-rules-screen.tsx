'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellPlus, MoreHorizontal, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';

import { AlertRuleDialog } from './alert-rule-dialog';
import { positionsOf, RULE_TYPE_KEY } from './alert-model';
import { alertRulesQuery, DELETE_ALERT_RULE, refreshRules, UPDATE_ALERT_RULE, type AlertScope } from './alert-queries';
import { useAlertWords } from './alert-words';
import { RecentAlerts } from './recent-alerts';
import { useGroupChoices } from './use-group-choices';
import { Banner } from '@/components/app/status/banner';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Menu, type MenuItemDef } from '@/components/ui/menu';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import type { AlertRule } from '@/lib/api/types';
import { useErrorId } from '@/lib/api/use-error-id';
import { useCan } from '@/lib/permissions';

export interface AlertRulesScreenProps extends AlertScope {
  /** The project's time zone, which the times of the alerts are shown in. */
  timeZone: string;
  /** The project's brand name, for the sentences of the alerts. */
  brandName: string;
}

/**
 * Settings > Project settings > Alert rules: the project's rules with an on and off switch, the dialog that
 * adds and changes them, and the recent alerts below. A member with `alerts:write` changes rules and
 * acknowledges alerts; everyone else reads. Writes are pessimistic: the screen waits for the answer and reads
 * again.
 */
export function AlertRulesScreen({ workspaceId, projectId, timeZone, brandName }: AlertRulesScreenProps): ReactNode {
  const scope: AlertScope = { workspaceId, projectId };
  const t = useTranslations('alerts');
  const common = useTranslations('common');
  const canWrite = useCan('alerts:write');
  const queryClient = useQueryClient();
  const rules = useQuery(alertRulesQuery(scope));
  const errorId = useErrorId(rules.error);
  const words = useAlertWords(brandName);
  const choices = useGroupChoices(scope);
  const update = useMutation(UPDATE_ALERT_RULE);
  const remove = useMutation(DELETE_ALERT_RULE);
  const [editing, setEditing] = useState<AlertRule | 'new' | null>(null);
  const [deleting, setDeleting] = useState<AlertRule | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // The rule whose switch is being saved: it waits, and no second request starts
  const [busy, setBusy] = useState<string | null>(null);
  const rows = rules.data?.data ?? [];
  // A role without `data:read` cannot list the rules at all, which is not a failure to retry
  const forbidden = rules.isError && isApiProblem(rules.error, 'forbidden');
  const path = (rule: AlertRule): { workspace_id: string; project_id: string; alert_rule_id: string } => ({
    workspace_id: workspaceId,
    project_id: projectId,
    alert_rule_id: rule.id,
  });

  const toggle = async (rule: AlertRule, on: boolean): Promise<void> => {
    setBusy(rule.id);
    try {
      await update.mutateAsync({ params: { path: path(rule) }, body: { is_active: on } });
      toast({ type: 'success', title: t(on ? 'turnedOn' : 'turnedOff', { name: rule.name }) });
    } catch (error) {
      toast(
        isApiProblem(error, 'not_found')
          ? { type: 'info', title: t('gone', { name: rule.name }) }
          : { type: 'error', title: t('toggleFailed', { name: rule.name }) },
      );
    } finally {
      setBusy(null);
      void refreshRules(queryClient, scope);
    }
  };

  const confirmDelete = async (): Promise<void> => {
    if (deleting === null) return;
    setDeleteError(null);
    const { name } = deleting;
    try {
      await remove.mutateAsync({ params: { path: path(deleting) } });
    } catch (error) {
      if (isApiProblem(error, 'not_found')) {
        toast({ type: 'info', title: t('gone', { name }) });
        void refreshRules(queryClient, scope);
        return;
      }
      setDeleteError(t('deleteFailed'));
      throw error;
    }
    toast({ type: 'success', title: t('deleted', { name }) });
    void refreshRules(queryClient, scope);
  };

  const itemsFor = (rule: AlertRule): MenuItemDef[] => [
    { id: 'edit', label: t('menu.edit'), onSelect: () => setEditing(rule) },
    {
      id: 'delete',
      label: t('menu.delete'),
      tone: 'destructive',
      onSelect: () => setDeleting(rule),
    },
  ];

  /** The type of a rule in words; a rank rule adds how far a keyword must drop. */
  const typeText = (rule: AlertRule): string =>
    rule.rule_type === 'rank_drop'
      ? t('rankDropOf', { positions: positionsOf(rule) })
      : t(`types.${RULE_TYPE_KEY[rule.rule_type]}.label`);

  /** The groups and platforms a rule is narrowed to; nothing chosen means all of them. */
  const appliesTo = (rule: AlertRule): string => {
    const list = rule.rule_type === 'rank_drop' ? choices.keyword : choices.prompt;
    const groupIds = rule.scope.group_ids ?? [];
    const groups =
      groupIds.length === 0
        ? t('allGroups')
        : groupIds.map((id) => list.find((group) => group.id === id)?.label ?? t('removedGroup')).join(', ');
    if (rule.rule_type === 'rank_drop') return groups;
    const codes = rule.scope.engine_codes ?? [];
    const platforms =
      codes.length === 0 ? t('allPlatforms') : codes.map((code) => words.platformName(code) ?? code).join(', ');
    return t('appliesBoth', { groups, platforms });
  };

  const columns: PlainColumn<AlertRule>[] = [
    {
      id: 'rule',
      header: t('columns.rule'),
      wrap: true,
      cell: (rule) => (
        <span className="flex flex-col">
          <span className="text-foreground">{rule.name}</span>
          <span className="type-label">{typeText(rule)}</span>
        </span>
      ),
    },
    { id: 'applies', header: t('columns.appliesTo'), wrap: true, cell: appliesTo },
    {
      id: 'on',
      header: t('columns.on'),
      cell: (rule) => (
        <Switch
          checked={rule.is_active}
          aria-label={t('switchLabel', { name: rule.name })}
          disabled={!canWrite}
          busy={busy === rule.id}
          onCheckedChange={(on: boolean) => void toggle(rule, on)}
        />
      ),
    },
    ...(canWrite
      ? [
          {
            id: 'actions',
            header: t('columns.actions'),
            hideHeader: true,
            actions: true,
            cell: (rule: AlertRule) => (
              <Menu
                align="end"
                trigger={
                  <IconButton
                    icon={MoreHorizontal}
                    size="icon-sm"
                    variant="ghost"
                    label={t('actionsFor', { name: rule.name })}
                  />
                }
                items={itemsFor(rule)}
              />
            ),
          } satisfies PlainColumn<AlertRule>,
        ]
      : []),
  ];

  const newRule = (
    <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>
      {t('newRule')}
    </Button>
  );

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="alert-rules-title" className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="alert-rules-title" className="type-section-title">
              {t('title')}
            </h2>
            <p className="mt-1 type-meta">{t('description')}</p>
          </div>
          {canWrite && rows.length > 0 ? newRule : null}
        </div>
        {canWrite || forbidden ? null : (
          <Banner tone="info" placement="region" lead={t('readOnlyLead')} message={t('readOnly')} />
        )}
        {rules.isError ? (
          forbidden ? (
            <Banner tone="info" placement="region" message={t('forbidden')} />
          ) : (
            <InlineError
              title={t('loadFailed')}
              reason={t('loadFailedReason')}
              errorId={errorId}
              onRetry={() => void rules.refetch()}
              retrying={rules.isFetching}
              retryLabel={common('retry')}
            />
          )
        ) : !rules.isPending && rows.length === 0 ? (
          <EmptyState
            icon={BellPlus}
            headingLevel={3}
            title={t('emptyTitle')}
            reason={canWrite ? t('emptyReason') : t('emptyReasonReadOnly')}
            primaryAction={canWrite ? newRule : undefined}
          />
        ) : (
          <PlainTable<AlertRule>
            caption={t('tableLabel')}
            columns={columns}
            rows={rows}
            rowKey={(rule) => rule.id}
            status={rules.isPending ? 'loading' : 'ready'}
            errorState={null}
            emptyText={t('emptyTitle')}
            skeletonRows={3}
          />
        )}
      </section>
      {forbidden ? null : (
        <RecentAlerts scope={scope} rules={rows} timeZone={timeZone} canWrite={canWrite} brandName={brandName} />
      )}
      <AlertRuleDialog scope={scope} rule={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleting(null);
            setDeleteError(null);
          }
        }}
        title={t('deleteTitle', { name: deleting?.name ?? '' })}
        description={t('deleteDescription')}
        confirmLabel={t('deleteConfirm')}
        cancelLabel={common('cancel')}
        onConfirm={confirmDelete}
        error={deleteError}
      />
    </div>
  );
}
