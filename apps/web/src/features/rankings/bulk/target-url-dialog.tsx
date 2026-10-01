'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type ReactElement, type RefObject } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { BulkDialog } from './bulk-dialog';
import { failureText } from './bulk-failure';
import { FormField } from '@/components/app/forms/form-field';
import { useSubmitOnce } from '@/components/app/forms/use-form-helpers';
import { Input } from '@/components/ui/input';
import { isWebUrl, MAX_URL_LENGTH } from '@/lib/urls/web-url';

export interface TargetUrlDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  countText: string;
  /** Sets the target URL, or clears it with `null`; a rejection's message is shown in the dialog. */
  onApply: (url: string | null) => Promise<void>;
  finalFocus: RefObject<HTMLElement | null>;
}

/**
 * Set target URL for the chosen keywords: the page each should rank with, or none. A new one starts a
 * configuration version of every keyword it changes, which the description says before it is sent.
 */
export function TargetUrlDialog({
  open,
  onOpenChange,
  countText,
  onApply,
  finalFocus,
}: TargetUrlDialogProps): ReactElement {
  const t = useTranslations('rankings.bulk.targetDialog');
  const bulk = useTranslations('rankings.bulk');
  const tracking = useTranslations('rankings.inspector.tracking');
  const [alert, setAlert] = useState<string | null>(null);
  const schema = useMemo(
    () =>
      z.object({
        url: z
          .string()
          .trim()
          .max(MAX_URL_LENGTH, { error: tracking('targetUrlTooLong', { max: MAX_URL_LENGTH }) })
          .refine((url) => url === '' || isWebUrl(url), { error: tracking('targetUrlInvalid') }),
      }),
    [tracking],
  );
  const form = useForm<{ url: string }>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: { url: '' },
  });
  const close = (): void => {
    form.reset({ url: '' });
    setAlert(null);
    onOpenChange(false);
  };
  const submit = useSubmitOnce(
    form.handleSubmit(async ({ url }) => {
      setAlert(null);
      try {
        await onApply(url.trim() === '' ? null : url.trim());
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
      description={t('description')}
      submitLabel={t('submit', { count: countText })}
      pending={form.formState.isSubmitting}
      alert={alert}
      dirty={form.formState.isDirty}
      onSubmit={submit}
      finalFocus={finalFocus}
    >
      <FormField
        control={form.control}
        name="url"
        label={t('url')}
        optional
        description={t('hint')}
        render={(field) => (
          <Input
            {...field.controlProps}
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={field.value}
            onValueChange={field.onChange}
          />
        )}
      />
    </BulkDialog>
  );
}
