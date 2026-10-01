'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactElement, type RefObject } from 'react';
import { useForm } from 'react-hook-form';

import { BulkDialog } from './bulk-dialog';
import { failureText } from './bulk-failure';
import { PRIORITIES } from '../keyword-values';
import { FormField } from '@/components/app/forms/form-field';
import { useSubmitOnce } from '@/components/app/forms/use-form-helpers';
import { Select } from '@/components/ui/select';

/** The middle priority, which a dialog starts on. */
const START = '3';

export interface PriorityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "12 keywords". */
  countText: string;
  /** Sets the priority; a rejection's message is shown in the dialog. */
  onApply: (priority: number) => Promise<void>;
  finalFocus: RefObject<HTMLElement | null>;
}

/** Set priority for the chosen keywords: one of 1 (highest) to 5 (lowest). */
export function PriorityDialog({
  open,
  onOpenChange,
  countText,
  onApply,
  finalFocus,
}: PriorityDialogProps): ReactElement {
  const t = useTranslations('rankings.bulk.priorityDialog');
  const tracking = useTranslations('rankings.inspector.tracking');
  const bulk = useTranslations('rankings.bulk');
  const [alert, setAlert] = useState<string | null>(null);
  const form = useForm<{ priority: string }>({ defaultValues: { priority: START } });
  const options = PRIORITIES.map((priority) => ({
    value: String(priority),
    label: tracking('priorityValue', { priority: String(priority) }),
  }));
  const close = (): void => {
    form.reset({ priority: START });
    setAlert(null);
    onOpenChange(false);
  };
  const submit = useSubmitOnce(
    form.handleSubmit(async ({ priority }) => {
      setAlert(null);
      try {
        await onApply(Number(priority));
        close();
      } catch (error) {
        setAlert(failureText(error, bulk('failed')));
      }
    }),
  );
  return (
    <BulkDialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title={t('title', { count: countText })}
      submitLabel={t('submit', { count: countText })}
      pending={form.formState.isSubmitting}
      alert={alert}
      dirty={form.formState.isDirty}
      onSubmit={submit}
      finalFocus={finalFocus}
    >
      <FormField
        control={form.control}
        name="priority"
        label={t('priority')}
        render={(field) => (
          <Select<string>
            {...field.controlProps}
            value={field.value}
            onValueChange={field.onChange}
            placeholder={t('priority')}
            options={options}
          />
        )}
      />
    </BulkDialog>
  );
}
