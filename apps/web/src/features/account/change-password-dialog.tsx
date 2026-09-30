'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { FormField } from '@/components/app/forms/form-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { FormAlert } from '@/components/ui/form-alert';
import { PasswordInput } from '@/components/ui/password-input';
import { toast } from '@/components/ui/toast';
import { isApiProblem, retryMinutes } from '@/lib/api/problem';
import { apiMutation, apiQuery } from '@/lib/api/query';
import { MIN_PASSWORD_LENGTH, weakPasswordKey } from '@/lib/auth/password';
import { useFreshSession } from '@/lib/session/fresh-session';

const CHANGE = apiMutation('post', '/api/v1/auth/password/change');
/** The sessions list, which the change empties of every other session. */
const SESSIONS = apiQuery('/api/v1/auth/sessions');

interface PasswordValues {
  current: string;
  next: string;
  confirm: string;
}

/**
 * "Change password" (11-navigation.md section 5): the current password, a new one of at least 12
 * characters and its confirmation. It needs a fresh session, so it may ask "Confirm it is you" first. The
 * API refuses a wrong current password with `invalid_credentials` and a weak new one with `weak_password`;
 * both go on their fields. Saving signs the person out everywhere else, and the toast says so.
 */
export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactNode {
  const t = useTranslations('account.security.dialog');
  const discard = useTranslations('account.discard');
  const auth = useTranslations('auth');
  const common = useTranslations('common');
  const queryClient = useQueryClient();
  const withFresh = useFreshSession();
  const { mutationFn } = CHANGE;
  if (mutationFn === undefined) throw new Error('apiMutation gave no mutationFn');
  const change = useMutation({ ...CHANGE, mutationFn: withFresh(mutationFn) });
  const [alert, setAlert] = useState<string | null>(null);
  const schema = useMemo(
    () =>
      z
        .object({
          current: z.string().min(1, { error: t('currentRequired') }),
          next: z
            .string()
            .min(1, { error: auth('validation.passwordRequired') })
            .min(MIN_PASSWORD_LENGTH, { error: auth('validation.passwordTooShort', { min: MIN_PASSWORD_LENGTH }) }),
          confirm: z.string(),
        })
        .refine((values) => values.confirm === values.next, { path: ['confirm'], error: t('mismatch') }),
    [t, auth],
  );
  const form = useForm<PasswordValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: { current: '', next: '', confirm: '' },
  });
  const close = (): void => {
    form.reset();
    setAlert(null);
    onOpenChange(false);
  };

  const submit = form.handleSubmit(async ({ current, next }) => {
    if (change.isPending) return;
    setAlert(null);
    try {
      await change.mutateAsync({ body: { current_password: current, new_password: next } });
      void queryClient.invalidateQueries({ queryKey: SESSIONS.queryKey });
      toast({ type: 'success', title: t('done') });
      close();
    } catch (error) {
      // The person cancelled "Confirm it is you": nothing was sent, the dialog stays as it was
      if (isApiProblem(error, 'fresh_session_required')) return;
      if (isApiProblem(error, 'invalid_credentials')) {
        form.setError('current', { type: 'server', message: t('wrongCurrent') }, { shouldFocus: true });
        return;
      }
      const weak = weakPasswordKey(error);
      if (weak !== null) {
        form.setError(
          'next',
          { type: 'server', message: auth(weak, { min: MIN_PASSWORD_LENGTH }) },
          { shouldFocus: true },
        );
        return;
      }
      if (isApiProblem(error, 'rate_limited')) {
        setAlert(auth('problems.rateLimited', { minutes: retryMinutes(error) }));
        return;
      }
      if (isApiProblem(error, 'service_unavailable')) {
        setAlert(auth('problems.serviceUnavailable'));
        return;
      }
      setAlert(t('failed'));
    }
  });

  const passwordField = (
    name: keyof PasswordValues,
    label: string,
    autoComplete: 'current-password' | 'new-password',
  ): ReactNode => (
    <FormField
      control={form.control}
      name={name}
      label={label}
      {...(name === 'next' ? { description: auth('validation.passwordTooShort', { min: MIN_PASSWORD_LENGTH }) } : {})}
      render={(field) => (
        <PasswordInput
          {...field.controlProps}
          autoComplete={autoComplete}
          showLabel={auth('fields.showPassword')}
          hideLabel={auth('fields.hidePassword')}
          value={field.value}
          onValueChange={field.onChange}
        />
      )}
    />
  );

  return (
    <Dialog
      open={open}
      // While the change is on its way the dialog stays: its answer belongs to this form, not a new one
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else if (!change.isPending) close();
      }}
      size="sm"
      dirty={form.formState.isDirty}
      discard={{
        title: discard('title'),
        description: t('discardDescription'),
        keepEditingLabel: discard('keepEditing'),
        discardLabel: discard('discard'),
      }}
    >
      <form noValidate className="contents" onSubmit={(event) => void submit(event)}>
        <DialogHeader title={t('title')} description={t('description')} closeLabel={common('close')} />
        <DialogBody>
          {alert === null ? null : <FormAlert message={alert} />}
          {passwordField('current', t('current'), 'current-password')}
          {passwordField('next', t('new'), 'new-password')}
          {passwordField('confirm', t('confirm'), 'new-password')}
        </DialogBody>
        <DialogFooter
          secondary={
            <DialogClose>
              <Button type="button" variant="secondary">
                {common('cancel')}
              </Button>
            </DialogClose>
          }
          primary={
            <Button type="submit" variant="primary" loading={change.isPending}>
              {t('submit')}
            </Button>
          }
        />
      </form>
    </Dialog>
  );
}
