'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState, type ReactElement } from 'react';

import { reasonOf } from '@/lib/internal-links/problem-reason';
import {
  ALERT_DEFAULTS,
  AlertFields,
  alertPatch,
  checkThreshold,
  draftOf,
  type AlertDraft,
} from '@/components/app/alert-rules/alert-settings';
import { InlineError } from '@/components/app/status/inline-error';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { FormAlert } from '@/components/ui/form-alert';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { updateSettingsMutation } from '@/lib/internal-links/mutations';
import { internalLinksKeys, linkSettingsQuery } from '@/lib/internal-links/queries';
import type { LinksScope } from '@/lib/internal-links/types';

export interface AlertRulesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: LinksScope;
  /** How many tiers the workspace has; `null` until they are read. */
  tierCount: number | null;
  canEdit: boolean;
}

/**
 * Alert rules (spec 7.10), opened from the alert on the Changes tab. It saves on its own: only the members the person
 * changed go in `PATCH settings`, the reason of a refusal shows in the dialog, and a changed draft is not dropped
 * without asking. A member who may not change the project reads the values.
 */
export function AlertRulesDialog({
  open,
  onOpenChange,
  scope,
  tierCount,
  canEdit,
}: AlertRulesDialogProps): ReactElement {
  const t = useTranslations('internalLinks.alerts');
  const common = useTranslations('common');
  const queryClient = useQueryClient();
  const settings = useQuery({ ...linkSettingsQuery(scope), enabled: open });
  const update = useMutation(updateSettingsMutation);
  const saved =
    settings.data?.data.internal_links?.alerts ?? (settings.data === undefined ? undefined : ALERT_DEFAULTS);
  const [edits, setEdits] = useState<Partial<AlertDraft>>({});
  const [thresholdError, setThresholdError] = useState<'range' | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const draft: AlertDraft | null = saved === undefined ? null : { ...draftOf(saved), ...edits };
  const patch = saved === undefined || draft === null ? {} : alertPatch(saved, draft);
  const dirty =
    Object.keys(patch).length > 0 ||
    (edits.threshold !== undefined && saved !== undefined && edits.threshold !== String(saved.threshold));

  const close = (next: boolean): void => {
    if (!next && update.isPending) return;
    if (!next) {
      setEdits({});
      setThresholdError(null);
      setFailure(null);
    }
    onOpenChange(next);
  };

  const save = (): void => {
    if (saved === undefined || draft === null || update.isPending) return;
    if (checkThreshold(draft.threshold) !== null) {
      setThresholdError('range');
      return;
    }
    if (Object.keys(patch).length === 0) return;
    setThresholdError(null);
    setFailure(null);
    update.mutate(
      {
        params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId } },
        body: { internal_links: { alerts: patch } },
      },
      {
        onSuccess: (answer) => {
          // The crawl settings screen reads the same document: one write feeds both
          queryClient.setQueryData(linkSettingsQuery(scope).queryKey, answer);
          void queryClient.invalidateQueries({ queryKey: linkSettingsQuery(scope).queryKey });
          // The alert and its delivery line on the Changes tab come from the changes summary
          for (const queryKey of internalLinksKeys(scope)) void queryClient.invalidateQueries({ queryKey });
          toast({ type: 'success', title: t('saved'), description: t('savedText') });
          close(false);
        },
        onError: (error) => setFailure(reasonOf(error) || t('saveFailed')),
      },
    );
  };

  let body: ReactElement;
  if (settings.isError && saved === undefined) {
    body = (
      <InlineError
        title={t('loadFailed')}
        reason={t('loadFailedReason')}
        errorId={null}
        onRetry={() => void settings.refetch()}
        retrying={settings.isFetching}
        retryLabel={common('retry')}
      />
    );
  } else if (saved === undefined || draft === null) {
    body = (
      <div className="flex flex-col gap-2" role="status" aria-label={t('loading')}>
        <Skeleton shape="block" height="row" />
        <Skeleton shape="block" height="row" />
      </div>
    );
  } else {
    body = (
      <AlertFields
        draft={draft}
        saved={saved}
        tierCount={tierCount}
        canEdit={canEdit}
        busy={update.isPending}
        thresholdError={thresholdError}
        onChange={(next) => {
          setEdits((current) => ({ ...current, ...next }));
          if (next.threshold !== undefined) setThresholdError(null);
          setFailure(null);
        }}
      />
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      size="md"
      dirty={dirty}
      discard={{
        title: t('discardTitle'),
        description: t('discardText'),
        keepEditingLabel: t('keepEditing'),
        discardLabel: t('discard'),
      }}
    >
      <DialogHeader
        title={t('title')}
        description={canEdit ? t('description') : t('readOnly')}
        closeLabel={common('close')}
      />
      <DialogBody>
        {failure === null ? null : <FormAlert message={failure} />}
        {body}
      </DialogBody>
      <DialogFooter
        primary={
          canEdit ? (
            <Button
              variant="primary"
              loading={update.isPending}
              disabled={!dirty || saved === undefined}
              onClick={save}
            >
              {t('save')}
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => close(false)}>
              {common('close')}
            </Button>
          )
        }
        secondary={
          canEdit ? (
            <DialogClose>
              <Button type="button" variant="secondary" disabled={update.isPending}>
                {common('cancel')}
              </Button>
            </DialogClose>
          ) : undefined
        }
      />
    </Dialog>
  );
}
