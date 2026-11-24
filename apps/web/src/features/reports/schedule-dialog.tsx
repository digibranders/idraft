'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState, type ReactElement } from 'react';

import { parseRecipients, type RecipientsProblem } from './recipients';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { FormAlert } from '@/components/ui/form-alert';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { reportScheduleFrequencyValues } from '@/lib/api/schema';
import { reasonOf } from '@/lib/internal-links/problem-reason';
import { createReportScheduleMutation, refreshReports, updateReportScheduleMutation } from '@/lib/reports/queries';
import {
  RECIPIENTS_MAX,
  type ReportSchedule,
  type ReportScheduleFrequency,
  type ReportsScope,
} from '@/lib/reports/types';

export interface ScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: ReportsScope;
  /** The schedule being changed; `null` makes a new one. */
  schedule: ReportSchedule | null;
}

function ScheduleForm({ onOpenChange, scope, schedule }: Omit<ScheduleDialogProps, 'open'>): ReactElement {
  const t = useTranslations('reports.schedule');
  const common = useTranslations('common');
  const queryClient = useQueryClient();
  const create = useMutation(createReportScheduleMutation);
  const update = useMutation(updateReportScheduleMutation);
  const [frequency, setFrequency] = useState<ReportScheduleFrequency>(schedule?.frequency ?? 'weekly');
  const [text, setText] = useState(schedule?.recipients.join('\n') ?? '');
  const [problem, setProblem] = useState<RecipientsProblem | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const pending = create.isPending || update.isPending;

  const problemText = (found: RecipientsProblem): string => {
    if (found.kind === 'empty') return t('recipientsEmpty');
    if (found.kind === 'tooMany') return t('recipientsTooMany', { max: RECIPIENTS_MAX });
    return t('recipientsInvalid', { address: found.address });
  };

  const save = (): void => {
    if (pending) return;
    const parsed = parseRecipients(text);
    setProblem(parsed.problem);
    setFailure(null);
    if (parsed.problem !== null) return;
    const done = (): void => {
      void refreshReports(queryClient, scope);
      toast({ type: 'success', title: t(schedule === null ? 'added' : 'saved') });
      onOpenChange(false);
    };
    const fail = (error: unknown): void => setFailure(reasonOf(error) || t('failedReason'));
    const path = { workspace_id: scope.workspaceId, project_id: scope.projectId };
    if (schedule === null) {
      create.mutate(
        { params: { path }, body: { frequency, recipients: parsed.addresses } },
        { onSuccess: done, onError: fail },
      );
    } else {
      update.mutate(
        {
          params: { path: { ...path, report_schedule_id: schedule.id } },
          body: { frequency, recipients: parsed.addresses },
        },
        { onSuccess: done, onError: fail },
      );
    }
  };

  return (
    <>
      <DialogHeader
        title={schedule === null ? t('addTitle') : t('editTitle')}
        description={t('description')}
        closeLabel={common('close')}
      />
      <DialogBody>
        {failure === null ? null : <FormAlert message={failure} />}
        <Field width="medium">
          <FieldLabel>{t('frequencyLabel')}</FieldLabel>
          <Select
            value={frequency}
            onValueChange={(next) =>
              setFrequency(reportScheduleFrequencyValues.find((value) => value === next) ?? frequency)
            }
            placeholder={t('frequencyLabel')}
            options={reportScheduleFrequencyValues.map((value) => ({ value, label: t(`frequency.${value}`) }))}
          />
        </Field>
        <Field invalid={problem !== null}>
          <FieldLabel>{t('recipientsLabel')}</FieldLabel>
          <Textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t('recipientsPlaceholder')}
          />
          <FieldDescription>{t('recipientsHint', { max: RECIPIENTS_MAX })}</FieldDescription>
          {problem === null ? null : <FieldError message={problemText(problem)} />}
        </Field>
      </DialogBody>
      <DialogFooter
        primary={
          <Button variant="primary" loading={pending} onClick={save}>
            {schedule === null ? t('add') : t('save')}
          </Button>
        }
        secondary={
          <DialogClose>
            <Button variant="secondary" disabled={pending}>
              {common('cancel')}
            </Button>
          </DialogClose>
        }
      />
    </>
  );
}

/** Adds or changes a scheduled report: how often, and up to ten recipients. A new visit starts from the schedule. */
export function ScheduleDialog({ open, onOpenChange, scope, schedule }: ScheduleDialogProps): ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="md">
      {/* Keyed by what is edited, so a second visit never shows the first one's draft */}
      <ScheduleForm key={schedule?.id ?? 'new'} onOpenChange={onOpenChange} scope={scope} schedule={schedule} />
    </Dialog>
  );
}
