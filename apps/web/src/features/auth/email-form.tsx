'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { alertMessage, retryMinutes } from './problems';
import { useFormAlert } from './use-alert';
import { FormField } from '@/components/app/forms/form-field';
import { Button } from '@/components/ui/button';
import { FormAlert } from '@/components/ui/form-alert';
import { Input } from '@/components/ui/input';
import { isApiProblem } from '@/lib/api/problem';
import { applyServerErrors } from '@/lib/forms';

interface EmailValues {
  email: string;
}
const FIELDS = ['email'] as const;

/**
 * One email field and a button: asking for a password-reset link or a new verification link. The API gives
 * the same answer whether or not the address has an account, so the only problems are an address it does
 * not accept, the hourly limit of emails and an outage.
 */
export function EmailForm({
  submitLabel,
  busy,
  onSubmit,
}: {
  submitLabel: string;
  /** A request is in flight, or its answer is being shown. */
  busy: boolean;
  onSubmit: (email: string) => Promise<void>;
}): ReactNode {
  const t = useTranslations('auth');
  const { alert, setAlert, alertRef } = useFormAlert();
  const schema = useMemo(
    () =>
      z.object({
        email: z
          .string()
          .trim()
          .min(1, { error: t('validation.emailRequired') })
          .pipe(z.email({ error: t('validation.emailInvalid') })),
      }),
    [t],
  );
  const form = useForm<EmailValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: { email: '' },
  });
  useEffect(() => form.setFocus('email'), [form]);
  const submit = form.handleSubmit(async ({ email }) => {
    if (busy) return;
    setAlert(null);
    try {
      await onSubmit(email);
    } catch (error) {
      if (isApiProblem(error, 'validation_failed')) {
        const rest = applyServerErrors(form, error.errors, {
          fields: FIELDS,
          messages: { value_error: t('validation.emailInvalid') },
        });
        if (rest.length === 0) return;
      }
      // The limit here is of emails per address per hour, not of attempts
      if (isApiProblem(error, 'rate_limited')) {
        setAlert(t('problems.tooManyEmails', { minutes: retryMinutes(error) }));
        return;
      }
      setAlert(alertMessage(error, t));
    }
  });
  return (
    <form noValidate className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
      {alert === null ? null : <FormAlert ref={alertRef} tabIndex={-1} live={false} message={alert} />}
      <FormField
        control={form.control}
        name="email"
        label={t('fields.email')}
        render={(field) => (
          <Input
            {...field.controlProps}
            type="email"
            size="lg"
            autoComplete="email"
            value={field.value}
            onValueChange={field.onChange}
          />
        )}
      />
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
        {submitLabel}
      </Button>
    </form>
  );
}
