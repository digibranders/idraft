'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { alertMessage, weakPasswordMessage } from './problems';
import { MIN_PASSWORD_LENGTH } from './rules';
import { useFormAlert } from './use-alert';
import { FormField } from '@/components/app/forms/form-field';
import { Button } from '@/components/ui/button';
import { FormAlert } from '@/components/ui/form-alert';
import { PasswordInput } from '@/components/ui/password-input';
import { isApiProblem } from '@/lib/api/problem';

interface NewPasswordValues {
  password: string;
}

/**
 * The new password of a reset link. The length is checked on leaving the field; what else the API refuses
 * (a breached password, one that contains the email address) comes back as `weak_password` on the field.
 * `invalid_token` is the caller's to show, because it replaces the whole panel.
 */
export function NewPasswordForm({
  busy,
  onSubmit,
  onInvalidToken,
}: {
  /** A request is in flight, or the next page is loading. */
  busy: boolean;
  onSubmit: (password: string) => Promise<void>;
  onInvalidToken: () => void;
}): ReactNode {
  const t = useTranslations('auth');
  const { alert, setAlert, alertRef } = useFormAlert();
  const schema = useMemo(
    () =>
      z.object({
        password: z
          .string()
          .min(1, { error: t('validation.passwordRequired') })
          .min(MIN_PASSWORD_LENGTH, { error: t('validation.passwordTooShort', { min: MIN_PASSWORD_LENGTH }) }),
      }),
    [t],
  );
  const form = useForm<NewPasswordValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: { password: '' },
  });
  useEffect(() => form.setFocus('password'), [form]);
  const submit = form.handleSubmit(async ({ password }) => {
    if (busy) return;
    setAlert(null);
    try {
      await onSubmit(password);
    } catch (error) {
      if (isApiProblem(error, 'invalid_token')) {
        onInvalidToken();
        return;
      }
      const weak = weakPasswordMessage(error, t);
      if (weak !== null) {
        form.setError('password', { type: 'server', message: weak }, { shouldFocus: true });
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
        name="password"
        label={t('fields.newPassword')}
        render={(field) => (
          <PasswordInput
            {...field.controlProps}
            size="lg"
            autoComplete="new-password"
            showLabel={t('fields.showPassword')}
            hideLabel={t('fields.hidePassword')}
            value={field.value}
            onValueChange={field.onChange}
          />
        )}
      />
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
        {t('resetConfirm.submit')}
      </Button>
    </form>
  );
}
