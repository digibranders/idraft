'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactElement } from 'react';

import {
  ALERT_DEFAULTS,
  AlertFields,
  alertDirty,
  alertPatch,
  checkThreshold,
  draftOf,
  type AlertDraft,
} from '@/components/app/link-alert-rules/alert-settings';
import { InlineError } from '@/components/app/status/inline-error';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { FormAlert } from '@/components/ui/form-alert';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { updateSettingsMutation } from '@/lib/internal-links/mutations';
import { reasonOf } from '@/lib/internal-links/problem-reason';
import { internalLinksKeys, linkSettingsQuery } from '@/lib/internal-links/queries';
import type { LinksScope } from '@/lib/internal-links/types';

const FIRST_FIELD = '[role="switch"], input:not([type="hidden"]), [role="combobox"]';

export interface AlertRulesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: LinksScope;
  /** How many tiers the workspace has; `null` until they are read. */
  tierCount: number | null;
  /**
   * Where focus goes on close when the element that opened the dialog is gone (turning the alerts off removes the
   * alert that held the button). Without it focus stays where the dialog's primitive puts it.
   */
  fallbackFocus?: (() => HTMLElement | null) | undefined;
}

/**
 * Alert rules (spec 7.10), opened from the alert on the Changes tab; it is only mounted for a member who may change
 * the project. It saves on its own: Enter or Save sends only the members that changed, the reason of a refusal shows
 * in the dialog, and a changed draft is not dropped without asking.
 */
export function AlertRulesDialog({
  open,
  onOpenChange,
  scope,
  tierCount,
  fallbackFocus,
}: AlertRulesDialogProps): ReactElement {
  const t = useTranslations('internalLinks.alerts');
  const common = useTranslations('common');
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const thresholdRef = useRef<HTMLInputElement>(null);
  const [turnedOff, setTurnedOff] = useState(false);
  const settings = useQuery({ ...linkSettingsQuery(scope), enabled: open });
  const update = useMutation(updateSettingsMutation);
  const saved =
    settings.data?.data.internal_links?.alerts ?? (settings.data === undefined ? undefined : ALERT_DEFAULTS);
  const [edits, setEdits] = useState<Partial<AlertDraft>>({});
  const [thresholdError, setThresholdError] = useState<'range' | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  const [opener, setOpener] = useState<Element | null>(null);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      // A new visit starts from what is saved. Nothing is cleared on close, so the values do not flash back while
      // the dialog fades out.
      setEdits({});
      setThresholdError(null);
      setFailure(null);
      setOpener(document.activeElement);
      setTurnedOff(false);
    }
  }

  const draft: AlertDraft | null = saved === undefined ? null : { ...draftOf(saved), ...edits };
  const patch = saved === undefined || draft === null ? {} : alertPatch(saved, draft);
  const dirty = saved !== undefined && draft !== null && alertDirty(saved, draft);
  const loaded = saved !== undefined;

  // While the rules load the dialog shows a skeleton and focus rests on Close: move it to the first field after
  useEffect(() => {
    const form = formRef.current;
    if (!open || !loaded || form === null || form.contains(document.activeElement)) return;
    form.querySelector<HTMLElement>(FIRST_FIELD)?.focus();
  }, [open, loaded]);

  const close = (next: boolean): void => {
    if (!next && update.isPending) return;
    onOpenChange(next);
  };

  const save = (): void => {
    if (saved === undefined || draft === null || update.isPending) return;
    if (checkThreshold(draft.threshold) !== null) {
      setThresholdError('range');
      setFailure(t('thresholdSummary'));
      thresholdRef.current?.focus();
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
          // With the alerts off the summary drops the alert, and the button that opened this goes with it
          setTurnedOff(patch.enabled === false);
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
        canEdit
        busy={update.isPending}
        thresholdError={thresholdError}
        thresholdRef={thresholdRef}
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
      // The opener when it is still there, else the page's own landmark
      finalFocus={() => (!turnedOff && opener?.isConnected === true ? true : (fallbackFocus?.() ?? true))}
      discard={{
        title: t('discardTitle'),
        description: t('discardText'),
        keepEditingLabel: t('keepEditing'),
        discardLabel: t('discard'),
      }}
    >
      <DialogHeader title={t('title')} description={t('description')} closeLabel={common('close')} />
      {/* The form wraps the body and the footer so Enter in a field presses Save; it adds no box of its own */}
      <form
        ref={formRef}
        noValidate
        className="contents"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <DialogBody>
          {failure === null ? null : <FormAlert message={failure} live={thresholdError === null} />}
          {body}
        </DialogBody>
        <DialogFooter
          primary={
            <Button type="submit" variant="primary" loading={update.isPending} disabled={!dirty || saved === undefined}>
              {t('save')}
            </Button>
          }
          secondary={
            <DialogClose>
              <Button type="button" variant="secondary" disabled={update.isPending}>
                {common('cancel')}
              </Button>
            </DialogClose>
          }
        />
      </form>
    </Dialog>
  );
}
