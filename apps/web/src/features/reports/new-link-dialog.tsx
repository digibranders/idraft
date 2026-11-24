'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { FormAlert } from '@/components/ui/form-alert';
import { ReadOnlyField, ReadOnlyList } from '@/components/ui/read-only-field';
import { Select } from '@/components/ui/select';
import { toast } from '@/components/ui/toast';
import { expiryDaysValues } from '@/lib/api/schema';
import { copyText } from '@/lib/dom/clipboard';
import { formatTableDate } from '@/lib/format';
import { reasonOf } from '@/lib/internal-links/problem-reason';
import { createReportShareMutation, refreshReports } from '@/lib/reports/queries';
import type { ReportExpiryDays, ReportsScope } from '@/lib/reports/types';

const DEFAULT_EXPIRY: ReportExpiryDays = 30;
const NEW_WINDOW = ['_blank', 'noopener'] as const;

/** The address the public page answers at; the token is the only secret in it. */
export const reportAddress = (token: string): string => `${window.location.origin}/public/reports/${token}`;

export interface NewLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: ReportsScope;
  timeZone: string;
}

/**
 * Makes a read-only link to the project's report and shows its address once, with a Copy button. The secret is
 * forgotten when the dialog opens again: it is never shown a second time.
 */
export function NewLinkDialog({ open, onOpenChange, scope, timeZone }: NewLinkDialogProps): ReactElement {
  const t = useTranslations('reports.newLink');
  const common = useTranslations('common');
  const queryClient = useQueryClient();
  const create = useMutation(createReportShareMutation);
  const [days, setDays] = useState<ReportExpiryDays>(DEFAULT_EXPIRY);
  const [made, setMade] = useState<{ address: string; expiresAt: string } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDays(DEFAULT_EXPIRY);
      setMade(null);
      setFailure(null);
    }
  }

  const make = (): void => {
    if (create.isPending) return;
    setFailure(null);
    create.mutate(
      {
        params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId } },
        body: { expires_in_days: days },
      },
      {
        onSuccess: (answer) => {
          setMade({ address: reportAddress(answer.data.token), expiresAt: answer.data.expires_at });
          void refreshReports(queryClient, scope);
        },
        onError: (error) => setFailure(reasonOf(error) || t('failedReason')),
      },
    );
  };

  const copy = (): void => {
    if (made === null) return;
    void copyText(made.address).then((copied) =>
      toast(copied ? { type: 'success', title: t('copied') } : { type: 'error', title: common('copy.failed') }),
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="md">
      <DialogHeader
        title={made === null ? t('title') : t('madeTitle')}
        description={made === null ? t('description') : t('madeDescription')}
        closeLabel={common('close')}
      />
      <DialogBody>
        {failure === null ? null : <FormAlert message={failure} />}
        {made === null ? (
          <Field width="medium">
            <FieldLabel>{t('expiryLabel')}</FieldLabel>
            <Select
              value={String(days)}
              onValueChange={(next) => setDays(expiryDaysValues.find((value) => String(value) === next) ?? days)}
              placeholder={t('expiryLabel')}
              options={expiryDaysValues.map((value) => ({
                value: String(value),
                label: t('expiryOption', { days: value }),
              }))}
            />
          </Field>
        ) : (
          <div className="flex flex-col gap-3" role="status">
            <ReadOnlyList>
              <ReadOnlyField
                label={t('addressLabel')}
                value={made.address}
                font="mono"
                reason={t('worksUntil', { date: formatTableDate(made.expiresAt, timeZone) })}
              />
            </ReadOnlyList>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" icon={Copy} onClick={copy}>
                {t('copy')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={ExternalLink}
                onClick={() => window.open(made.address, ...NEW_WINDOW)}
              >
                {t('open')}
              </Button>
            </div>
          </div>
        )}
      </DialogBody>
      <DialogFooter
        primary={
          made === null ? (
            <Button variant="primary" loading={create.isPending} onClick={make}>
              {t('make')}
            </Button>
          ) : (
            <DialogClose>
              <Button variant="primary">{t('done')}</Button>
            </DialogClose>
          )
        }
        secondary={
          made === null ? (
            <DialogClose>
              <Button variant="secondary">{common('cancel')}</Button>
            </DialogClose>
          ) : undefined
        }
      />
    </Dialog>
  );
}
