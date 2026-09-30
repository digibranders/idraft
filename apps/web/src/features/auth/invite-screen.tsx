'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { withInvitation } from './invitation';
import { BackToSignIn } from './links';
import { alertMessage, weakPasswordMessage } from './problems';
import { MAX_NAME_LENGTH, MIN_PASSWORD_LENGTH } from './rules';
import { useFormAlert } from './use-alert';
import { useStep } from './use-step';
import { FormField } from '@/components/app/forms/form-field';
import { AuthCard } from '@/components/app/shell/auth-card';
import { Button } from '@/components/ui/button';
import { FormAlert } from '@/components/ui/form-alert';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { TextLink } from '@/components/ui/text-link';
import { unwrap } from '@/lib/api/client';
import { pendingApi, type InvitationPreview } from '@/lib/api/pending';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation } from '@/lib/api/query';
import { applyServerErrors } from '@/lib/forms';
import { hardNavigate } from '@/lib/navigation/hard-navigate';
import { useFragmentParam } from '@/lib/url/use-fragment-param';

/** Sign-in after registering: it says the account is ready, and carries the token so signing in joins. */
const signInAfterRegister = (token: string): string => withInvitation('/login?notice=accountCreated', token);
/** Sign-in for someone who has an account already: signing in accepts the invitation. */
const signInToAccept = (token: string): string => withInvitation('/login', token);

/**
 * `/invite#token=...`: creates the account the invitation is for; signing in afterwards joins the workspace
 * (19 section 3.2.2). The pending route `POST /invitations/preview` adds what the invitation is (workspace,
 * role, who sent it, the address) when it answers; without it the page still works, asking for the address.
 */
export function InviteScreen(): ReactNode {
  const t = useTranslations('auth');
  const app = useTranslations('app');
  const token = useFragmentParam('token');
  const preview = useQuery({
    // The token stays out of the key: the page has one, and the cache is dropped with the page
    queryKey: ['pending', 'invitation-preview'],
    queryFn: ({ signal }) =>
      unwrap(pendingApi.POST('/api/v1/invitations/preview', { body: { token: token ?? '' }, signal })),
    enabled: typeof token === 'string',
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
  });

  if (token === undefined) return null;
  if (token === null) {
    return (
      <AuthCard
        productName={app('name')}
        title={t('invite.missingTitle')}
        description={t('invite.missingDescription')}
        links={<BackToSignIn />}
      >
        {null}
      </AuthCard>
    );
  }
  if (preview.isPending) {
    return (
      <AuthCard
        productName={app('name')}
        title={t('invite.loadingTitle')}
        description={t('verifyEmail.checkingDescription')}
        aria-busy
      >
        {null}
      </AuthCard>
    );
  }
  if (isApiProblem(preview.error, 'invalid_token')) {
    return (
      <AuthCard
        productName={app('name')}
        title={t('invalidLink.title')}
        description={t('invite.registrationClosed')}
        links={<BackToSignIn />}
      >
        {null}
      </AuthCard>
    );
  }
  // Any other failure, the route not being there among them, leaves the page without the description
  return <RegisterForm token={token} invitation={preview.data?.data ?? null} />;
}

interface RegisterValues {
  name: string;
  email: string;
  password: string;
}
const FIELDS = ['name', 'email', 'password'] as const;

function RegisterForm({ token, invitation }: { token: string; invitation: InvitationPreview | null }): ReactNode {
  const t = useTranslations('auth');
  const app = useTranslations('app');
  const { alert, setAlert, alertRef } = useFormAlert();
  const [existing, setExisting] = useState(false);
  const register = useMutation(apiMutation('post', '/api/v1/auth/register'));
  const busy = register.isPending || register.isSuccess;
  const schema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .trim()
          .min(1, { error: t('validation.nameRequired') })
          .max(MAX_NAME_LENGTH, { error: t('validation.nameTooLong', { max: MAX_NAME_LENGTH }) }),
        email: z
          .string()
          .trim()
          .min(1, { error: t('validation.emailRequired') })
          .pipe(z.email({ error: t('validation.emailInvalid') })),
        password: z
          .string()
          .min(1, { error: t('validation.passwordRequired') })
          .min(MIN_PASSWORD_LENGTH, { error: t('validation.passwordTooShort', { min: MIN_PASSWORD_LENGTH }) }),
      }),
    [t],
  );
  const form = useForm<RegisterValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: { name: '', email: invitation?.email ?? '', password: '' },
  });
  useEffect(() => form.setFocus('name'), [form]);
  const title =
    invitation === null ? t('invite.genericTitle') : t('invite.title', { workspace: invitation.workspace.name });
  const titleRef = useStep(title, { focusHeading: false });

  const submit = form.handleSubmit(async ({ name, email, password }) => {
    if (busy) return;
    setAlert(null);
    try {
      await register.mutateAsync({
        body: { name: name.trim(), email: email.trim(), password, invitation_token: token },
      });
      hardNavigate(signInAfterRegister(token));
    } catch (error) {
      const weak = weakPasswordMessage(error, t);
      if (weak !== null) {
        form.setError('password', { type: 'server', message: weak }, { shouldFocus: true });
        return;
      }
      if (isApiProblem(error, 'validation_failed')) {
        const rest = applyServerErrors(form, error.errors, {
          fields: FIELDS,
          messages: {
            value_error: t('validation.emailInvalid'),
            string_too_short: t('validation.nameRequired'),
            string_too_long: t('validation.nameTooLong', { max: MAX_NAME_LENGTH }),
          },
        });
        if (rest.length === 0) return;
      }
      setExisting(isApiProblem(error, 'duplicate'));
      setAlert(
        alertMessage(error, t, {
          registration_closed: t('invite.registrationClosed'),
          duplicate: t('invite.duplicate'),
        }),
      );
    }
  });

  return (
    <AuthCard
      productName={app('name')}
      title={title}
      description={
        invitation === null
          ? t('invite.genericDescription')
          : t('invite.description', { inviter: invitation.inviter.name, role: invitation.role })
      }
      links={
        existing ? (
          <TextLink href={signInToAccept(token)} className="type-body">
            {t('invite.signInToAccept')}
          </TextLink>
        ) : (
          <BackToSignIn />
        )
      }
      titleRef={titleRef}
    >
      <form noValidate className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        {alert === null ? null : <FormAlert ref={alertRef} tabIndex={-1} live={false} message={alert} />}
        <FormField
          control={form.control}
          name="name"
          label={t('fields.name')}
          render={(field) => (
            <Input
              {...field.controlProps}
              size="lg"
              autoComplete="name"
              value={field.value}
              onValueChange={field.onChange}
            />
          )}
        />
        {/* The address the invitation was sent to is the account's username: a password manager saves the
            new password with it. Known from the invitation, it cannot be changed here. */}
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
              readOnly={invitation !== null}
              value={field.value}
              onValueChange={field.onChange}
            />
          )}
        />
        <FormField
          control={form.control}
          name="password"
          label={t('fields.password')}
          description={t('validation.passwordTooShort', { min: MIN_PASSWORD_LENGTH })}
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
          {t('invite.submit')}
        </Button>
      </form>
    </AuthCard>
  );
}
