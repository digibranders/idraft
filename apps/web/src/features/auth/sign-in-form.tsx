'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { INVITATION_PARAM, useAfterSignIn, withInvitation } from './invitation';
import type { SignInNotice } from './notices';
import { alertMessage } from './problems';
import { useFormAlert } from './use-alert';
import { FormField } from '@/components/app/forms/form-field';
import { AuthCard } from '@/components/app/shell/auth-card';
import { Button } from '@/components/ui/button';
import { FormAlert } from '@/components/ui/form-alert';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { TextLink } from '@/components/ui/text-link';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation } from '@/lib/api/query';
import { applyServerErrors } from '@/lib/forms';
import { hardNavigate } from '@/lib/navigation/hard-navigate';
import { useFragmentParam } from '@/lib/url/use-fragment-param';

interface SignInValues {
  email: string;
  password: string;
}
const FIELDS = ['email', 'password'] as const;

/** The second step of signing in, told where the person is going and which invitation they carry. */
const twoFactorUrl = (next: string | null, invitation: string | null | undefined): string =>
  withInvitation(next === null ? '/two-factor' : `/two-factor?next=${encodeURIComponent(next)}`, invitation);

/**
 * `/login` (24 section 11, T7): email and password, then the page the person was going to, or the second
 * factor. With an invitation token in the fragment (`#invitation=...`, from registering or from an account
 * that existed already), signing in also accepts the invitation. The browser sends the request itself: the
 * API counts failed attempts per client address, which a server in between would share (19 section 3.1).
 */
export function SignInForm({ next, notice }: { next: string | null; notice: SignInNotice | null }): ReactNode {
  const t = useTranslations('auth');
  const app = useTranslations('app');
  const invitation = useFragmentParam(INVITATION_PARAM);
  const { alert, setAlert, alertRef } = useFormAlert();
  // The notice is about the step before; once the person submits, it has been read
  const [submitted, setSubmitted] = useState(false);
  const schema = useMemo(
    () =>
      z.object({
        email: z
          .string()
          .trim()
          .min(1, { error: t('validation.emailRequired') })
          .pipe(z.email({ error: t('validation.emailInvalid') })),
        password: z.string().min(1, { error: t('validation.passwordRequired') }),
      }),
    [t],
  );
  const form = useForm<SignInValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: { email: '', password: '' },
  });
  const signIn = useMutation(apiMutation('post', '/api/v1/auth/sign-in'));
  const afterSignIn = useAfterSignIn(next, invitation);
  // Once signed in, the next page is loading: the button stays busy so the form cannot be sent again
  const [leaving, setLeaving] = useState(false);
  const busy = signIn.isPending || leaving;
  // The page has one task, so its first field takes focus (24 section 11)
  useEffect(() => form.setFocus('email'), [form]);

  const submit = form.handleSubmit(async (values) => {
    if (busy) return;
    setAlert(null);
    try {
      const result = await signIn.mutateAsync({ body: values });
      setLeaving(true);
      // The second factor is a new page load too: the pending session is a change of session
      if (result.status === 'totp_required') hardNavigate(twoFactorUrl(next, invitation));
      else await afterSignIn();
    } catch (error) {
      if (isApiProblem(error, 'validation_failed')) {
        const rest = applyServerErrors(form, error.errors, {
          fields: FIELDS,
          messages: { value_error: t('validation.emailInvalid') },
        });
        if (rest.length === 0) return;
      }
      setAlert(alertMessage(error, t, { invalid_credentials: t('login.invalidCredentials') }));
    }
  });

  return (
    <AuthCard
      productName={app('name')}
      title={t('login.title')}
      description={t('login.description')}
      links={
        <TextLink href="/reset-password" className="type-body">
          {t('links.forgotPassword')}
        </TextLink>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          setSubmitted(true);
          void submit(event);
        }}
      >
        {alert !== null ? (
          <FormAlert ref={alertRef} tabIndex={-1} live={false} message={alert} />
        ) : notice !== null && !submitted ? (
          <FormAlert tone="positive" message={t(`login.notices.${notice}`)} />
        ) : null}
        <FormField
          control={form.control}
          name="email"
          label={t('fields.email')}
          render={(field) => (
            <Input
              {...field.controlProps}
              type="email"
              size="lg"
              autoComplete="username"
              value={field.value}
              onValueChange={field.onChange}
            />
          )}
        />
        <FormField
          control={form.control}
          name="password"
          label={t('fields.password')}
          render={(field) => (
            <PasswordInput
              {...field.controlProps}
              size="lg"
              autoComplete="current-password"
              showLabel={t('fields.showPassword')}
              hideLabel={t('fields.hidePassword')}
              value={field.value}
              onValueChange={field.onChange}
            />
          )}
        />
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
          {t('login.submit')}
        </Button>
      </form>
    </AuthCard>
  );
}
